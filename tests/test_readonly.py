"""The scanner must be structurally incapable of anything but GET/HEAD."""
from __future__ import annotations

import re
from pathlib import Path

import httpx
import pytest

from ripple.demo import build_demo_scan_async
from ripple.engine import ScanInput, run_scan
from ripple.models import ScanOptions
from ripple.registries import ReadOnlyClient, ReadOnlyViolation, RegistrySet

ROOT = Path(__file__).resolve().parents[1] / "ripple"


def mock_client(seen: list[str]) -> ReadOnlyClient:
    def h(req: httpx.Request) -> httpx.Response:
        seen.append(req.method)
        return httpx.Response(404)

    return ReadOnlyClient(rps=1000, transport=httpx.MockTransport(h))


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "post", "Delete"])
async def test_request_rejects_write_methods(method):
    seen: list[str] = []
    c = mock_client(seen)
    with pytest.raises(ReadOnlyViolation):
        await c.request(method, "https://example.test/x")
    assert seen == []                                 # nothing was sent


async def test_convenience_write_methods_raise():
    seen: list[str] = []
    c = mock_client(seen)
    for name in ("post", "put", "patch", "delete", "options"):
        with pytest.raises(ReadOnlyViolation):
            await getattr(c, name)("https://example.test/x", json={"a": 1})
    assert seen == []


async def test_get_and_head_are_allowed():
    seen: list[str] = []
    c = mock_client(seen)
    await c.get("https://example.test/x")
    await c.head("https://example.test/x")
    assert seen == ["GET", "HEAD"]


async def test_full_live_scan_only_ever_sends_get():
    methods: list[str] = []

    def h(req: httpx.Request) -> httpx.Response:
        methods.append(req.method)
        return httpx.Response(404)

    opts = ScanOptions(live=True, rate_limit_rps=1000, cache_ttl_s=0)
    rs = RegistrySet.live(opts, transport=httpx.MockTransport(h))
    res = await run_scan([ScanInput("requirements.txt", "requests==2.31.0\nflask==3.0.0\n")], opts, registries=rs)
    await rs.aclose()
    assert methods and set(methods) == {"GET"}
    assert res.summary.total_dependencies == 2


async def test_demo_makes_no_network_calls(monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("network access attempted")

    monkeypatch.setattr(httpx.AsyncClient, "send", boom)
    res = await build_demo_scan_async()
    assert res.mode == "demo"


def test_source_has_no_write_http_calls():
    """Static guard: no `.post(` / `.put(` / `.patch(` / `.delete(` HTTP calls anywhere in engine-owned code."""
    pattern = re.compile(r"\b(?:httpx|client|_http|session|requests|self\.client|self\._http)\.(post|put|patch|delete)\s*\(")
    owned = [ROOT / "engine.py"] + [p for d in ("registries", "scanners", "parsers", "scoring", "demo") for p in (ROOT / d).rglob("*.py")]
    offenders = [f"{p.relative_to(ROOT)}:{i}" for p in owned for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1)
                 if pattern.search(line)]
    assert offenders == []


def test_http_client_is_only_built_in_the_shared_wrapper():
    offenders = []
    for p in (ROOT / "registries").glob("*.py"):
        if p.name == "base.py":
            continue
        text = p.read_text(encoding="utf-8")
        if re.search(r"httpx\.(AsyncClient|Client|get|post|request)\(", text):
            offenders.append(p.name)
    assert offenders == []
