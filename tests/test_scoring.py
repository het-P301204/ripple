from __future__ import annotations

import pytest

from ripple.models import (
    Category, EvidenceItem, Ecosystem, PackageStatus, PublicStatus, Resolution, RiskDriver, Severity, severity_for_score,
)
from ripple.scanners.base import Detection
from ripple.scoring import build_findings, clamp, confidence, overall_score, rollup_packages, score_drivers, severity_counts

from conftest import make_pkg


def det(pkg, points, cat=Category.DEPENDENCY_CONFUSION, rule="RIPPLE-DC-001", **kw):
    drivers = [RiskDriver(label=f"d{i}", points=p) for i, p in enumerate(points)]
    return Detection(package_id=pkg.id, category=cat, rule_id=rule, title="T", drivers=drivers, summary="s",
                     why_flagged="w", attack_vector="a", **kw)


def test_finding_score_is_clamped_sum_of_driver_points():
    p = make_pkg("a")
    fs = build_findings([det(p, [30, 30, 15, 10]), det(p, [90, 40], rule="R2"), det(p, [5, -20, 30], rule="R3")], [p], "t")
    for f in fs:
        assert f.risk_score == max(0, min(100, sum(d.points for d in f.drivers)))
    assert [f.risk_score for f in fs] == [100, 85, 15]                 # clamped at 100 and sorted desc
    assert [f.id for f in fs] == ["RIP-0001", "RIP-0002", "RIP-0003"]
    assert fs[0].severity is Severity.CRITICAL and fs[2].severity is Severity.LOW


def test_non_positive_detections_are_dropped_unless_forced():
    p = make_pkg("a")
    assert build_findings([det(p, [10, -20])], [p], "t") == []
    assert len(build_findings([det(p, [10, -20], force_emit=True)], [p], "t")) == 1


def test_ids_are_stable_and_deterministic_for_ties():
    a, b = make_pkg("b-pkg"), make_pkg("a-pkg")
    dets = [det(a, [40]), det(b, [40])]
    one = build_findings(dets, [a, b], "t")
    two = build_findings(list(reversed(dets)), [a, b], "t")
    assert [(f.id, f.package) for f in one] == [(f.id, f.package) for f in two] == [("RIP-0001", "a-pkg"), ("RIP-0002", "b-pkg")]


def test_confidence_is_transparent_and_bounded():
    d = det(make_pkg("a"), [10], confidence_base=0.5, confidence_adjustments=[("registry confirmed", 0.2), ("strong name", 0.15)])
    c, why = confidence(d)
    assert c == 0.85 and "0.50" in why and "+0.20 registry confirmed" in why
    assert confidence(det(make_pkg("a"), [1], confidence_base=0.9, confidence_adjustments=[("x", 0.5)]))[0] == 0.99
    assert confidence(det(make_pkg("a"), [1], confidence_base=0.1, confidence_adjustments=[("x", -0.5)]))[0] == 0.05
    f = build_findings([d], [make_pkg("a")], "t")[0]
    assert any(e.label == "Confidence basis" for e in f.evidence) and f.confidence == 0.85


def test_narrative_fields_are_plain_text():
    p = make_pkg("a")
    d = det(p, [40])
    d.summary = "`a` looks odd"
    f = build_findings([d], [p], "t")[0]
    assert "`" not in f.summary and f.remediation


def test_overall_score_properties():
    assert overall_score([]) == 0
    assert overall_score([20]) < overall_score([60]) < overall_score([95])
    base = overall_score([90, 50])
    assert overall_score([90, 50, 40, 40]) >= base                       # more findings never lower the score
    assert overall_score([100] * 20) <= 100
    assert overall_score([90, 85, 82]) > overall_score([90])             # severity-count bonus
    assert 0 <= overall_score([1, 1, 1]) <= 5


def test_severity_counts_and_thresholds():
    c = severity_counts([95, 80, 79, 60, 59, 35, 34, 15, 14, 0])
    assert (c.critical, c.high, c.medium, c.low, c.info) == (2, 2, 2, 2, 2)
    assert severity_for_score(80) is Severity.CRITICAL and severity_for_score(14) is Severity.INFO


def test_rollup_sets_package_fields():
    a, b, c = make_pkg("a"), make_pkg("b"), make_pkg("c", public_status=PublicStatus.ERROR)
    d = make_pkg("d")
    fs = build_findings([det(a, [70]), det(a, [40], Category.REGISTRY_EXPOSURE, "RIPPLE-RE-001"), det(b, [10])], [a, b, c, d], "t")
    rollup_packages([a, b, c, d], fs, registry_expected=True)
    assert a.risk_score == 70 and a.severity is Severity.HIGH and a.status is PackageStatus.FLAGGED
    assert a.confusion and a.registry_exposure and not a.typosquat and len(a.finding_ids) == 2
    assert b.status is not PackageStatus.FLAGGED and b.finding_ids and not b.confusion       # score 10 < flag threshold
    assert c.status is PackageStatus.UNVERIFIED
    assert d.status in (PackageStatus.UNVERIFIED, PackageStatus.CLEAN)
    d.public_status = PublicStatus.REGISTERED
    rollup_packages([d], [], registry_expected=True)
    assert d.status is PackageStatus.CLEAN


def test_score_drivers_are_readable_sentences():
    p = make_pkg("a")
    fs = build_findings([det(p, [90]), det(p, [70], rule="R2")], [p], "t")
    out = score_drivers(fs, overall_score([f.risk_score for f in fs]), [p])
    assert any(s.startswith("Highest finding RIP-0001") for s in out)
    assert any("Overall risk" in s for s in out) and all(s.endswith(".") for s in out)
    assert "No findings" in score_drivers([], 0, [p])[0]
