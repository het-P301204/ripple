"""Engine behaviour: offline mode, degradation, check subsets, progress, circuit breaker."""
from __future__ import annotations

import time

import httpx
import pytest

from ripple.engine import ScanInput, detect, run_scan
from ripple.models import Ecosystem, PublicStatus, STAGES, ScanOptions
from ripple.parsers import LockfileParseError, UnsupportedLockfile
from ripple.registries import RegistryRecord, RegistrySet

REQ = "requests==2.31.0\nacme-internal-auth>=1.4\nrequets==2.28.0\n"


def fixture_set(**kw):
    recs = [RegistryRecord(ecosystem=Ecosystem.PYPI, name="requests", registered_at="2011-02-13T00:00:00Z", weekly_downloads=60_000_000),
            RegistryRecord(ecosystem=Ecosystem.PYPI, name="requets", registered_at="2026-08-20T00:00:00Z", weekly_downloads=12)]
    return RegistrySet.fixture(recs, **kw)


async def test_offline_mode_is_heuristic_only_and_says_so():
    res = await run_scan([ScanInput("requirements.txt", REQ)], ScanOptions(live=False))
    assert res.mode == "offline"
    assert all(p.public_status is PublicStatus.UNKNOWN for p in res.packages)
    assert any("Offline mode" in w for w in res.warnings)
    titles = {f.package: f.title for f in res.findings}
    assert "acme-internal-auth" in titles and titles["acme-internal-auth"].startswith("Potential Dependency Confusion")
    assert "requets" in titles                                        # name-based typosquat works offline
    assert res.lookalikes == []


async def test_injected_registries_are_used_without_live_flag():
    res = await run_scan([ScanInput("requirements.txt", REQ)], ScanOptions(), registries=fixture_set())
    st = {p.name: p.public_status for p in res.packages}
    assert st == {"requests": PublicStatus.REGISTERED, "acme-internal-auth": PublicStatus.NOT_FOUND, "requets": PublicStatus.REGISTERED}
    assert res.mode == "live"
    assert res.summary.confusion_candidates == 1 and res.summary.typosquat_candidates >= 1
    assert {"requets"} <= {c.name for g in res.lookalikes for c in g.candidates if c.registered}


async def test_registry_failure_degrades_gracefully():
    res = await run_scan([ScanInput("requirements.txt", REQ)], ScanOptions(), registries=fixture_set(pypi=["requests"]))
    st = {p.name: p.public_status for p in res.packages}
    assert st["requests"] is PublicStatus.ERROR and st["requets"] is PublicStatus.REGISTERED
    assert any("unverified" in w for w in res.warnings)
    assert res.packages and res.findings                             # local analysis + other lookups still ran


async def test_checks_subset():
    only_exposure = await run_scan([ScanInput("requirements.txt", REQ)], ScanOptions(checks=["exposure"]), registries=fixture_set())
    assert {f.category.value for f in only_exposure.findings} <= {"registry_exposure"}
    stages = []
    await run_scan([ScanInput("requirements.txt", REQ)], ScanOptions(checks=["confusion"]), registries=fixture_set(),
                   progress=lambda s, st, d, f: stages.append((s, st)))
    assert ("typosquat", "skipped") in stages
    none = await run_scan([ScanInput("requirements.txt", REQ)], ScanOptions(checks=[]))
    assert none.findings == [] and none.summary.total_dependencies == 3


async def test_progress_events_follow_stages_with_real_fractions():
    events = []
    await run_scan([ScanInput("requirements.txt", REQ)], ScanOptions(), registries=fixture_set(),
                   progress=lambda s, st, d, f: events.append((s, st, d, f)))
    order = [s for s, st, _, _ in events if st == "done"]
    assert order == [sid for sid, _ in STAGES]
    reg = [f for s, st, _, f in events if s == "registry" and st == "active"]
    assert reg and reg[-1] == 1.0 and all(0 <= f <= 1 for f in reg if f is not None)
    assert any("dependencies discovered" in d for s, st, d, _ in events if s == "discover")


async def test_broken_progress_callback_does_not_break_scan():
    def bad(*a):
        raise RuntimeError("ui exploded")

    res = await run_scan([ScanInput("requirements.txt", REQ)], ScanOptions(), progress=bad)
    assert res.summary.total_dependencies == 3


