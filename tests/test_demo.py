from __future__ import annotations

import json
import time
from collections import Counter

import pytest

from ripple.demo import build_demo_scan, demo_inputs
from ripple.models import Category, PublicStatus, ScanResult, Severity


@pytest.fixture(scope="module")
def demo() -> ScanResult:
    return build_demo_scan()


def test_dependency_counts(demo):
    assert demo.summary.total_dependencies == 187
    assert Counter(p.ecosystem.value for p in demo.packages) == {"npm": 87, "pypi": 52, "go": 28, "rust": 20}
    assert demo.summary.public_packages == 164
    assert demo.summary.internal_looking == 12
    assert demo.summary.ecosystems == 4 and demo.mode == "demo" and demo.project == "payments-api"


def test_finding_category_targets(demo):
    s = demo.summary
    assert (s.confusion_candidates, s.typosquat_candidates, s.suspicious_metadata, s.registry_exposure) == (3, 8, 14, 12)
    by_cat = Counter(f.category for f in demo.findings)
    assert by_cat == {Category.DEPENDENCY_CONFUSION: 3, Category.TYPOSQUATTING: 8, Category.SUSPICIOUS_METADATA: 14,
                      Category.REGISTRY_EXPOSURE: 12}
    assert s.attack_surface.dependency_confusion == 3 and s.attack_surface.registry_exposure == 12


def test_severity_mix_and_overall_score(demo):
    c = demo.summary.severity_counts
    assert (c.critical, c.high, c.medium, c.low, c.info) == (3, 8, 14, 12, 0)
    assert 69 <= demo.summary.risk_score <= 75
    assert demo.summary.risk_label == "high" and demo.summary.score_drivers


def test_findings_are_sorted_with_stable_ids(demo):
    scores = [f.risk_score for f in demo.findings]
    assert scores == sorted(scores, reverse=True)
    assert [f.id for f in demo.findings] == [f"RIP-{i:04d}" for i in range(1, len(demo.findings) + 1)]
    for f in demo.findings:
        assert f.risk_score == max(0, min(100, sum(d.points for d in f.drivers)))
        assert f.rule_id.startswith("RIPPLE-") and f.why_flagged and f.attack_vector and f.remediation and f.evidence
        assert f.detected_at.startswith("2026-09-28T09:30")


def test_headline_findings(demo):
    top: dict = {}
    for f in demo.findings:                       # findings are sorted by risk, so the first per package is its worst
        top.setdefault(f.package, f)
    dc = top["@acme/internal-utils"]
    assert dc.category is Category.DEPENDENCY_CONFUSION and dc.severity is Severity.CRITICAL
    assert dc.public_status == "not_found" and dc.resolution_type == "range"
    assert {d.label for d in dc.drivers} >= {"Internal-looking name", "Not publicly registered", "Version range"}
    assert top["acme-internal-auth"].severity is Severity.CRITICAL
    assert top["crossenv"].related_package == "cross-env"
    assert top["acme-platform-core"].public_status == "registered"          # already squatted on the public registry
    assert top["requets"].related_package == "requests"


def test_requests_lookalike_group(demo):
    g = next(g for g in demo.lookalikes if g.original == "requests")
    assert g.original_package_id.startswith("pypi:requests@") and g.original_weekly_downloads and g.original_weekly_downloads > 1_000_000
    reg = {c.name: c for c in g.candidates if c.registered}
    assert set(reg) == {"requets", "requsets", "reqquests", "reqests", "requ3sts", "python-requests", "python_requests"}
    assert reg["requ3sts"].mutation == "homoglyph" and reg["requsets"].mutation == "transposition"
    assert reg["python-requests"].mutation == "prefix_suffix"
    scores = [c.suspicion_score for c in g.candidates if c.registered]
    assert scores == sorted(scores, reverse=True) and len(set(scores)) >= 5                # varied facts
    assert reg["requ3sts"].install_scripts and reg["requ3sts"].maintainers and reg["requ3sts"].registered_at
    assert reg["reqests"].weekly_downloads > reg["requsets"].weekly_downloads
    assert any(not c.registered for c in g.candidates)
    assert {c.severity for c in reg.values()} >= {Severity.CRITICAL, Severity.MEDIUM}
    assert all(c.drivers for c in g.candidates)


