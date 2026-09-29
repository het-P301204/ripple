"""Dependency-confusion classification matrix: every path gives a *reason*, not just "missing"."""
from __future__ import annotations

import pytest

from ripple.models import Ecosystem, PublicStatus, Resolution, ScanOptions, Severity, severity_for_score
from ripple.parsers.base import ParsedLockfile
from ripple.scanners.confusion import assess_internal, classify, detect_confusion
from ripple.scoring import build_findings

from conftest import NOW, days_ago, make_ctx, make_pkg, make_record

E = Ecosystem


def run(pkg, rec=None, **ctx_kw):
    records = {pkg.name: rec} if rec is not None else None
    ctx = make_ctx([pkg], records, **ctx_kw)
    return classify(pkg, ctx)


def score(det) -> int:
    return max(0, min(100, det.raw_score))


def labels(det) -> set[str]:
    return {d.label for d in det.drivers}


# ------------------------------------------------------------------------------------------ name heuristics
@pytest.mark.parametrize("eco,name,level", [
    (E.NPM, "@acme/internal-utils", "strong"),
    (E.NPM, "acme-internal", "strong"),
    (E.NPM, "acme.internal", "strong"),
    (E.PYPI, "acme-private-client", "strong"),
    (E.PYPI, "acme-core", "medium"),
    (E.NPM, "acme-platform-utils", "medium"),
    (E.NPM, "@acme/logger", "weak"),
    (E.NPM, "@types/node", "none"),
    (E.NPM, "lodash", "none"),
    (E.NPM, "aws-sdk", "none"),                      # popular: generic-suffix heuristic must not fire
    (E.RUST, "company-billing", "medium"),
    (E.GO, "corp/platform/auth", "strong"),
    (E.GO, "git.acme.corp/team/svc", "strong"),
    (E.GO, "gitlab.acme.com/team/svc", "medium"),
    (E.GO, "github.com/gin-gonic/gin", "none"),
    (E.GO, "golang.org/x/net", "none"),
])
def test_assess_internal_levels(eco, name, level):
    assert assess_internal(eco, name).level == level


def test_user_declared_scopes_and_prefixes():
    a = assess_internal(E.NPM, "@widgets/thing", ["@widgets"])
    assert a.level == "strong" and "declared" in a.reasons[0]
    assert assess_internal(E.PYPI, "widgets-thing", ["widgets-"]).level == "strong"
    assert assess_internal(E.PYPI, "widgetsx-thing", ["widgets-"]).level != "strong"
    assert assess_internal(E.GO, "git.widgets.io/team/lib", ["git.widgets.io"]).level == "strong"


def test_non_public_registry_source_is_a_strong_signal():
    a = assess_internal(E.NPM, "left-thing", registry_source="https://npm.acme.corp/repo")
    assert a.level == "strong" and "non-public" in a.reasons[0]
    assert assess_internal(E.NPM, "left-thing", registry_source="https://registry.npmjs.org").level == "none"


# ------------------------------------------------------------------------------------------ classification matrix
def test_not_found_internal_range_public_source_is_critical():
    pkg = make_pkg("@acme/internal-utils", "2.1.0", spec="^2.1.0", resolution=Resolution.RANGE, public_status=PublicStatus.NOT_FOUND)
    d = run(pkg)
    assert score(d) >= 80 and severity_for_score(score(d)) is Severity.CRITICAL
    assert {"Internal-looking name", "Not publicly registered", "Version range", "Resolved via public registry"} <= labels(d)
    assert "not_found" in d.tags and "range" in d.tags


def test_not_found_internal_pinned_hashed_private_source_is_mitigated_low():
    pkg = make_pkg("@acme/internal-utils", "2.1.0", resolution=Resolution.HASHED, integrity="sha512-x",
                   registry_source="https://npm.acme.corp/repo", public_status=PublicStatus.NOT_FOUND)
    d = run(pkg)
    assert 0 < score(d) < 35
    assert "Explicit private registry source" in labels(d) and "Pinned with integrity hash" in labels(d)


def test_not_found_not_internal_private_source_hashed_is_not_flagged():
    pkg = make_pkg("left-thing", "1.0.0", resolution=Resolution.HASHED, integrity="sha512-x",
                   registry_source="https://npm.acme.corp/repo", public_status=PublicStatus.NOT_FOUND)
    assert run(pkg) is None                          # not-found alone is not a finding


def test_not_found_not_internal_private_source_range_is_info():
    pkg = make_pkg("left-thing", "1.0.0", spec="^1.0.0", resolution=Resolution.RANGE,
                   registry_source="https://npm.acme.corp/repo", public_status=PublicStatus.NOT_FOUND)
    d = run(pkg)
    assert d is not None and severity_for_score(score(d)) is Severity.INFO


def test_not_found_not_internal_public_source_is_moderate_and_explained():
    pkg = make_pkg("some-removed-pkg", "1.0.0", resolution=Resolution.EXACT, public_status=PublicStatus.NOT_FOUND)
    d = run(pkg)
    assert d is not None and 10 <= score(d) < 60
    assert "Not found on public registry" in labels(d) and d.title == "Unregistered Package Name"
    assert "Internal-looking name" not in labels(d)


def test_registered_publicly_but_internal_looking_and_recent_is_high():
    pkg = make_pkg("acme-internal-auth", "1.4.0", E.PYPI, spec=">=1.4", resolution=Resolution.RANGE, public_status=PublicStatus.REGISTERED)
    rec = make_record(E.PYPI, "acme-internal-auth", registered_at=days_ago(20), weekly_downloads=30)
    d = run(pkg, rec)
    assert score(d) >= 60 and d.title == "Internal-Looking Name Registered Publicly"
    assert {"Already registered publicly", "Recent registration", "Low downloads"} <= labels(d)
    assert "registered" in d.tags


