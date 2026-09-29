"""CLI tests via typer's CliRunner. No network. Fake engine for determinism + real-engine integration tests."""
import csv
import io
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from typer.testing import CliRunner

from helpers_sample import CARGO_LOCK, PACKAGE_LOCK, REQUIREMENTS, fake_engine, ripple_home, sample_scan  # noqa: F401
from ripple.cli.app import app
from ripple.server import store

runner = CliRunner()
REPO = Path(__file__).resolve().parent.parent


def run(*args, **kw):
    return runner.invoke(app, [str(a) for a in args], **kw)


@pytest.fixture()
def lockdir(tmp_path):
    d = tmp_path / "proj"
    d.mkdir()
    (d / "package-lock.json").write_text(PACKAGE_LOCK)
    (d / "requirements.txt").write_text(REQUIREMENTS)
    (d / "Cargo.lock").write_text(CARGO_LOCK)
    return d


# --- basics ---------------------------------------------------------------------------------------------------

def test_version_command_and_flag(ripple_home):
    for args in (["version"], ["--version"]):
        r = run(*args)
        assert r.exit_code == 0 and "RIPPLE" in r.stdout and "1." in r.stdout


def test_help_lists_all_commands(ripple_home):
    r = run("--help")
    assert r.exit_code == 0
    for cmd in ("scan", "analyze", "report", "export", "demo", "serve", "history", "version"):
        assert cmd in r.stdout
    assert "authorized" in r.stdout.lower()
    r2 = run()
    assert "scan" in r2.output   # no_args_is_help


# --- scan ---------------------------------------------------------------------------------------------------------

def test_scan_files_rich_output_and_saved(ripple_home, fake_engine, lockdir):
    r = run("scan", lockdir / "package-lock.json", lockdir / "requirements.txt", "--internal-scope", "@acme")
    assert r.exit_code == 0, r.output
    for needle in ("RIPPLE Supply Chain Scanner", "72/100", "Top findings", "Severity summary", "Saved as"):
        assert needle in r.output
    assert "authorized" in r.output.lower()
    hist = store.history()
    assert len(hist) == 1
    opts, project, source, names = fake_engine.calls[-1]
    assert sorted(Path(n).name for n in names) == ["package-lock.json", "requirements.txt"]
    assert opts.internal_scopes == ["@acme"] and opts.live is False
    assert set(opts.checks) == {"confusion", "typosquat", "metadata", "exposure"}


def test_scan_directory_recurses_and_skips_vendor_dirs(ripple_home, fake_engine, lockdir):
    nm = lockdir / "node_modules" / "dep"
    nm.mkdir(parents=True)
    (nm / "package-lock.json").write_text("{}")
    (lockdir / ".git").mkdir()
    (lockdir / ".git" / "requirements.txt").write_text("x")
    sub = lockdir / "services" / "api"
    sub.mkdir(parents=True)
    (sub / "requirements-dev.txt").write_text("pytest")
    r = run("scan", lockdir, "--no-save", "--format", "json")
    assert r.exit_code == 0, r.output
    names = [n.replace("\\", "/") for n in fake_engine.calls[-1][3]]
    assert any(n.endswith("services/api/requirements-dev.txt") for n in names)
    assert not any("node_modules" in n or ".git" in n for n in names)
    assert len(names) == 4
    assert fake_engine.calls[-1][2].kind == "folder"
    assert store.history() == []   # --no-save


def test_scan_json_stdout_is_pure_json(ripple_home, fake_engine, lockdir):
    r = run("scan", lockdir / "package-lock.json", "--format", "json")
    assert r.exit_code == 0, r.output
    data = json.loads(r.stdout)          # stdout carries nothing but the JSON document
    assert data["summary"]["risk_score"] == 72


