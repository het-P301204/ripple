"""Deterministic offline demo: synthetic lockfiles pushed through the real engine with fixture registries."""
from __future__ import annotations

import asyncio
import concurrent.futures
from datetime import datetime, timezone

from ..engine import ScanInput, iso, run_scan
from ..models import ScanOptions, ScanResult, ScanSource
from ..registries import RegistrySet
from ..registries.base import RegistryRecord
from . import dataset
from .dataset import DEMO_SCAN_DATE, PROJECT  # noqa: F401

_cache: dict[str, object] = {}


def _generated() -> dict:
    if "data" not in _cache:
        npm_lock, npm_recs = dataset.build_npm()
        req, pypi_recs = dataset.build_pypi()
        gomod, gosum, go_recs = dataset.build_go()
        cargo, rust_recs = dataset.build_rust()
        _cache["data"] = {
            "files": [("package-lock.json", npm_lock), ("requirements.txt", req), ("go.mod", gomod),
                      ("go.sum", gosum), ("Cargo.lock", cargo)],
            "records": npm_recs + pypi_recs + go_recs + rust_recs + dataset.build_lookalikes() + [dataset.requests_record()],
        }
    return _cache["data"]  # type: ignore[return-value]


def demo_inputs() -> list[ScanInput]:
    """The synthetic lockfiles (package-lock.json, requirements.txt, go.mod, go.sum, Cargo.lock)."""
    return [ScanInput(filename=n, content=c) for n, c in _generated()["files"]]


def demo_records() -> list[RegistryRecord]:
    return list(_generated()["records"])


def demo_registries() -> RegistrySet:
    return RegistrySet.fixture(demo_records())


def demo_options() -> ScanOptions:
    return ScanOptions(live=False, max_edit_distance=2, internal_scopes=[])


async def build_demo_scan_async(stamp_now: bool = True) -> ScanResult:
    res = await run_scan(
        demo_inputs(), demo_options(), project=PROJECT, registries=demo_registries(),
        source=ScanSource(kind="demo", files=[i.filename for i in demo_inputs()]), now=DEMO_SCAN_DATE,
        scan_id="demo-payments-api",
    )
    if stamp_now:
        res.created_at = iso(datetime.now(timezone.utc))
    return res


def build_demo_scan(stamp_now: bool = True) -> ScanResult:
    """Deterministic, offline (FixtureRegistry - never touches the network). Safe to call from sync or async code."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(build_demo_scan_async(stamp_now))
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(lambda: asyncio.run(build_demo_scan_async(stamp_now))).result()
