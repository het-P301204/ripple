"""Registry abstractions: the read-only HTTP client, rate limiter and the common record model."""
from __future__ import annotations

import asyncio
import json
import re
import time
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Awaitable, Callable

import httpx
from pydantic import BaseModel, Field, model_validator

from .. import __version__
from ..models import Ecosystem, InstallScripts
from ..security import assert_public_target, clean_optional, escape_controls
from .cache import ResponseCache

USER_AGENT = f"ripple-scanner/{__version__} (defensive read-only supply-chain scanner; +https://github.com/het-P301204/ripple)"
ALLOWED_METHODS = frozenset({"GET", "HEAD"})
MAX_RESPONSE_BYTES = 64 * 1024 * 1024        # decoded body cap per response (defends against huge / compressed bombs)
MAX_REDIRECTS = 5
_REDIRECT_CODES = frozenset({301, 302, 303, 307, 308})
# Public registry hosts RIPPLE talks to by default: no DNS pre-check needed (they are the trusted defaults).
TRUSTED_HOSTS = frozenset({"registry.npmjs.org", "api.npmjs.org", "pypi.org", "proxy.golang.org", "crates.io"})


class ReadOnlyViolation(Exception):
    """Raised when code tries to issue anything other than GET/HEAD."""


class RegistryError(Exception):
    """A registry could not be queried (rate limited, 5xx, timeout, malformed response) after retries."""


class RegistryUnavailable(RegistryError):
    """The circuit breaker is open: this registry has been failing and further lookups are skipped."""


class CircuitBreaker:
    """Opens after ``threshold`` consecutive failures, or when more than ``ratio`` of the first ``window`` outcomes failed.

    Once open it stays open for the lifetime of the client (one scan), so a dead registry costs seconds, not minutes.
    """

    def __init__(self, threshold: int = 5, window: int = 10, ratio: float = 0.5):
        self.threshold, self.window, self.ratio = threshold, window, ratio
        self.consecutive = 0
        self.seen = 0
        self.fails = 0
        self.open = False

    def _note(self, ok: bool) -> None:
        if self.seen < self.window:
            self.seen += 1
            self.fails += 0 if ok else 1
            if self.fails > self.ratio * self.window:
                self.open = True

    def success(self) -> None:
        self.consecutive = 0
        self._note(True)

    def failure(self, weight: int = 1) -> None:
        """``weight`` > 1 for connection-level failures (refused / DNS): the host is very likely simply down."""
        self.consecutive += weight
        self._note(False)
        if self.consecutive >= self.threshold:
            self.open = True


class RegistryRecord(BaseModel):
    """Common shape of public-registry metadata across ecosystems."""
    ecosystem: Ecosystem
    name: str
    exists: bool = True
    registered_at: str | None = None
    latest_version: str | None = None
    latest_published_at: str | None = None
    versions: list[str] = Field(default_factory=list)
    weekly_downloads: int | None = None
    maintainers: list[str] = Field(default_factory=list)
    maintainer_changes: int = 0
    install_scripts: InstallScripts = Field(default_factory=InstallScripts)
    network_indicators: list[str] = Field(default_factory=list)
    repository_url: str | None = None
    description: str | None = None
    deprecated: bool = False

    @model_validator(mode="after")
    def _neutralise_untrusted_text(self) -> "RegistryRecord":
        """Every string here comes from a public registry (attacker-controlled): strip control characters,
        bidi overrides and line breaks so it can never forge terminal output, and bound list sizes."""
        for f in ("registered_at", "latest_version", "latest_published_at"):
            setattr(self, f, clean_optional(getattr(self, f), 100))
        self.versions = [escape_controls(v)[:100] for v in self.versions[:20000]]
        self.maintainers = [escape_controls(m)[:200] for m in self.maintainers[:200]]
        self.network_indicators = [escape_controls(n)[:200] for n in self.network_indicators[:50]]
        self.repository_url = clean_optional(self.repository_url, 500)
        self.description = clean_optional(self.description, 300)
        sc = self.install_scripts
        for hook in ("preinstall", "install", "postinstall", "prepare"):
            setattr(sc, hook, clean_optional(getattr(sc, hook), 500))
        return self


_BAD_NAME_CHARS = re.compile(r"[\x00-\x20\x7f-\x9f\\?#%:*\"<>|]")