@pytest.mark.parametrize("fmt,check", [
    ("json", lambda t: json.loads(t)["project"]),
    ("sarif", lambda t: json.loads(t)["runs"][0]["tool"]["driver"]["name"] == "RIPPLE"),
    ("csv", lambda t: t.startswith("id,severity")),
    ("html", lambda t: t.startswith("<!doctype html>")),
    ("rich", lambda t: "72/100" in t),
])
def test_scan_output_file_in_each_format(ripple_home, fake_engine, lockdir, tmp_path, fmt, check):
    out = tmp_path / f"report.{fmt}"
    r = run("scan", lockdir / "requirements.txt", "--format", fmt, "-o", out)
    assert r.exit_code == 0, r.output
    assert check(out.read_text(encoding="utf-8"))


def test_scan_live_prints_notice_and_sets_option(ripple_home, fake_engine, lockdir):
    r = run("scan", lockdir / "package-lock.json", "--live", "--rate-limit", "2", "--timeout", "4",
            "--no-save", "--format", "json")
    assert r.exit_code == 0, r.output
    assert "LIVE mode" in r.output and "read-only GET" in r.output
    assert "LIVE mode" not in r.stdout          # notice goes to stderr, stdout stays machine-readable
    opts = fake_engine.calls[-1][0]
    assert opts.live is True and opts.rate_limit_rps == 2 and opts.timeout_s == 4


def test_scan_offline_is_default_and_prints_no_live_notice(ripple_home, fake_engine, lockdir):
    r = run("scan", lockdir / "package-lock.json", "--offline", "--no-save")
    assert "LIVE mode" not in r.output and fake_engine.calls[-1][0].live is False


def test_scan_checks_and_ecosystem_options(ripple_home, fake_engine, lockdir):
    r = run("scan", lockdir / "requirements.txt", "--checks", "confusion,typosquatting", "-e", "python", "--no-save",
            "--format", "json")
    assert r.exit_code == 0, r.output
    opts = fake_engine.calls[-1][0]
    assert opts.checks == ["confusion", "typosquat"] and opts.ecosystem.value == "pypi"
    run("scan", lockdir / "requirements.txt", "--full", "--checks", "confusion", "--no-save", "--format", "json")
    assert len(fake_engine.calls[-1][0].checks) == 4
    bad = run("scan", lockdir / "requirements.txt", "--checks", "nope")
    assert bad.exit_code == 2 and "Unknown check" in bad.output
    bad = run("scan", lockdir / "requirements.txt", "-e", "cobol")
    assert bad.exit_code == 2 and "Unknown ecosystem" in bad.output


def test_scan_invalid_format_and_severity(ripple_home, fake_engine, lockdir):
    r = run("scan", lockdir / "requirements.txt", "--format", "xml")
    assert r.exit_code == 2 and "Unknown format" in r.output and "Traceback" not in r.output
    r = run("scan", lockdir / "requirements.txt", "--fail-on", "catastrophic")
    assert r.exit_code == 2 and "Unknown severity" in r.output


def test_unsupported_file_prints_guidance(ripple_home, fake_engine, tmp_path):
    f = tmp_path / "notes.txt"
    f.write_text("hello")
    r = run("scan", f)
    assert r.exit_code == 2
    assert "Unsupported lockfile" in r.output and "notes.txt" in r.output
    for name in ("package-lock.json", "requirements.txt", "go.mod", "Cargo.lock", "npm", "PyPI", "Go", "Rust"):
        assert name in r.output
    assert "Traceback" not in r.output
    assert fake_engine.calls == []


def test_missing_path_and_empty_directory(ripple_home, fake_engine, tmp_path):
    r = run("scan", tmp_path / "nope.json")
    assert r.exit_code == 2 and "not found" in r.output.lower() and "Traceback" not in r.output
    empty = tmp_path / "empty"
    empty.mkdir()
    r = run("scan", empty)
    assert r.exit_code == 2 and "No lockfiles" in r.output