def test_edges_and_graph_fields(demo):
    ids = {p.id for p in demo.packages}
    assert demo.edges and all(e.source in ids and e.target in ids for e in demo.edges)
    dependents = Counter(e.target for e in demo.edges)
    assert all(p.dependents_count == len({e.source for e in demo.edges if e.target == p.id}) for p in demo.packages[:30])
    assert any(p.dependents_count >= 3 for p in demo.packages) and max(p.depth for p in demo.packages) >= 2
    assert sum(1 for p in demo.packages if p.direct) == demo.summary.direct_dependencies
    assert dependents


def test_package_rollups(demo):
    flagged = [p for p in demo.packages if p.status.value == "flagged"]
    assert flagged and all(p.finding_ids and p.risk_score >= 15 for p in flagged)
    by_name = {p.name: p for p in demo.packages}
    assert by_name["@acme/internal-utils"].confusion and by_name["crossenv"].typosquat
    assert by_name["colour-mixr"].metadata_flag and by_name["legacy-tracker"].registry_exposure
    assert by_name["requests"].typosquat                              # has registered look-alikes
    assert by_name["react"].status.value == "clean"


def test_ecosystem_summaries(demo):
    e = {x.ecosystem.value: x for x in demo.ecosystems}
    assert e["npm"].total == 87 and e["pypi"].total == 52 and e["go"].total == 28 and e["rust"].total == 20
    assert sum(x.confusion for x in demo.ecosystems) == 3 and sum(x.exposure for x in demo.ecosystems) == 12
    assert all(0 <= x.registry_coverage <= 1 and x.lockfiles for x in demo.ecosystems)
    assert demo.warnings == []


def test_local_and_vcs_packages_are_unverified_not_public(demo):
    for p in demo.packages:
        if p.resolution.value in ("local", "vcs"):
            assert p.public_status is PublicStatus.UNKNOWN


def test_demo_inputs_are_parseable_lockfiles():
    names = [i.filename for i in demo_inputs()]
    assert names == ["package-lock.json", "requirements.txt", "go.mod", "go.sum", "Cargo.lock"]
    json.loads(demo_inputs()[0].content)                              # valid JSON lockfile
    assert "acme-internal-auth" in demo_inputs()[1].content and "replace" in demo_inputs()[2].content


def test_demo_is_deterministic_and_fast():
    t = time.perf_counter()
    a = build_demo_scan()
    elapsed = time.perf_counter() - t
    b = build_demo_scan()
    assert elapsed < 2.0

    def stable(r: ScanResult) -> dict:
        d = r.model_dump(mode="json")
        d.pop("created_at"); d.pop("duration_ms")
        return d

    assert stable(a) == stable(b)
    assert json.dumps(stable(a), sort_keys=True) == json.dumps(stable(b), sort_keys=True)


def test_demo_is_valid_json_roundtrip(demo):
    again = ScanResult.model_validate_json(demo.model_dump_json())
    assert again.summary.risk_score == demo.summary.risk_score and len(again.packages) == 187


def test_demo_never_uses_network(monkeypatch):
    import httpx

    async def boom(*a, **k):
        raise AssertionError("network access attempted by demo")

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", boom)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", boom)
    assert build_demo_scan().summary.total_dependencies == 187


def test_demo_module_prints_json(tmp_path):
    import subprocess, sys
    from pathlib import Path
    out = tmp_path / "demo.json"
    r = subprocess.run([sys.executable, "-m", "ripple.demo", "--out", str(out)], capture_output=True, text=True, timeout=60,
                       stdin=subprocess.DEVNULL, cwd=Path(__file__).resolve().parents[1])
    assert r.returncode == 0, r.stderr
    assert json.loads(out.read_text(encoding="utf-8"))["summary"]["total_dependencies"] == 187
