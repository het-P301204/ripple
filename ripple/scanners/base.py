"""Shared scanner types: the analysis context and the intermediate `Detection`."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable

from ..models import (
    Category, EvidenceItem, Package, Remediation, RiskDriver, ScanOptions,
)
from ..parsers.base import ParsedLockfile
from ..parsers.normalize import comparison_key
from ..registries.base import RegistryRecord


def parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def days_since(ts: str | None, now: datetime) -> int | None:
    dt = parse_iso(ts)
    if dt is None:
        return None
    return max(0, (now - dt).days)


def record_key(package: Package) -> str:
    return f"{package.ecosystem.value}:{comparison_key(package.ecosystem, package.name)}"


@dataclass
class ScanContext:
    """Everything a scanner may read. Scanners never mutate packages except through explicit engine steps."""
    options: ScanOptions
    now: datetime
    packages: list[Package]
    lockfiles: dict[str, ParsedLockfile] = field(default_factory=dict)      # by source filename
    records: dict[str, RegistryRecord | None] = field(default_factory=dict)  # record_key -> record (None = 404)
    registry_checked: bool = False
    unavailable_ecosystems: set = field(default_factory=set)   # registries that failed repeatedly (skip further probing)

    def record(self, package: Package) -> RegistryRecord | None:
        return self.records.get(record_key(package))

    def lockfile(self, package: Package) -> ParsedLockfile | None:
        return self.lockfiles.get(package.source_file)

    def by_id(self) -> dict[str, Package]:
        return {p.id: p for p in self.packages}


@dataclass
class Detection:
    """A scanner's raw result; `scoring.risk.build_findings` turns it into a `Finding`."""
    package_id: str
    category: Category
    rule_id: str
    title: str
    drivers: list[RiskDriver]
    summary: str
    why_flagged: str
    attack_vector: str
    evidence: list[EvidenceItem] = field(default_factory=list)
    tags: set[str] = field(default_factory=set)
    confidence_base: float = 0.5
    confidence_adjustments: list[tuple[str, float]] = field(default_factory=list)
    related_package: str | None = None
    remediation: list[Remediation] = field(default_factory=list)
    force_emit: bool = False        # emit even if points sum to <= 0 (informational findings)

    @property
    def raw_score(self) -> int:
        return sum(d.points for d in self.drivers)


def drv(label: str, points: int, detail: str = "") -> RiskDriver:
    return RiskDriver(label=label, points=points, detail=detail)


def ev(label: str, value: object, mono: bool = True) -> EvidenceItem:
    return EvidenceItem(label=label, value=str(value), mono=mono)


def compact(items: Iterable[str], limit: int = 6) -> str:
    items = list(items)
    return ", ".join(items[:limit]) + (f" (+{len(items) - limit} more)" if len(items) > limit else "")


def human_downloads(n: int | None) -> str:
    if n is None:
        return "unknown"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M/week"
    if n >= 1_000:
        return f"{n / 1_000:.1f}k/week"
    return f"{n}/week"


from ..models import Ecosystem  # noqa: E402

REGISTRY_LABEL = {
    Ecosystem.NPM: "the public npm registry",
    Ecosystem.PYPI: "PyPI",
    Ecosystem.GO: "the public Go module proxy",
    Ecosystem.RUST: "crates.io",
}
ECOSYSTEM_LABEL = {Ecosystem.NPM: "npm", Ecosystem.PYPI: "PyPI", Ecosystem.GO: "Go", Ecosystem.RUST: "Rust"}
