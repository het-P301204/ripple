"""Standalone, print-ready HTML report (single file, no external resources, light theme)."""
from __future__ import annotations

from html import escape as _esc

from ripple.config import get_version
from ripple.models import Finding, ScanResult

from .common import CATEGORY_LABELS, cat, eco, fmt_int, sev, sorted_findings

SEV_COLORS = {
    "critical": ("#B4233F", "#FDECEF"),
    "high": ("#C2570C", "#FFF1E6"),
    "medium": ("#A16207", "#FEF6DB"),
    "low": ("#4D7C0F", "#F0F8E1"),
    "info": ("#52525B", "#F1F1F3"),
}

CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"

_CSS = """
:root{--ink:#16171A;--mute:#5B5F68;--line:#E4E5E9;--card:#FFFFFF;--bg:#F5F5F7;--accent:#7C3AED;--accent2:#DB2777}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:32px 24px 56px}
h1{font-size:26px;margin:0 0 4px;letter-spacing:-.02em}
h2{font-size:17px;margin:34px 0 12px;letter-spacing:-.01em}
h3{font-size:15px;margin:0}
.brand{display:flex;align-items:center;gap:10px;color:var(--accent);font-weight:700;letter-spacing:.08em;font-size:12px;text-transform:uppercase}
.brand i{display:inline-block;width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2))}
.sub{color:var(--mute);margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 20px;margin:0 0 14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.stat b{display:block;font-size:24px;letter-spacing:-.02em}
.stat span{color:var(--mute);font-size:12px}
.score{display:flex;align-items:center;gap:20px}
.score .num{font-size:48px;font-weight:800;letter-spacing:-.04em;line-height:1}
.bar{height:10px;background:#ECECEF;border-radius:999px;overflow:hidden;margin-top:8px}
.bar>div{height:100%;border-radius:999px}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
table{width:100%;border-collapse:collapse}
th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
td{padding:7px 8px;border-bottom:1px solid #F0F0F3;vertical-align:top}
tr:last-child td{border-bottom:0}
.finding{page-break-inside:avoid;break-inside:avoid}
.finding header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:6px}
.muted{color:var(--mute)}
.kv{display:grid;grid-template-columns:160px 1fr;gap:4px 12px;margin:8px 0}
.kv dt{color:var(--mute);font-size:12px}
.kv dd{margin:0;word-break:break-word}
ul{margin:6px 0 0;padding-left:18px}
.pts{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.foot{margin-top:36px;color:var(--mute);font-size:12px;border-top:1px solid var(--line);padding-top:12px}
@media print{
  body{background:#fff}.wrap{max-width:none;padding:0}
  .card,.stat{box-shadow:none}
  h2{page-break-after:avoid;break-after:avoid}
  @page{margin:14mm}
}
"""


def e(x) -> str:
    return _esc("" if x is None else str(x), quote=True)


def _pill(severity: str) -> str:
    fg, bg = SEV_COLORS.get(severity, SEV_COLORS["info"])
    return f'<span class="pill" style="color:{fg};background:{bg}">{e(severity)}</span>'


def _score_color(label: str) -> str:
    return SEV_COLORS.get(label, SEV_COLORS["info"])[0]


def _finding_card(f: Finding) -> str:
    s = sev(f.severity)
    parts = [
        '<section class="card finding">',
        f'<header><div><h3>{e(f.title)} <span class="muted mono">{e(f.id)}</span></h3>'
        f'<div class="mono">{e(f.package)}@{e(f.version)} '
        f'<span class="muted">({e(eco(f.ecosystem))})</span></div></div>'
        f'<div style="text-align:right">{_pill(s)}<div class="muted" style="margin-top:4px">'
        f'risk {f.risk_score}/100 &middot; confidence {round(f.confidence * 100)}%</div></div></header>',
        f"<p>{e(f.summary)}</p>",
    ]
    facts = [
        ("Category", CATEGORY_LABELS.get(cat(f.category), cat(f.category))),
        ("Why flagged", f.why_flagged),
        ("Attack vector", f.attack_vector),
        ("Lockfile", f.dependency_source),
        ("Registry", f.registry),
        ("Resolution", f.resolution_type),
        ("Public status", f.public_status),
        ("Related package", f.related_package or ""),
        ("Rule", f.rule_id),
    ]
    parts.append("<dl class='kv'>" + "".join(
        f"<dt>{e(k)}</dt><dd>{e(v)}</dd>" for k, v in facts if v) + "</dl>")
    if f.evidence:
        parts.append("<h3 style='margin-top:10px'>Evidence</h3><table><tbody>" + "".join(
            f"<tr><td class='muted' style='width:200px'>{e(ev.label)}</td>"
            f"<td class='{'mono' if ev.mono else ''}'>{e(ev.value)}</td></tr>" for ev in f.evidence) +
            "</tbody></table>")
    if f.drivers:
        parts.append("<h3 style='margin-top:10px'>Risk drivers</h3><table><tbody>" + "".join(
            f"<tr><td>{e(d.label)}<div class='muted'>{e(d.detail)}</div></td>"
            f"<td class='pts mono'>{d.points:+d}</td></tr>" for d in f.drivers) +
            f"<tr><td><b>Total</b></td><td class='pts mono'><b>{f.risk_score}</b></td></tr></tbody></table>")
    if f.remediation:
        parts.append("<h3 style='margin-top:10px'>Remediation</h3><ul>" + "".join(
            f"<li><b>{e(r.title)}</b> &mdash; {e(r.detail)}</li>" for r in f.remediation) + "</ul>")
    parts.append("</section>")
    return "".join(parts)