def valid_lookup_name(name: str, *, max_slashes: int = 0) -> bool:
    """Structural sanity check before a package name is placed in a registry URL path.

    Names that fail can never exist on a registry; rejecting them stops path tricks (``..``, ``%2e``,
    embedded ``?``/``#``) that would make a lockfile-supplied name address a different endpoint.
    """
    if not name or len(name) > 300 or _BAD_NAME_CHARS.search(name):
        return False
    if name.count("/") > max_slashes:
        return False
    segments = name.split("/")
    return all(seg not in ("", ".", "..") for seg in segments)


class Registry(ABC):
    """One public registry. ``get_package`` returns None for a definitive 404 and raises RegistryError otherwise."""
    ecosystem: Ecosystem

    @abstractmethod
    async def get_package(self, name: str) -> RegistryRecord | None: ...

    async def aclose(self) -> None:  # pragma: no cover - default no-op
        return None

    @property
    def request_count(self) -> int:
        return 0


class TokenBucket:
    """Async token bucket: at most ``rate`` acquisitions per second on average, bursts up to ``capacity``."""

    def __init__(self, rate: float, capacity: float | None = None, *,
                 clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep):
        self.rate = max(float(rate), 0.001)
        self.capacity = float(capacity if capacity is not None else max(1.0, rate))
        self._tokens = self.capacity
        self._clock = clock
        self._sleep = sleep
        self._last = clock()
        self._lock: asyncio.Lock | None = None

    async def acquire(self, abort: Callable[[], bool] | None = None) -> bool:
        """Wait for a token. Returns False (without consuming one) if ``abort()`` becomes true while waiting."""
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            while True:
                if abort is not None and abort():
                    return False
                now = self._clock()
                self._tokens = min(self.capacity, self._tokens + (now - self._last) * self.rate)
                self._last = now
                if self._tokens >= 1.0:
                    self._tokens -= 1.0
                    return True
                await self._sleep((1.0 - self._tokens) / self.rate)


def parse_retry_after(value: str | None, now: datetime | None = None) -> float | None:
    if not value:
        return None
    value = value.strip()
    if re.fullmatch(r"\d+(\.\d+)?", value):
        return float(value)
    try:
        dt = parsedate_to_datetime(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0.0, (dt - (now or datetime.now(timezone.utc))).total_seconds())
    except (TypeError, ValueError):
        return None


