"""Shared helpers for report renderers."""
from __future__ import annotations

import re
from typing import Iterable

from ripple.models import Category, Finding, ScanResult, Severity, SEVERITY_ORDER

SEVERITY_RANK: dict[str, int] = {s.value: i for i, s in enumerate(reversed(SEVERITY_ORDER))}
# critical=4 ... info=0

CATEGORY_LABELS = {
    "dependency_confusion": "Dependency Confusion",
    "typosquatting": "Typosquatting",
    "suspicious_metadata": "Suspicious Metadata",
    "registry_exposure": "Registry Exposure",
}

DEFAULT_RULE_IDS = {
    "dependency_confusion": "RIPPLE-DC-001",
    "typosquatting": "RIPPLE-TS-001",
    "suspicious_metadata": "RIPPLE-SM-001",
    "registry_exposure": "RIPPLE-RE-001",
}

CATEGORY_HELP = {
    "dependency_confusion": (
        "A dependency whose name looks internal/private is either unregistered on the public registry or "
        "resolvable through a version range, so a public package with the same name could be installed instead.",
        "Pin exact versions with integrity hashes, scope private packages to a private registry (npm scopes, "
        "pip --index-url instead of --extra-index-url, GOPRIVATE, Cargo registries), and reserve the name publicly.",
    ),
    "typosquatting": (
        "The package name is within a small edit distance of a popular package (or has registered look-alikes), "
        "which is the signature of typosquatting attacks.",
        "Verify the package name against the intended project, replace mistyped names, and add allow-lists for "
        "approved dependencies.",
    ),
    "suspicious_metadata": (
        "Public-registry metadata shows risk signals: install-time scripts, very recent registration, maintainer "
        "changes, low adoption, or network activity in lifecycle scripts.",
        "Review the package source and its install scripts, prefer established alternatives, and disable install "
        "scripts (npm --ignore-scripts) where possible.",
    ),
    "registry_exposure": (
        "The lockfile resolves packages over an insecure or unpinned channel: http:// registries, missing "
        "integrity hashes, git/URL dependencies, or a mixed set of package indexes.",
        "Use https registries only, keep integrity hashes in lockfiles, pin git dependencies to commit SHAs, "
        "and use a single trusted index.",
    ),
}


def sev(value) -> str:
    return value.value if hasattr(value, "value") else str(value)


def eco(value) -> str:
    return value.value if hasattr(value, "value") else str(value)


def cat(value) -> str:
    return value.value if hasattr(value, "value") else str(value)


def rule_id_for(f: Finding) -> str:
    return f.rule_id or DEFAULT_RULE_IDS.get(cat(f.category), "RIPPLE-GEN-001")


def sorted_findings(findings: Iterable[Finding]) -> list[Finding]:
    return sorted(findings, key=lambda f: (-f.risk_score, f.id))


def meets(severity: str, threshold: str) -> bool:
    return SEVERITY_RANK.get(severity, 0) >= SEVERITY_RANK.get(threshold, 0)


def count_at_or_above(result: ScanResult, threshold: str) -> int:
    return sum(1 for f in result.findings if meets(sev(f.severity), threshold))


_SLUG_RE = re.compile(r"[^A-Za-z0-9._-]+")


def slug(text: str, default: str = "scan") -> str:
    s = _SLUG_RE.sub("-", text or "").strip("-.")
    return (s or default)[:60]


def fmt_int(n) -> str:
    return "-" if n is None else f"{n:,}"
