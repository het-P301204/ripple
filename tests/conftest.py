"""Shared test helpers (engine agent). No network is ever used."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from ripple.models import Ecosystem, Package, PublicStatus, Resolution, ScanOptions
from ripple.parsers.base import PUBLIC_REGISTRIES, ParsedLockfile, make_id
from ripple.registries.base import RegistryRecord
from ripple.scanners.base import ScanContext, record_key

FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 9, 28, 9, 30, tzinfo=timezone.utc)


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


@pytest.fixture(autouse=True)
def _isolated_ripple_home(tmp_path_factory, monkeypatch):
    """Never let a test read or write the developer's real ~/.ripple (scan history, cache, settings)."""
    home = tmp_path_factory.mktemp("ripple-home")
    monkeypatch.setenv("RIPPLE_HOME", str(home))
    monkeypatch.delenv("RIPPLE_CACHE_DIR", raising=False)
    yield
    # Scan jobs run in daemon threads; let them finish while RIPPLE_HOME still points at the temp dir,
    # otherwise a late save would land in the developer's real ~/.ripple/scans.
    import threading
    for t in threading.enumerate():
        if t.name.startswith("ripple-job-"):
            t.join(timeout=30)


@pytest.fixture
def fx():
    return fixture_text


@pytest.fixture
def cache_dir(tmp_path):
    d = tmp_path / "cache"
    d.mkdir()
    return d


def make_pkg(name: str, version: str = "1.0.0", eco: Ecosystem = Ecosystem.NPM, *, source_file: str = "lock",
             **kw) -> Package:
    return Package(id=make_id(eco, name, version), name=name, version=version, ecosystem=eco,
                   registry=PUBLIC_REGISTRIES[eco], source_file=source_file, **kw)


def make_record(eco: Ecosystem, name: str, **kw) -> RegistryRecord:
    return RegistryRecord(ecosystem=eco, name=name, **kw)


def make_ctx(packages: list[Package], records: dict[str, RegistryRecord | None] | None = None, *,
             options: ScanOptions | None = None, lockfiles: dict[str, ParsedLockfile] | None = None,
             registry_checked: bool = True) -> ScanContext:
    ctx = ScanContext(options=options or ScanOptions(), now=NOW, packages=packages, lockfiles=lockfiles or {},
                      registry_checked=registry_checked)
    by_key = {record_key(p): p for p in packages}
    for k, rec in (records or {}).items():
        ctx.records[k if ":" in k else record_key(next(p for p in packages if p.name == k))] = rec
    _ = by_key
    return ctx


def days_ago(n: int) -> str:
    from datetime import timedelta
    return (NOW - timedelta(days=n)).strftime("%Y-%m-%dT%H:%M:%SZ")


__all__ = ["make_pkg", "make_record", "make_ctx", "days_ago", "NOW", "Resolution", "PublicStatus"]
