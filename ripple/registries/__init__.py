"""Public-registry clients (read-only) and the per-ecosystem :class:`RegistrySet`."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable, Iterable

import httpx

from ..models import Ecosystem, ScanOptions
from ..security import validate_registry_url
from .base import (  # noqa: F401
    ALLOWED_METHODS, USER_AGENT, CircuitBreaker, ReadOnlyClient, ReadOnlyViolation, Registry, RegistryError,
    RegistryRecord, RegistryUnavailable, TokenBucket, script_indicators,
)
from .cache import ResponseCache, default_cache_dir  # noqa: F401
from .crates import CratesRegistry
from .fixture import FixtureRegistry
from .golang import GoRegistry
from .npm import NpmRegistry
from .pypi import PyPIRegistry


@dataclass
class RegistrySet:
    """One :class:`Registry` per ecosystem."""
    npm: Registry
    pypi: Registry
    go: Registry
    rust: Registry

    def get(self, ecosystem: Ecosystem | str) -> Registry:
        return {Ecosystem.NPM: self.npm, Ecosystem.PYPI: self.pypi, Ecosystem.GO: self.go,
                Ecosystem.RUST: self.rust}[Ecosystem(ecosystem)]

    def all(self) -> list[Registry]:
        return [self.npm, self.pypi, self.go, self.rust]

    @property
    def request_count(self) -> int:
        return sum(r.request_count for r in self.all())

    async def aclose(self) -> None:
        for r in self.all():
            await r.aclose()

    @classmethod
    def fixture(cls, records: Iterable[RegistryRecord] = (), **fail: Iterable[str]) -> "RegistrySet":
        recs = list(records)
        def mk(eco: Ecosystem) -> FixtureRegistry:
            return FixtureRegistry(eco, [r for r in recs if r.ecosystem == eco], fail=fail.get(eco.value, ()))
        return cls(mk(Ecosystem.NPM), mk(Ecosystem.PYPI), mk(Ecosystem.GO), mk(Ecosystem.RUST))

    @classmethod
    def live(cls, options: ScanOptions | None = None, *, cache_dir: Path | str | None = None,
             transport: httpx.AsyncBaseTransport | None = None,
             sleep: Callable[[float], Awaitable[None]] | None = None) -> "RegistrySet":
        """Real registries (GET-only). ``transport`` lets tests inject ``httpx.MockTransport``."""
        o = options or ScanOptions()
        directory = Path(cache_dir) if cache_dir else default_cache_dir()
        cache = ResponseCache(directory, o.cache_ttl_s)

        def client(rps: float) -> ReadOnlyClient:
            return ReadOnlyClient(rps=rps, timeout=o.timeout_s, cache=cache, transport=transport, sleep=sleep)

        ov = o.registry_overrides or {}
        def base(eco: Ecosystem, default: str) -> str:
            # Overrides come from settings/options: re-validate (http(s) only, no credentials, never
            # link-local / metadata). Anything unacceptable falls back to the public default.
            url = ov.get(eco.value)
            if not url:
                return default
            try:
                return validate_registry_url(url)
            except ValueError:
                return default

        return cls(
            NpmRegistry(client(o.rate_limit_rps), base_url=base(Ecosystem.NPM, "https://registry.npmjs.org")),
            PyPIRegistry(client(o.rate_limit_rps), base_url=base(Ecosystem.PYPI, "https://pypi.org")),
            GoRegistry(client(o.rate_limit_rps), base_url=base(Ecosystem.GO, "https://proxy.golang.org")),
            CratesRegistry(client(min(o.rate_limit_rps, 1.0)), base_url=base(Ecosystem.RUST, "https://crates.io")),
        )
