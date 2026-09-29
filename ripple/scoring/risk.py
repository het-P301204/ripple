"""Transparent additive risk model.

finding.risk_score = clamp(sum(driver.points), 0, 100); severity comes from `severity_for_score`.
The overall project score is a documented blend of the highest findings plus a severity-count bonus.
"""
from __future__ import annotations

from collections import Counter
from statistics import mean

from ..models import (
    CATEGORY_LABELS, Category, EvidenceItem, Finding, Package, PackageStatus, PublicStatus, Remediation, RiskDriver,
    Severity, SeverityCounts,
    severity_for_score,
)
from ..scanners.base import Detection
from .remediation import for_detection

# Overall-score weights (documented in the score drivers shown to the user)
W_TOP, W_TOP5, W_TOP15 = 0.40, 0.25, 0.10
BONUS_CRITICAL, BONUS_HIGH, BONUS_CAP = 1.5, 0.5, 8.0
FLOOR = 0.60          # overall is never below 60% of the single worst finding
FLAG_THRESHOLD = 15    # a package is "flagged" when one of its findings reaches LOW or above

_CAT_ORDER = {Category.DEPENDENCY_CONFUSION: 0, Category.TYPOSQUATTING: 1, Category.SUSPICIOUS_METADATA: 2,
              Category.REGISTRY_EXPOSURE: 3}


def clamp(n: float, lo: float = 0, hi: float = 100) -> int:
    return int(max(lo, min(hi, round(n))))


def confidence(det: Detection) -> tuple[float, str]:
    """Return ``(confidence, human-readable derivation)``."""
    val = det.confidence_base + sum(d for _, d in det.confidence_adjustments)
    val = round(max(0.05, min(0.99, val)), 2)
    parts = [f"base {det.confidence_base:.2f}"] + [f"{d:+.2f} {why}" for why, d in det.confidence_adjustments]
    return val, f"{val:.2f} = " + ", ".join(parts)


def _plain(text: str) -> str:
    """Narrative fields are plain text (the UI renders them verbatim), so drop markdown backticks."""
    return text.replace("`", "")


def build_findings(detections: list[Detection], packages: list[Package], detected_at: str) -> list[Finding]:
    by_id = {p.id: p for p in packages}
    scored: list[tuple[int, Detection]] = []
    for d in detections:
        if d.package_id not in by_id:
            continue
        score = clamp(d.raw_score)
        if score <= 0 and not d.force_emit:
            continue
        scored.append((score, d))
    scored.sort(key=lambda t: (-t[0], _CAT_ORDER[t[1].category], by_id[t[1].package_id].name, t[1].rule_id, t[1].title))
    findings: list[Finding] = []
    for i, (score, d) in enumerate(scored, start=1):
        pkg = by_id[d.package_id]
        conf, basis = confidence(d)
        evidence = list(d.evidence) + [EvidenceItem(label="Confidence basis", value=basis, mono=False)]
        findings.append(Finding(
            id=f"RIP-{i:04d}", package_id=pkg.id, package=pkg.name, version=pkg.version, ecosystem=pkg.ecosystem,
            category=d.category, title=_plain(d.title), severity=severity_for_score(score), risk_score=score,
            confidence=conf, summary=_plain(d.summary), why_flagged=_plain(d.why_flagged),
            attack_vector=_plain(d.attack_vector), evidence=evidence,
            drivers=[RiskDriver(label=x.label, points=x.points, detail=_plain(x.detail)) for x in d.drivers],
            remediation=[Remediation(title=_plain(r.title), detail=_plain(r.detail)) for r in for_detection(d, pkg)], resolution_type=pkg.resolution.value,
            dependency_source=pkg.source_file, registry=pkg.registry, detected_at=detected_at,
            public_status=pkg.public_status.value, related_package=_plain(d.related_package) if d.related_package else None, rule_id=d.rule_id,
        ))
    return findings