class ReadOnlyClient:
    """The only HTTP path registries use. GET/HEAD only; rate limited; retried; cached.

    Any other method raises :class:`ReadOnlyViolation` before a request is built.
    """

    def __init__(self, *, rps: float = 5.0, timeout: float = 10.0, max_retries: int = 3, concurrency: int = 8,
                 cache: ResponseCache | None = None, transport: httpx.AsyncBaseTransport | None = None,
                 user_agent: str = USER_AGENT, sleep: Callable[[float], Awaitable[None]] | None = None,
                 backoff_base: float = 0.5, max_retry_after: float = 30.0, breaker_threshold: int = 5,
                 max_response_bytes: int = MAX_RESPONSE_BYTES):
        self._sleep = sleep or asyncio.sleep
        # Redirects are followed manually (see _send): same host only, re-validated at every hop.
        # TLS verification stays at httpx's secure default - never disabled.
        self._http = httpx.AsyncClient(
            timeout=timeout, transport=transport, follow_redirects=False,
            headers={"User-Agent": user_agent, "Accept": "application/json, text/plain;q=0.8, */*;q=0.5"},
        )
        self._resolve_dns = transport is None        # injected transports (tests) never touch DNS
        self._deadline = max(30.0, float(timeout) * 4)   # overall wall-clock cap for one request incl. body
        self.max_response_bytes = max_response_bytes
        self._bucket = TokenBucket(rps, sleep=self._sleep)
        self._sem = asyncio.Semaphore(max(1, concurrency))
        self.cache = cache
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.max_retry_after = max_retry_after
        self.request_count = 0
        self.breaker = CircuitBreaker(threshold=breaker_threshold)

    @property
    def unavailable(self) -> bool:
        return self.breaker.open

    # -- enforcement -------------------------------------------------------------------------------------
    async def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        if method.upper() not in ALLOWED_METHODS:
            raise ReadOnlyViolation(f"RIPPLE is read-only: {method.upper()} requests are not permitted.")
        self.request_count += 1
        try:
            return await asyncio.wait_for(self._send(method.upper(), url, **kwargs), self._deadline)
        except asyncio.TimeoutError:
            raise httpx.ReadTimeout("overall request deadline exceeded") from None

    async def _check_target(self, url: httpx.URL) -> None:
        if url.scheme not in ("http", "https") or not url.host:
            raise RegistryError("Refusing a non-HTTP(S) registry URL.")
        host = url.host.lower()
        try:
            await assert_public_target(host, url.port or (443 if url.scheme == "https" else 80),
                                       resolve=self._resolve_dns and host not in TRUSTED_HOSTS)
        except ValueError as exc:
            raise RegistryError(f"Refusing to contact {_host(str(url))}: {exc}.") from None

    @staticmethod
    def _same_host(origin: httpx.URL, target: httpx.URL) -> bool:
        if (origin.host or "").lower() != (target.host or "").lower():
            return False
        if origin.scheme == "https" and target.scheme != "https":
            return False                              # never downgrade
        o_port = origin.port or (443 if origin.scheme == "https" else 80)
        t_port = target.port or (443 if target.scheme == "https" else 80)
        return o_port == t_port or (origin.scheme == "http" and target.scheme == "https" and t_port == 443)

    async def _send(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        """One logical request: SSRF-checked, same-host redirects only, decoded body capped, fully read."""
        origin = httpx.URL(url)
        current = origin
        for _ in range(MAX_REDIRECTS + 1):
            await self._check_target(current)
            req = self._http.build_request(method, current, **kwargs)
            resp = await self._http.send(req, stream=True)
            nxt: httpx.URL | None = None
            body = b""
            try:
                location = resp.headers.get("location")
                if resp.status_code in _REDIRECT_CODES and location:
                    try:
                        nxt = resp.url.join(location)
                    except (httpx.InvalidURL, ValueError):
                        raise RegistryError("Registry sent a malformed redirect.") from None
                    if not self._same_host(origin, nxt):
                        raise RegistryError(f"{_host(str(origin))} redirected to a different host; refusing to follow.")
                else:
                    declared = resp.headers.get("content-length", "")
                    if declared.isdigit() and int(declared) > self.max_response_bytes:
                        raise RegistryError(f"Response from {_host(str(origin))} is too large.")
                    chunks: list[bytes] = []
                    total = 0
                    try:
                        async for chunk in resp.aiter_bytes():
                            total += len(chunk)
                            if total > self.max_response_bytes:
                                raise RegistryError(f"Response from {_host(str(origin))} is too large.")
                            chunks.append(chunk)
                    except httpx.DecodingError:
                        raise RegistryError(f"Undecodable response from {_host(str(origin))}.") from None
                    body = b"".join(chunks)
            finally:
                await resp.aclose()
            if nxt is not None:
                current = nxt
                continue
            headers = [(k, v) for k, v in resp.headers.multi_items()
                       if k.lower() not in ("content-encoding", "content-length", "transfer-encoding")]
            return httpx.Response(resp.status_code, headers=headers, content=body, request=req)
        raise RegistryError(f"Too many redirects from {_host(str(origin))}.")

    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self.request("GET", url, **kwargs)

    async def head(self, url: str, **kwargs: Any) -> httpx.Response:
        return await self.request("HEAD", url, **kwargs)

    def _forbidden(self, method: str) -> Any:
        raise ReadOnlyViolation(f"RIPPLE is read-only: {method} requests are not permitted.")

    async def post(self, *a: Any, **k: Any) -> Any: self._forbidden("POST")
    async def put(self, *a: Any, **k: Any) -> Any: self._forbidden("PUT")
    async def patch(self, *a: Any, **k: Any) -> Any: self._forbidden("PATCH")
    async def delete(self, *a: Any, **k: Any) -> Any: self._forbidden("DELETE")
    async def options(self, *a: Any, **k: Any) -> Any: self._forbidden("OPTIONS")

    # -- resilient fetch ---------------------------------------------------------------------------------
    def _backoff(self, attempt: int) -> float:
        return self.backoff_base * (2 ** attempt)

    async def fetch_text(self, url: str) -> str | None:
        """Body text on 200, None on 404/410. Raises RegistryError after retries for 429/5xx/timeouts."""
        if self.cache is not None:
            hit = self.cache.get(url)
            if hit is not None:
                return None if hit[0] == 404 else hit[1]
        last = "unknown error"
        for attempt in range(self.max_retries + 1):
            if self.breaker.open:
                raise RegistryUnavailable(f"{_host(url)} marked unavailable after repeated failures.")
            if not await self._bucket.acquire(abort=lambda: self.breaker.open):
                raise RegistryUnavailable(f"{_host(url)} marked unavailable after repeated failures.")
            try:
                async with self._sem:
                    resp = await self.get(url)
            except (httpx.TimeoutException, httpx.TransportError) as e:
                last = f"network error ({type(e).__name__})"
                self.breaker.failure(2 if isinstance(e, (httpx.ConnectError, httpx.ConnectTimeout)) else 1)
                if attempt < self.max_retries and not self.breaker.open:
                    await self._sleep(self._backoff(attempt))
                continue
            code = resp.status_code
            if code == 200:
                self.breaker.success()
                text = resp.text
                if self.cache is not None:
                    self.cache.put(url, 200, text)
                return text
            if code in (404, 410):
                self.breaker.success()
                if self.cache is not None:
                    self.cache.put(url, 404, "")
                return None
            if code == 429:
                last = "rate limited (HTTP 429)"
                if attempt < self.max_retries:
                    wait = parse_retry_after(resp.headers.get("Retry-After"))
                    wait = self._backoff(attempt) if wait is None else wait
                    await self._sleep(min(wait, self.max_retry_after))
                else:
                    self.breaker.failure()
                continue
            if code >= 500:
                last = f"registry error (HTTP {code})"
                self.breaker.failure()
                if attempt < self.max_retries and not self.breaker.open:
                    await self._sleep(self._backoff(attempt))
                continue
            raise RegistryError(f"Unexpected response (HTTP {code}) from {_host(url)}.")
        if self.breaker.open:
            raise RegistryUnavailable(f"{_host(url)}: {last}; registry marked unavailable.")
        raise RegistryError(f"{_host(url)}: {last} after {self.max_retries + 1} attempts.")

    async def fetch_json(self, url: str) -> Any | None:
        text = await self.fetch_text(url)
        if text is None:
            return None
        try:
            return json.loads(text)
        except (ValueError, RecursionError):
            raise RegistryError(f"Malformed JSON response from {_host(url)}.") from None

    async def aclose(self) -> None:
        await self._http.aclose()


async def probe(url: str, timeout: float = 3.0) -> bool:
    """Reachability check for a registry base URL (used by ``/api/health``): one read-only GET through the
    hardened client (SSRF-checked, same-host redirects, small body cap, no retries, no cache)."""
    client = ReadOnlyClient(rps=10, timeout=timeout, max_retries=0, max_response_bytes=4 * 1024 * 1024)
    try:
        resp = await client.get(url)
        return resp.status_code < 500
    except (RegistryError, httpx.HTTPError, ValueError):
        return False
    finally:
        await client.aclose()


def _host(url: str) -> str:
    m = re.match(r"^\w+://([^/]+)", url)
    return m.group(1) if m else "registry"


# ---------------------------------------------------------------------------------------------------------
# script analysis shared by npm / pypi / crates mappers
# ---------------------------------------------------------------------------------------------------------

_INDICATORS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bcurl\b", re.I), "curl"),
    (re.compile(r"\bwget\b", re.I), "wget"),
    (re.compile(r"http://", re.I), "http:// URL"),
    (re.compile(r"base64\s+(-d|--decode)|\batob\(|frombase64string", re.I), "base64 decode"),
    (re.compile(r"(^|[\s;|&])(nc|ncat|netcat)\s|/dev/tcp/", re.I), "netcat/raw socket"),
    (re.compile(r"invoke-webrequest|\biwr\b|powershell\b.*-enc", re.I), "PowerShell download"),
    (re.compile(r"\beval\b\s*[\(\$`]", re.I), "eval"),
]


def script_indicators(scripts: dict[str, str | None]) -> list[str]:
    out: list[str] = []
    for hook, body in scripts.items():
        if not body:
            continue
        for rx, label in _INDICATORS:
            if rx.search(body):
                out.append(f"{label} in {hook}")
    return out


def truncate(s: str | None, n: int = 500) -> str | None:
    return s if s is None or len(s) <= n else s[:n]
