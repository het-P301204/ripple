"""SARIF 2.1.0 export (GitHub code scanning compatible)."""
from __future__ import annotations

import hashlib
import json as _json
import re
from urllib.parse import quote

from ripple.config import get_version
from ripple.models import Finding, ScanResult

from .common import CATEGORY_HELP, CATEGORY_LABELS, DEFAULT_RULE_IDS, SEVERITY_RANK, cat, eco, rule_id_for, sev, sorted_findings

SARIF_VERSION = "2.1.0"
SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json"
INFORMATION_URI = "https://github.com/ripple-scanner/ripple"

LEVEL_FOR_SEVERITY = {"critical": "error", "high": "error", "medium": "warning", "low": "note", "info": "note"}


def security_severity(risk_score: int | float) -> str:
    """Map a 0..100 risk score to the GitHub 0.0..10.0 ``security-severity`` string."""
    return f"{max(0.0, min(100.0, float(risk_score))) / 10:.1f}"


def _uri(f: Finding, result: ScanResult) -> str:
    """Repo-relative, percent-encoded artifact URI: never an absolute local path (would leak the user's
    directory layout into a shared report) and never ``..`` segments or control characters."""
    raw = f.dependency_source or (result.source.files[0] if result.source.files else "") or "unknown-lockfile"
    path = re.sub(r"^[A-Za-z]:", "", raw.replace("\\", "/"))
    parts = [p for p in path.split("/") if p not in ("", ".", "..")]
    return quote("/".join(parts) or "unknown-lockfile", safe="/._-~@+,=")


def _fingerprint(f: Finding) -> str:
    key = "|".join([rule_id_for(f), eco(f.ecosystem), f.package, f.version, f.dependency_source])
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:32]


def _build_rules(findings: list[Finding]) -> list[dict]:
    by_rule: dict[str, list[Finding]] = {}
    for f in findings:
        by_rule.setdefault(rule_id_for(f), []).append(f)
    rules = []
    for rule_id in sorted(by_rule):
        group = by_rule[rule_id]
        first = group[0]
        category = cat(first.category)
        desc, fix = CATEGORY_HELP.get(category, ("Supply-chain risk finding.", "Review the flagged dependency."))
        top = max(group, key=lambda g: g.risk_score)
        worst_level = LEVEL_FOR_SEVERITY[max((sev(g.severity) for g in group), key=lambda s: SEVERITY_RANK.get(s, 0))]
        name = "".join(w.capitalize() for w in first.title.replace("-", " ").split()) or rule_id
        rules.append({
            "id": rule_id,
            "name": name,
            "shortDescription": {"text": first.title},
            "fullDescription": {"text": desc},
            "help": {
                "text": f"{desc}\n\nRemediation: {fix}",
                "markdown": f"**{CATEGORY_LABELS.get(category, category)}**\n\n{desc}\n\n**Remediation:** {fix}",
            },
            "defaultConfiguration": {"level": worst_level},
            "properties": {
                "category": category,
                "tags": ["security", "supply-chain", category.replace("_", "-")],
                "precision": "medium",
                "problem.severity": worst_level,
                "security-severity": security_severity(top.risk_score),
            },
        })
    return rules


def _message(f: Finding) -> str:
    text = f"{f.title}: {f.package}@{f.version} ({eco(f.ecosystem)}) - {f.summary}"
    if f.remediation:
        text += f" Remediation: {f.remediation[0].title}."
    return text


def to_sarif_dict(result: ScanResult) -> dict:
    findings = sorted_findings(result.findings)
    rules = _build_rules(findings)
    rule_index = {r["id"]: i for i, r in enumerate(rules)}

    results = []
    artifacts: dict[str, dict] = {}
    for f in findings:
        rid = rule_id_for(f)
        uri = _uri(f, result)
        artifacts.setdefault(uri, {"location": {"uri": uri, "uriBaseId": "%SRCROOT%"}})
        results.append({
            "ruleId": rid,
            "ruleIndex": rule_index[rid],
            "level": LEVEL_FOR_SEVERITY[sev(f.severity)],
            "message": {"text": _message(f)},
            "locations": [{
                "physicalLocation": {
                    "artifactLocation": {"uri": uri, "uriBaseId": "%SRCROOT%"},
                    "region": {"startLine": 1},
                },
                "logicalLocations": [{
                    "name": f.package,
                    "fullyQualifiedName": f"{eco(f.ecosystem)}:{f.package}@{f.version}",
                    "kind": "package",
                }],
            }],
            "partialFingerprints": {"rippleFinding/v1": _fingerprint(f)},
            "properties": {
                "finding_id": f.id,
                "security-severity": security_severity(f.risk_score),
                "risk_score": f.risk_score,
                "severity": sev(f.severity),
                "confidence": round(f.confidence, 3),
                "ecosystem": eco(f.ecosystem),
                "package": f.package,
                "version": f.version,
                "category": cat(f.category),
                "drivers": [{"label": d.label, "points": d.points, "detail": d.detail} for d in f.drivers],
            },
        })

    return {
        "$schema": SARIF_SCHEMA,
        "version": SARIF_VERSION,
        "runs": [{
            "tool": {
                "driver": {
                    "name": "RIPPLE",
                    "fullName": "RIPPLE Software Supply Chain Attack Surface Scanner",
                    "version": result.version or get_version(),
                    "semanticVersion": result.version or get_version(),
                    "informationUri": INFORMATION_URI,
                    "rules": rules,
                }
            },
            "automationDetails": {"id": f"ripple/{result.project}/{result.id}"},
            "artifacts": list(artifacts.values()),
            "results": results,
            "invocations": [{
                "executionSuccessful": True,
                "properties": {
                    "mode": result.mode,
                    "risk_score": result.summary.risk_score,
                    "total_dependencies": result.summary.total_dependencies,
                    "scan_id": result.id,
                },
            }],
        }],
    }


def to_sarif(result: ScanResult) -> str:
    return _json.dumps(to_sarif_dict(result), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


__all__ = ["to_sarif", "to_sarif_dict", "security_severity", "LEVEL_FOR_SEVERITY", "DEFAULT_RULE_IDS"]