def rollup_packages(packages: list[Package], findings: list[Finding], registry_expected: bool) -> None:
    """Fill package-level risk fields from findings (in place)."""
    per: dict[str, list[Finding]] = {}
    for f in findings:
        per.setdefault(f.package_id, []).append(f)
    for p in packages:
        fs = per.get(p.id, [])
        p.finding_ids = [f.id for f in fs]
        p.risk_score = max((f.risk_score for f in fs), default=0)
        p.severity = severity_for_score(p.risk_score) if fs else Severity.INFO
        flagged = [f for f in fs if f.risk_score >= FLAG_THRESHOLD]
        p.confusion = any(f.category is Category.DEPENDENCY_CONFUSION for f in flagged)
        p.typosquat = any(f.category is Category.TYPOSQUATTING for f in flagged)
        p.metadata_flag = any(f.category is Category.SUSPICIOUS_METADATA for f in flagged)
        p.registry_exposure = any(f.category is Category.REGISTRY_EXPOSURE for f in flagged)
        if flagged:
            p.status = PackageStatus.FLAGGED
        elif p.public_status is PublicStatus.ERROR or (registry_expected and p.public_status is PublicStatus.UNKNOWN
                                                        and p.resolution.value not in ("local", "vcs")):
            p.status = PackageStatus.UNVERIFIED
        else:
            p.status = PackageStatus.CLEAN


def severity_counts(scores: list[int]) -> SeverityCounts:
    c = Counter(severity_for_score(s).value for s in scores)
    return SeverityCounts(**{k: c.get(k, 0) for k in ("critical", "high", "medium", "low", "info")})


def _blend(s: list[int]) -> tuple[float, float, float, float]:
    """(top, top5 mean, top15 mean, bonus) - means are zero-padded so extra findings can never lower the score."""
    top5 = sum(s[:5]) / 5
    top15 = sum(s[:15]) / 15
    crit = sum(1 for x in s if x >= 80)
    high = sum(1 for x in s if 60 <= x < 80)
    bonus = min(BONUS_CAP, BONUS_CRITICAL * crit + BONUS_HIGH * high)
    return float(s[0]), top5, top15, bonus


def overall_score(scores: list[int]) -> int:
    """0-100: 40% highest finding + 25% top-5 average + 10% top-15 average + severity bonus, floored at 60% of the top finding."""
    if not scores:
        return 0
    s = sorted(scores, reverse=True)
    top, top5, top15, bonus = _blend(s)
    return clamp(max(W_TOP * top + W_TOP5 * top5 + W_TOP15 * top15 + bonus, FLOOR * top))


def score_drivers(findings: list[Finding], overall: int, packages: list[Package], mode_note: str | None = None) -> list[str]:
    if not findings:
        out = ["No findings: no dependency-confusion, typosquatting, metadata or registry-exposure signals were detected."]
        if mode_note:
            out.append(mode_note)
        return out
    scores = [f.risk_score for f in findings]
    s = sorted(scores, reverse=True)
    top, top5, top15, bonus = _blend(s)
    t = findings[0]
    out = [
        f"Highest finding {t.id} ({t.risk_score}): {t.title} in {t.package} - weighted {int(W_TOP * 100)}% ({W_TOP * top:.1f} pts).",
        f"Average of the top 5 findings is {top5:.0f} - weighted {int(W_TOP5 * 100)}% ({W_TOP5 * top5:.1f} pts).",
        f"Average of the top 15 findings is {top15:.0f} - weighted {int(W_TOP15 * 100)}% ({W_TOP15 * top15:.1f} pts).",
    ]
    sc = severity_counts(scores)
    if bonus:
        out.append(f"Severity bonus +{bonus:.1f} for {sc.critical} critical and {sc.high} high finding(s) (capped at {BONUS_CAP:.0f}).")
    if FLOOR * top > W_TOP * top + W_TOP5 * top5 + W_TOP15 * top15 + bonus:
        out.append(f"Floor applied: the overall score is never below {int(FLOOR * 100)}% of the worst finding.")
    cats = Counter(f.category for f in findings)
    out.append("Findings by category: " + ", ".join(
        f"{n} {CATEGORY_LABELS[c].lower()}" for c, n in sorted(cats.items(), key=lambda kv: _CAT_ORDER[kv[0]])) + ".")
    unverified = sum(1 for p in packages if p.status is PackageStatus.UNVERIFIED)
    if unverified:
        out.append(f"{unverified} package(s) could not be verified against a public registry; scores for them are heuristic.")
    if mode_note:
        out.append(mode_note)
    out.append(f"Overall risk = {overall}/100 ({severity_for_score(overall).value}).")
    return out