def test_supported_and_unsupported_mixed_skips_with_notice(ripple_home, fake_engine, lockdir):
    junk = lockdir / "readme.md"
    junk.write_text("x")
    r = run("scan", lockdir / "package-lock.json", junk, "--no-save", "--format", "json")
    assert r.exit_code == 0 and "Skipping unsupported" in r.output and "readme.md" in r.output


# --- fail-on exit codes ---------------------------------------------------------------------------------------

@pytest.mark.parametrize("threshold,code", [("critical", 1), ("high", 1), ("medium", 1), ("low", 1), ("info", 1)])
def test_fail_on_exits_1_when_findings_reach_threshold(ripple_home, fake_engine, lockdir, threshold, code):
    r = run("scan", lockdir / "package-lock.json", "--fail-on", threshold, "--no-save", "--format", "json")
    assert r.exit_code == code
    assert "--fail-on" in r.output


def test_fail_on_exits_0_when_below_threshold(ripple_home):
    scan = sample_scan("scan-low")
    scan.findings = [f for f in scan.findings if f.severity.value in ("low", "medium")]
    store.save(scan)
    assert run("report", "scan-low", "--fail-on", "high", "--format", "json").exit_code == 0
    assert run("report", "scan-low", "--fail-on", "medium", "--format", "json").exit_code == 1
    clean = sample_scan("scan-clean")
    clean.findings = []
    store.save(clean)
    assert run("report", "scan-clean", "--fail-on", "info", "--format", "json").exit_code == 0


# --- errors ----------------------------------------------------------------------------------------------------

def test_engine_crash_is_friendly_and_exit_2(ripple_home, fake_engine, tmp_path):
    f = tmp_path / "package-lock.json"
    f.write_bytes(b"BOOM")
    r = run("scan", f)
    assert r.exit_code == 2
    assert "Scan failed" in r.output
    for leak in ("Traceback", "engine.py", "victim", "secret"):
        assert leak not in r.output
    r = run("scan", f, "--debug")
    assert r.exit_code == 2 and "RuntimeError" in r.output      # --debug shows details


def test_parse_and_registry_errors_have_codes(ripple_home, fake_engine, tmp_path):
    f = tmp_path / "requirements.txt"
    f.write_bytes(b"BADPARSE")
    r = run("scan", f)
    assert r.exit_code == 2 and "parse_error" in r.output and "secret" not in r.output
    f.write_bytes(b"REGDOWN")
    r = run("scan", f)
    assert r.exit_code == 2 and "registry_unavailable" in r.output and "token=abc" not in r.output


# --- history / report / export / analyze ---------------------------------------------------------------------

def test_history_report_roundtrip(ripple_home, fake_engine, lockdir):
    assert "No saved scans" in run("history").output
    assert run("scan", lockdir / "package-lock.json", "--format", "json", "-o", lockdir / "x.json").exit_code == 0
    assert run("scan", lockdir / "requirements.txt", "--format", "json", "-o", lockdir / "y.json").exit_code == 0
    entries = store.history()
    assert len(entries) == 2
    r = run("history")
    assert r.exit_code == 0 and entries[0].id in r.output and "Scan history" in r.output
    as_json = json.loads(run("history", "--json").stdout)
    assert [e["id"] for e in as_json] == [e.id for e in entries]
    assert len(json.loads(run("history", "--json", "--limit", "1").stdout)) == 1

    rj = run("report", "latest", "--format", "json")
    assert json.loads(rj.stdout)["id"] == entries[0].id
    rid = run("report", entries[1].id, "--format", "json")
    assert json.loads(rid.stdout)["id"] == entries[1].id
    prefix = run("report", entries[1].id[:12], "--format", "json")
    assert json.loads(prefix.stdout)["id"] == entries[1].id
    rich = run("report", "latest")
    assert rich.exit_code == 0 and "72/100" in rich.output and "Top findings" in rich.output
    sarif = json.loads(run("report", "latest", "--format", "sarif").stdout)
    assert sarif["version"] == "2.1.0"