async def test_unsupported_and_garbled_inputs():
    with pytest.raises(UnsupportedLockfile):
        await run_scan([ScanInput("photo.png", b"\x89PNG")], ScanOptions())
    with pytest.raises(LockfileParseError):
        await run_scan([ScanInput("package-lock.json", "{oops")], ScanOptions())
    with pytest.raises(UnsupportedLockfile):
        await run_scan([], ScanOptions())
    res = await run_scan([ScanInput("photo.png", b"x"), ScanInput("requirements.txt", REQ)], ScanOptions())
    assert res.summary.total_dependencies == 3 and any("photo.png" in w for w in res.warnings)


async def test_multi_ecosystem_merge_with_go_sum():
    files = [ScanInput("go.mod", "module x/y\n\nrequire github.com/gin-gonic/gin v1.9.1\n"),
             ScanInput("go.sum", "github.com/gin-gonic/gin v1.9.1 h1:abc=\n"),
             ScanInput("requirements.txt", "requests==2.31.0\n")]
    res = await run_scan(files, ScanOptions())
    gin = next(p for p in res.packages if p.name.endswith("gin"))
    assert gin.integrity == "h1:abc=" and gin.resolution.value == "hashed"
    assert res.summary.ecosystems == 2 and [e.ecosystem.value for e in res.ecosystems] == ["pypi", "go"]


def test_detect_wrapper():
    assert detect("go.mod", "module a\n\ngo 1.22\n")["ecosystem"] == "go"


# ---------------------------------------------------------------------------------------- circuit breaker
async def test_dead_registry_finishes_fast_and_warns():
    reqs = "\n".join(f"pkg{i}==1.0.{i}" for i in range(40)) + "\nrequests==2.31.0\n"
    hits = {"n": 0}

    def dead(req: httpx.Request) -> httpx.Response:
        hits["n"] += 1
        raise httpx.ConnectError("connection refused", request=req)

    opts = ScanOptions(live=True, rate_limit_rps=1000, cache_ttl_s=0)
    rs = RegistrySet.live(opts, transport=httpx.MockTransport(dead))          # real sleeps: proves backoff is short-circuited
    t = time.perf_counter()
    res = await run_scan([ScanInput("requirements.txt", reqs)], opts, registries=rs)
    await rs.aclose()
    assert time.perf_counter() - t < 8
    assert hits["n"] < 25                                                      # breaker stopped the probing
    assert all(p.public_status is PublicStatus.ERROR for p in res.packages)
    assert any("registry unavailable" in w and "41 packages unverified" in w for w in res.warnings)
    assert res.lookalikes == []                                                # no look-alike probing against a dead registry
    assert res.summary.total_dependencies == 41
    assert sum(1 for p in res.packages if p.status.value == "unverified") >= 30


async def test_always_503_registry_also_trips_the_breaker():
    hits = {"n": 0}

    def h(req):
        hits["n"] += 1
        return httpx.Response(503)

    async def nosleep(s):
        return None

    opts = ScanOptions(live=True, rate_limit_rps=1000, cache_ttl_s=0)
    rs = RegistrySet.live(opts, transport=httpx.MockTransport(h), sleep=nosleep)
    res = await run_scan([ScanInput("requirements.txt", "\n".join(f"p{i}==1.{i}" for i in range(30)))], opts, registries=rs)
    assert hits["n"] < 30 and any("unavailable" in w for w in res.warnings)
    assert all(p.public_status is PublicStatus.ERROR for p in res.packages)


async def test_healthy_registry_is_unaffected_by_breaker():
    def h(req: httpx.Request):
        return httpx.Response(404)

    opts = ScanOptions(live=True, rate_limit_rps=1000, cache_ttl_s=0)
    rs = RegistrySet.live(opts, transport=httpx.MockTransport(h))
    res = await run_scan([ScanInput("requirements.txt", "\n".join(f"p{i}==1.{i}" for i in range(20)))], opts, registries=rs)
    assert all(p.public_status is PublicStatus.NOT_FOUND for p in res.packages) and not any("unavailable" in w for w in res.warnings)