def to_html(result: ScanResult, max_findings: int | None = None) -> str:
    s = result.summary
    label = sev(s.risk_label)
    color = _score_color(label)
    findings = sorted_findings(result.findings)
    shown = findings if max_findings is None else findings[:max_findings]
    counts = s.severity_counts
    version = result.version or get_version()

    stats = [
        ("Dependencies", fmt_int(s.total_dependencies)), ("Direct", fmt_int(s.direct_dependencies)),
        ("Ecosystems", fmt_int(s.ecosystems)), ("Findings", fmt_int(s.total_findings)),
        ("Dependency confusion", fmt_int(s.confusion_candidates)),
        ("Typosquatting", fmt_int(s.typosquat_candidates)),
        ("Suspicious metadata", fmt_int(s.suspicious_metadata)),
        ("Registry exposure", fmt_int(s.registry_exposure)),
    ]

    out = [
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>",
        # Defence in depth: the report contains attacker-influenced strings (all HTML-escaped). This CSP makes
        # a missed escape inert - no script of any kind may run, nothing external may load.
        f"<meta http-equiv='Content-Security-Policy' content=\"{CSP}\">",
        "<meta name='referrer' content='no-referrer'>",
        "<meta name='viewport' content='width=device-width,initial-scale=1'>",
        f"<title>RIPPLE report - {e(result.project)}</title>",
        f"<style>{_CSS}</style></head><body><div class='wrap'>",
        "<div class='brand'><i></i>RIPPLE &middot; Supply Chain Scanner</div>",
        f"<h1>Supply chain risk report: {e(result.project)}</h1>",
        f"<p class='sub'>Scan <span class='mono'>{e(result.id)}</span> &middot; {e(result.mode)} mode &middot; "
        f"{e(result.created_at)} &middot; {result.duration_ms} ms &middot; RIPPLE {e(version)}</p>",
        "<section class='card score'>",
        f"<div><div class='num' style='color:{color}'>{s.risk_score}<span class='muted' style='font-size:20px'>/100</span></div>"
        f"<div>{_pill(label)} overall risk</div></div>",
        f"<div style='flex:1'><div class='bar'><div style='width:{max(0, min(100, s.risk_score))}%;background:{color}'></div></div>",
    ]
    if s.score_drivers:
        out.append("<ul>" + "".join(f"<li>{e(d)}</li>" for d in s.score_drivers) + "</ul>")
    out.append("</div></section>")

    out.append("<div class='grid'>" + "".join(
        f"<div class='stat'><b>{e(v)}</b><span>{e(k)}</span></div>" for k, v in stats) + "</div>")

    out.append("<h2>Severity summary</h2><section class='card'><table><thead><tr><th>Severity</th><th class='pts'>Findings</th></tr></thead><tbody>")
    for name in ("critical", "high", "medium", "low", "info"):
        out.append(f"<tr><td>{_pill(name)}</td><td class='pts mono'>{getattr(counts, name)}</td></tr>")
    out.append("</tbody></table></section>")

    if result.ecosystems:
        out.append("<h2>Ecosystems</h2><section class='card'><table><thead><tr><th>Ecosystem</th><th>Lockfiles</th>"
                   "<th class='pts'>Deps</th><th class='pts'>Internal</th><th class='pts'>Confusion</th>"
                   "<th class='pts'>Typosquat</th><th class='pts'>Metadata</th><th class='pts'>Exposure</th>"
                   "<th class='pts'>Risk</th></tr></thead><tbody>")
        for es in result.ecosystems:
            out.append(
                f"<tr><td><b>{e(eco(es.ecosystem))}</b></td><td class='mono'>{e(', '.join(es.lockfiles))}</td>"
                f"<td class='pts'>{es.total}</td><td class='pts'>{es.internal_looking}</td>"
                f"<td class='pts'>{es.confusion}</td><td class='pts'>{es.typosquat}</td>"
                f"<td class='pts'>{es.suspicious}</td><td class='pts'>{es.exposure}</td>"
                f"<td class='pts'><b>{es.risk_score}</b></td></tr>")
        out.append("</tbody></table></section>")

    if result.warnings:
        out.append("<h2>Warnings</h2><section class='card'><ul>" +
                   "".join(f"<li>{e(w)}</li>" for w in result.warnings) + "</ul></section>")

    out.append(f"<h2>Findings ({len(findings)})</h2>")
    if not shown:
        out.append("<section class='card muted'>No findings. Nothing suspicious was detected in the analysed lockfiles.</section>")
    for f in shown:
        out.append(_finding_card(f))
    if len(shown) < len(findings):
        out.append(f"<p class='muted'>{len(findings) - len(shown)} additional lower-risk findings omitted.</p>")

    out.append(
        "<div class='foot'>Generated by RIPPLE. Read-only analysis for authorized security assessment: RIPPLE never "
        "registers, publishes, installs or executes packages. Heuristic findings require human review; "
        "offline-mode registry facts are synthetic or unverified.</div>")
    out.append("</div></body></html>")
    return "".join(out)