def test_report_errors(ripple_home):
    r = run("report", "latest")
    assert r.exit_code == 2 and "no saved scans" in r.output.lower()
    store.save(sample_scan())
    r = run("report", "does-not-exist")
    assert r.exit_code == 2 and "ripple history" in r.output


def test_report_is_deterministic_from_saved_scan(ripple_home):
    store.save(sample_scan())
    a = run("report", "latest", "--format", "json").stdout
    b = run("report", "scan-sample-0001", "--format", "json").stdout
    assert a == b and json.loads(a)["id"] == "scan-sample-0001"


def test_export_all_formats(ripple_home, tmp_path):
    store.save(sample_scan())
    out = {f: tmp_path / f"out.{f}" for f in ("json", "sarif", "csv", "html")}
    for fmt, path in out.items():
        r = run("export", "latest", "--format", fmt, "-o", path)
        assert r.exit_code == 0, (fmt, r.output)
        assert path.is_file() and path.stat().st_size > 100
    assert json.loads(out["json"].read_text(encoding="utf-8"))["project"] == "payments-api"
    assert json.loads(out["sarif"].read_text(encoding="utf-8"))["version"] == "2.1.0"
    rows = list(csv.DictReader(io.StringIO(out["csv"].read_text(encoding="utf-8"))))
    assert len(rows) == 5 and rows[0]["id"] == "RIP-0001"
    assert "@media print" in out["html"].read_text(encoding="utf-8")


def test_export_default_filename_and_packages_csv(ripple_home, tmp_path, monkeypatch):
    store.save(sample_scan())
    monkeypatch.chdir(tmp_path)
    r = run("export", "scan-sample-0001", "--format", "sarif")
    assert r.exit_code == 0 and (tmp_path / "ripple-scan-sample-0001.sarif").is_file()
    r = run("export", "latest", "--format", "csv", "--packages", "-o", tmp_path / "pk.csv")
    assert r.exit_code == 0
    header = (tmp_path / "pk.csv").read_text(encoding="utf-8").splitlines()[0]
    assert header.startswith("id,name,version")
    bad = run("export", "latest", "--format", "rich")
    assert bad.exit_code == 2 and "Unknown format" in bad.output


def test_export_csv_is_formula_injection_safe(ripple_home, tmp_path):
    store.save(sample_scan())
    run("export", "latest", "--format", "csv", "-o", tmp_path / "f.csv")
    text = (tmp_path / "f.csv").read_text(encoding="utf-8")
    assert "'=cmd" in text
    assert "\n=cmd" not in text and ",=cmd" not in text


def test_analyze_saved_scan_and_finding(ripple_home):
    store.save(sample_scan())
    r = run("analyze", "latest")
    assert r.exit_code == 0 and "Attack surface" in r.output and "Look-alike" in r.output and "RIP-0001" in r.output
    r = run("analyze", "scan-sample-0001", "--finding", "rip-0001")
    assert r.exit_code == 0
    for needle in ("Risk drivers", "Internal-looking name", "+30", "Evidence", "Remediation", "Package context"):
        assert needle in r.output, needle
    r = run("analyze", "latest", "--finding", "RIP-9999")
    assert r.exit_code == 2 and "Finding not found" in r.output and "RIP-0001" in r.output
    r = run("analyze", "no-such-thing")
    assert r.exit_code == 2 and "ripple history" in r.output


def test_analyze_exported_json_and_lockfile(ripple_home, fake_engine, tmp_path, lockdir):
    store.save(sample_scan())
    exp = tmp_path / "scan.json"
    assert run("export", "latest", "--format", "json", "-o", exp).exit_code == 0
    store.delete("scan-sample-0001")
    r = run("analyze", exp, "--finding", "RIP-0002")
    assert r.exit_code == 0 and "requets" in r.output
    r = run("analyze", lockdir / "package-lock.json")
    assert r.exit_code == 0 and "Attack surface" in r.output
    assert store.history() == []          # analysing a raw lockfile does not pollute history
    junk = tmp_path / "junk.txt"
    junk.write_text("x")
    assert run("analyze", junk).exit_code == 2