def test_registered_internal_looking_but_established_is_not_flagged():
    pkg = make_pkg("acme-core", "1.0.0", E.PYPI, resolution=Resolution.EXACT, public_status=PublicStatus.REGISTERED)
    rec = make_record(E.PYPI, "acme-core", registered_at=days_ago(2000), weekly_downloads=900_000)
    assert run(pkg, rec) is None


def test_registered_not_internal_looking_is_not_flagged():
    pkg = make_pkg("requests", "2.31.0", E.PYPI, resolution=Resolution.EXACT, public_status=PublicStatus.REGISTERED)
    assert run(pkg, make_record(E.PYPI, "requests")) is None


def test_private_source_and_public_name_collision_is_flagged():
    pkg = make_pkg("obscure-widget", "1.0.0", resolution=Resolution.EXACT, registry_source="https://npm.acme.corp/repo",
                   public_status=PublicStatus.REGISTERED)
    d = run(pkg, make_record(E.NPM, "obscure-widget", registered_at=days_ago(30), weekly_downloads=10))
    assert d is not None and "Private-registry package" in labels(d)


def test_unknown_status_offline_heuristics_are_low_confidence():
    pkg = make_pkg("acme-internal-auth", "1.4.0", E.PYPI, spec=">=1.4", resolution=Resolution.RANGE, public_status=PublicStatus.UNKNOWN)
    d = run(pkg, registry_checked=False) if False else run(pkg)
    assert d is not None and "unverified" in d.tags and d.title.startswith("Potential Dependency Confusion")
    f = build_findings([d], [pkg], "2026-01-01T00:00:00Z")[0]
    assert f.confidence < 0.6
    assert run(make_pkg("left-thing", "1.0.0", public_status=PublicStatus.UNKNOWN)) is None


def test_local_and_vcs_resolutions_are_skipped():
    for res in (Resolution.LOCAL, Resolution.VCS):
        pkg = make_pkg("@acme/internal-utils", "1.0.0", resolution=res, public_status=PublicStatus.NOT_FOUND)
        assert run(pkg) is None


def test_mixed_index_adds_a_driver():
    lf = ParsedLockfile(filename="requirements.txt", ecosystem=E.PYPI, kind="requirements.txt",
                        extra_index_urls=["https://pypi.acme.corp/simple"])
    pkg = make_pkg("acme-internal-auth", "", E.PYPI, spec=">=1.4", resolution=Resolution.RANGE,
                   source_file="requirements.txt", public_status=PublicStatus.NOT_FOUND)
    d = run(pkg, lockfiles={"requirements.txt": lf})
    assert "Mixed package index" in labels(d) and "Resolved via public registry" not in labels(d)
    assert score(d) >= 85


def test_high_downstream_usage_driver():
    pkg = make_pkg("@acme/internal-utils", "2.1.0", spec="^2.1.0", resolution=Resolution.RANGE,
                   public_status=PublicStatus.NOT_FOUND, dependents_count=4)
    assert "High downstream usage" in labels(run(pkg))


def test_go_private_module_paths():
    pkg = make_pkg("corp.internal/platform/auth", "v1.2.0", E.GO, resolution=Resolution.EXACT, public_status=PublicStatus.NOT_FOUND)
    d = run(pkg)
    assert d is not None and score(d) >= 60 and "Internal-looking name" in labels(d)
    pub = make_pkg("github.com/acme/tool", "v1.0.0", E.GO, resolution=Resolution.HASHED, integrity="h1:x", public_status=PublicStatus.REGISTERED)
    assert run(pub, make_record(E.GO, "github.com/acme/tool")) is None


def test_rust_company_prefix_registered_recently():
    pkg = make_pkg("company-billing", "0.1.0", E.RUST, resolution=Resolution.HASHED, integrity="abc", public_status=PublicStatus.REGISTERED)
    d = run(pkg, make_record(E.RUST, "company-billing", registered_at=days_ago(10), weekly_downloads=3))
    assert d is not None and score(d) >= 35


def test_user_declared_scope_drives_detection():
    pkg = make_pkg("@widgets/pay", "1.0.0", spec="^1.0.0", resolution=Resolution.RANGE, public_status=PublicStatus.NOT_FOUND)
    assert "Internal-looking name" in labels(run(pkg, options=ScanOptions(internal_scopes=["@widgets"])))
    weaker = run(pkg)
    assert "Internal-looking name" not in labels(weaker)


def test_detect_confusion_covers_all_packages_and_findings_carry_reasons():
    pkgs = [make_pkg("@acme/internal-utils", "2.1.0", spec="^2.1.0", resolution=Resolution.RANGE, public_status=PublicStatus.NOT_FOUND),
            make_pkg("left-pad", "1.3.0", resolution=Resolution.HASHED, integrity="x", public_status=PublicStatus.REGISTERED)]
    dets = detect_confusion(make_ctx(pkgs))
    assert len(dets) == 1
    f = build_findings(dets, pkgs, "2026-01-01T00:00:00Z")[0]
    assert f.rule_id == "RIPPLE-DC-001" and f.why_flagged and f.attack_vector and f.remediation
    assert any("registry" in r.title.lower() or "scope" in r.title.lower() for r in f.remediation)
