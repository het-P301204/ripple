import csv
import io
import json
import re

from rich.console import Console

from helpers_sample import sample_scan
from ripple.reports import render
from ripple.reports.csv import findings_csv, packages_csv, safe_cell
from ripple.reports.html import to_html
from ripple.reports.json import to_json
from ripple.reports.rich import ASCII, UNICODE, render_analysis, render_scan, render_to_text


def test_json_is_stable_sorted_and_pretty():
    scan = sample_scan()
    a, b = to_json(scan), to_json(sample_scan())
    assert a == b
    assert a.startswith("{\n  ")
    data = json.loads(a)
    assert list(data.keys()) == sorted(data.keys())
    assert data["summary"]["risk_score"] == 72
    from ripple.models import ScanResult

    assert ScanResult.model_validate(data).id == scan.id


def test_csv_formula_injection_is_neutralised():
    assert safe_cell("=1+1") == "'=1+1"
    assert safe_cell("+cmd") == "'+cmd"
    assert safe_cell("-2+3") == "'-2+3"
    assert safe_cell("@SUM(A1)") == "'@SUM(A1)"
    assert safe_cell("\t=x") == "'\t=x"
    assert safe_cell("normal") == "normal"
    assert safe_cell(-5) == -5          # real numbers untouched
    assert safe_cell(None) == ""
    text = findings_csv(sample_scan())
    rows = list(csv.reader(io.StringIO(text)))
    header, body = rows[0], rows[1:]
    assert len(body) == 5
    pkg_col = header.index("package")
    for row in body:
        for cell in row:
            assert not cell.startswith(("=", "+", "@")), cell
    assert any(r[pkg_col].startswith("'=cmd") for r in body)
    assert any(r[header.index("summary")].startswith("'+") for r in body)


def test_csv_is_parseable_and_sorted_by_risk():
    rows = list(csv.DictReader(io.StringIO(findings_csv(sample_scan()))))
    scores = [int(r["risk_score"]) for r in rows]
    assert scores == sorted(scores, reverse=True)
    prows = list(csv.DictReader(io.StringIO(packages_csv(sample_scan()))))
    assert len(prows) == 3 and prows[0]["ecosystem"] == "npm"


def test_html_is_self_contained_and_escaped():
    html = to_html(sample_scan())
    assert html.startswith("<!doctype html>")
    assert "@media print" in html
    assert "RIP-0001" in html
    assert "Remediation" in html and "Risk drivers" in html
    assert not re.search(r"(src|href)=['\"]https?://", html)
    assert "<script" not in html.lower()
    assert "@import" not in html and "url(http" not in html
    scan = sample_scan()
    scan.findings[0].summary = "<script>alert(1)</script>"
    out = to_html(scan)
    assert "<script>alert(1)</script>" not in out
    assert "&lt;script&gt;" in out


def test_rich_render_does_not_crash_and_shows_key_sections():
    buf = io.StringIO()
    console = Console(file=buf, width=120, force_terminal=False, color_system=None)
    render_scan(sample_scan(), console, top=3, details=1)
    text = buf.getvalue()
    for needle in ("RIPPLE Supply Chain Scanner", "72/100", "Severity summary", "Top findings", "Ecosystems",
                   "Risk drivers", "Remediation", "Lockfile parsed", "RIP-0001"):
        assert needle in text, needle
    assert "more finding" in text  # 5 findings, top=3


def test_rich_does_not_interpret_markup_in_package_data():
    buf = io.StringIO()
    render_scan(sample_scan(), Console(file=buf, width=140, force_terminal=False, color_system=None), top=10, details=5)
    assert "[bold red]Metadata[/]" in buf.getvalue()


def test_rich_renders_on_cp1252_pipe_with_ascii_fallback():
    raw = io.BytesIO()
    stream = io.TextIOWrapper(raw, encoding="cp1252", errors="strict", write_through=True)
    console = Console(file=stream, width=100, force_terminal=False, color_system=None)
    render_scan(sample_scan(), console, details=1)   # must not raise UnicodeEncodeError
    render_analysis(sample_scan(), console)
    stream.flush()
    assert b"RIPPLE Supply Chain Scanner" in raw.getvalue()


def test_glyph_sets_are_distinct():
    assert UNICODE.check != ASCII.check and ASCII.unicode is False


def test_render_dispatch_and_text_output():
    scan = sample_scan()
    assert json.loads(render(scan, "json"))["id"] == scan.id
    assert json.loads(render(scan, "sarif"))["version"] == "2.1.0"
    assert render(scan, "csv").splitlines()[0].startswith("id,severity")
    assert "<html" in render(scan, "html")
    assert "72/100" in render(scan, "rich")
    assert render(scan, "rich") == render_to_text(scan)