def test_rich_output_has_no_markup_injection(ripple_home):
    store.save(sample_scan())
    r = run("report", "latest", "--details", "5")
    assert "[bold red]Metadata[/]" in r.output


# --- demo -------------------------------------------------------------------------------------------------------------

def test_demo_command(ripple_home, fake_engine):
    r = run("demo")
    assert r.exit_code == 0, r.output
    assert "Demo mode" in r.output and "payments-api" in r.output and "72/100" in r.output
    run("demo")
    assert [e.mode for e in store.history()] == ["demo"] and fake_engine.demo_builds == 1   # idempotent
    j = run("demo", "--format", "json")
    assert json.loads(j.stdout)["mode"] == "demo"
    s = run("demo", "--format", "sarif", "--no-save")
    assert json.loads(s.stdout)["version"] == "2.1.0"
    assert run("demo", "--fail-on", "critical", "--format", "json").exit_code == 1


# --- subprocess: real entry points, Windows code pages -------------------------------------------------------

def _sub(args, home, **env):
    e = {**os.environ, "RIPPLE_HOME": str(home), "PYTHONPATH": str(REPO), **env}
    e.pop("PYTHONIOENCODING", None) if "PYTHONIOENCODING" not in env else None
    return subprocess.run([sys.executable, "-m", "ripple", *args], capture_output=True, stdin=subprocess.DEVNULL, cwd=str(REPO), env=e, timeout=120)


def test_python_dash_m_ripple_version(ripple_home):
    p = _sub(["version"], ripple_home)
    assert p.returncode == 0 and b"RIPPLE" in p.stdout


def test_history_survives_cp1252_pipes(ripple_home):
    store.save(sample_scan())
    p = _sub(["report", "latest", "--details", "3"], ripple_home, PYTHONIOENCODING="cp1252")
    assert p.returncode == 0, p.stderr.decode("cp1252", "replace")
    assert b"Traceback" not in p.stderr and b"RIPPLE Supply Chain Scanner" in p.stdout
    j = _sub(["report", "latest", "--format", "json"], ripple_home, PYTHONIOENCODING="cp1252")
    assert json.loads(j.stdout.decode("utf-8"))["id"] == "scan-sample-0001"


# --- real engine (skipped until/unless it exists) ----------------------------------------------------------------

@pytest.fixture()
def real_engine():
    pytest.importorskip("ripple.engine")


@pytest.fixture()
def real_demo(real_engine):
    demo = pytest.importorskip("ripple.demo")
    if not hasattr(demo, "build_demo_scan"):
        pytest.skip("demo dataset not available")


def test_real_scan_end_to_end(ripple_home, real_engine, lockdir, tmp_path):
    r = run("scan", lockdir, "--internal-scope", "@acme", "--format", "sarif", "-o", tmp_path / "r.sarif")
    assert r.exit_code == 0, r.output
    doc = json.loads((tmp_path / "r.sarif").read_text(encoding="utf-8"))
    assert doc["version"] == "2.1.0" and doc["runs"][0]["tool"]["driver"]["name"] == "RIPPLE"
    assert len(store.history()) == 1
    assert run("report", "latest").exit_code == 0


def test_real_demo_outputs(ripple_home, real_demo):
    r = run("demo")
    assert r.exit_code == 0, r.output
    assert "187" in r.output or "payments-api" in r.output
    data = json.loads(run("demo", "--format", "json").stdout)
    assert data["mode"] == "demo" and data["summary"]["total_dependencies"] > 100


def test_real_demo_under_cp1252(ripple_home, real_demo):
    p = _sub(["demo", "--details", "2"], ripple_home, PYTHONIOENCODING="cp1252")
    assert p.returncode == 0, p.stderr.decode("cp1252", "replace")[-500:]
    assert b"Traceback" not in p.stderr
