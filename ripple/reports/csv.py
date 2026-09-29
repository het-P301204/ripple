"""CSV exports (findings and packages), hardened against spreadsheet formula injection."""
from __future__ import annotations

import csv as _csv
import io
from typing import Any

from ripple.models import ScanResult

from .common import cat, eco, sev, sorted_findings

_DANGEROUS_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n")
_LEADING_JUNK = " \t\r\n\x0b\x0c\x00\u00a0\ufeff\u200b"


def safe_cell(value: Any) -> Any:
    """Neutralise CSV/Excel formula injection: text cells starting with = + - @ get a leading apostrophe.

    Real numbers/booleans are passed through untouched.
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return value
    text = str(value)
    # Spreadsheets may skip leading whitespace / invisible characters before deciding a cell is a formula.
    if text.startswith(_DANGEROUS_PREFIXES) or text.lstrip(_LEADING_JUNK).startswith(("=", "+", "-", "@")):
        return "'" + text
    return text


FINDING_COLUMNS = [
    "id", "severity", "risk_score", "confidence", "category", "rule_id", "title", "ecosystem", "package",
    "version", "resolution", "public_status", "registry", "lockfile", "related_package", "summary", "drivers",
    "remediation",
]

PACKAGE_COLUMNS = [
    "id", "name", "version", "ecosystem", "resolution", "direct", "dev", "depth", "public_status",
    "internal_looking", "risk_score", "severity", "status", "confusion", "typosquat", "metadata_flag",
    "registry_exposure", "registry_source", "source_file", "finding_ids",
]


def _write(columns: list[str], rows: list[list[Any]]) -> str:
    buf = io.StringIO()
    w = _csv.writer(buf, lineterminator="\n", quoting=_csv.QUOTE_MINIMAL)
    w.writerow(columns)
    for row in rows:
        w.writerow([safe_cell(c) for c in row])
    return buf.getvalue()


def findings_csv(result: ScanResult) -> str:
    rows = []
    for f in sorted_findings(result.findings):
        rows.append([
            f.id, sev(f.severity), f.risk_score, round(f.confidence, 3), cat(f.category), f.rule_id, f.title,
            eco(f.ecosystem), f.package, f.version, f.resolution_type, f.public_status, f.registry,
            f.dependency_source, f.related_package or "", f.summary,
            "; ".join(f"{d.label} ({d.points:+d})" for d in f.drivers),
            "; ".join(r.title for r in f.remediation),
        ])
    return _write(FINDING_COLUMNS, rows)


def packages_csv(result: ScanResult) -> str:
    rows = []
    for p in result.packages:
        rows.append([
            p.id, p.name, p.version, eco(p.ecosystem), sev(p.resolution), p.direct, p.dev, p.depth,
            sev(p.public_status), p.internal_looking, p.risk_score, sev(p.severity), sev(p.status), p.confusion,
            p.typosquat, p.metadata_flag, p.registry_exposure, p.registry_source or "", p.source_file,
            " ".join(p.finding_ids),
        ])
    return _write(PACKAGE_COLUMNS, rows)


def to_csv(result: ScanResult, kind: str = "findings") -> str:
    if kind == "packages":
        return packages_csv(result)
    return findings_csv(result)
