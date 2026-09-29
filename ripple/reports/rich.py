"""Rich terminal rendering of scan results.

Palette: graphite with violet/magenta accents (Rich degrades gracefully to 256/16 colours and to plain
text on dumb terminals). Glyphs fall back to ASCII when the output encoding cannot represent them
(e.g. Windows cp1252 pipes). All dynamic text is passed as ``Text`` so lockfile content can never be
interpreted as Rich markup.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional, Sequence

from rich import box
from rich.console import Console, Group, RenderableType
from rich.panel import Panel
from rich.table import Table
from rich.text import Text as _RichText

from ripple.config import get_version
from ripple.models import STAGES, Finding, ScanResult
from ripple.security import escape_controls

from .common import CATEGORY_LABELS, cat, eco, fmt_int, sev, sorted_findings

VIOLET = "#A78BFA"
MAGENTA = "#F472B6"
DIM = "#8B8F98"
TEXT = "#E6E7EA"
BORDER = "#4B4E57"

SEV_STYLE = {
    "critical": "bold #F0506E",
    "high": "bold #F97316",
    "medium": "#F59E0B",
    "low": "#A3E635",
    "info": "#9CA3AF",
}

TAGLINE = "RIPPLE Supply Chain Scanner"
RESPONSIBLE_USE = "For authorized security assessment only. RIPPLE is read-only: it never registers, publishes, installs or executes packages."


@dataclass(frozen=True)
class Glyphs:
    check: str
    active: str
    pending: str
    error: str
    skipped: str
    bar_full: str
    bar_empty: str
    dot: str
    arrow: str
    ellipsis: str
    unicode: bool


UNICODE = Glyphs("✓", "●", "○", "✗", "–", "█", "░", "·", "→", "…", True)
ASCII = Glyphs("v", "*", "o", "x", "-", "#", ".", "-", "->", "...", False)


def supports_unicode(console: Console) -> bool:
    enc = (console.encoding or "").lower().replace("_", "-")
    if not enc.startswith("utf"):
        return False
    return True


def glyphs_for(console: Console) -> Glyphs:
    return UNICODE if supports_unicode(console) else ASCII


def box_for(g: Glyphs):
    return box.ROUNDED if g.unicode else box.ASCII


class Text(_RichText):
    """``rich.text.Text`` that also neutralises terminal escape sequences.

    Rich only strips BEL/BS/VT/FF/CR from ``Text``; an ESC byte (CSI cursor/erase codes, OSC window-title
    writes ...) in a package name or registry description would reach the terminal untouched. Everything
    RIPPLE prints goes through this class, so such bytes are shown as a visible ``\x1b`` instead. Newlines
    are kept (the renderers build multi-line text on purpose); attacker strings are single-line by the time
    they get here (see ``ripple.security.escape_controls`` at ingestion).
    """

    def __init__(self, text="", *args, **kwargs):
        super().__init__(escape_controls(text, flatten=False) if isinstance(text, str) else text, *args, **kwargs)

    def append(self, text, style=None):
        if isinstance(text, str):
            text = escape_controls(text, flatten=False)
        return super().append(text, style)


def t(value, style: str = "") -> Text:
    """Literal, single-line text (never parsed for markup; control characters neutralised)."""
    return Text("" if value is None else escape_controls(value), style=style)


def sev_text(severity: str, g: Optional[Glyphs] = None) -> Text:
    return Text(severity.upper(), style=SEV_STYLE.get(severity, "white"))


def score_style(score: int) -> str:
    from ripple.models import severity_for_score

    return SEV_STYLE.get(severity_for_score(score).value, "white")


# ---------------------------------------------------------------------------
# Building blocks
# ---------------------------------------------------------------------------

def banner_panel(g: Glyphs, subtitle: str | None = None) -> Panel:
    title = Text.assemble((TAGLINE, f"bold {VIOLET}"), (f"  v{get_version()}", DIM))
    body = Group(title, Text(subtitle or RESPONSIBLE_USE, style=DIM))
    return Panel(body, box=box_for(g), border_style=VIOLET, padding=(0, 2))


def header_panel(result: ScanResult, g: Glyphs) -> Panel:
    grid = Table.grid(padding=(0, 2))
    grid.add_column(style=DIM, no_wrap=True)
    grid.add_column()
    files = ", ".join(result.source.files) if result.source.files else result.source.kind
    grid.add_row("Project", t(result.project, f"bold {TEXT}"))
    grid.add_row("Scan", t(result.id, VIOLET))
    grid.add_row("Mode", t(result.mode, MAGENTA if result.mode == "live" else TEXT))
    grid.add_row("Sources", t(files if len(files) < 120 else files[:117] + g.ellipsis))
    grid.add_row("Duration", t(f"{result.duration_ms / 1000:.2f}s"))
    grid.add_row("Created", t(result.created_at))
    return Panel(grid, title=Text("Scan", style=f"bold {VIOLET}"), title_align="left", box=box_for(g),
                 border_style=BORDER, padding=(0, 1))


def stage_lines(states: dict[str, tuple[str, str]], g: Glyphs) -> Text:
    """Stage checklist. ``states``: stage_id -> (state, detail). ✓ done, ● active, ○ pending."""
    out = Text()
    for i, (sid, label) in enumerate(STAGES):
        state, detail = states.get(sid, ("pending", ""))
        if state == "done":
            mark, style = g.check, "#A3E635"
        elif state == "active":
            mark, style = g.active, f"bold {MAGENTA}"
        elif state == "error":
            mark, style = g.error, SEV_STYLE["critical"]
        elif state == "skipped":
            mark, style = g.skipped, DIM
        else:
            mark, style = g.pending, DIM
        out.append(f" {mark} ", style=style)
        out.append(label, style=TEXT if state in ("done", "active") else DIM)
        if detail and state in ("done", "active", "error", "skipped"):
            out.append(f"  {g.dot} {detail}", style=DIM)
        if i < len(STAGES) - 1:
            out.append("\n")
    return out


def risk_bar(score: int, label: str, g: Glyphs, width: int = 30) -> Text:
    filled = round(width * max(0, min(100, score)) / 100)
    style = SEV_STYLE.get(label, "white")
    out = Text()
    out.append(f"{score}/100", style=f"bold {style}")
    out.append("  ")
    out.append(g.bar_full * filled, style=style)
    out.append(g.bar_empty * (width - filled), style=BORDER)
    out.append(f"  {label.upper()}", style=style)
    return out


def severity_table(result: ScanResult, g: Glyphs) -> Table:
    counts = result.summary.severity_counts
    tbl = Table(box=box_for(g), border_style=BORDER, title=Text("Severity summary", style=f"bold {VIOLET}"),
                title_justify="left", header_style=DIM)
    tbl.add_column("Severity")
    tbl.add_column("Findings", justify="right")
    tbl.add_column("Share", min_width=12)
    total = max(1, result.summary.total_findings)
    for name in ("critical", "high", "medium", "low", "info"):
        n = getattr(counts, name)
        share = round(10 * n / total)
        bar = Text(g.bar_full * share, style=SEV_STYLE[name]) + Text(g.bar_empty * (10 - share), style=BORDER)
        tbl.add_row(sev_text(name, g), t(n, SEV_STYLE[name] if n else DIM), bar)
    return tbl


def attack_surface_table(result: ScanResult, g: Glyphs) -> Table:
    a = result.summary.attack_surface
    tbl = Table(box=box_for(g), border_style=BORDER, title=Text("Attack surface", style=f"bold {VIOLET}"),
                title_justify="left", header_style=DIM)
    tbl.add_column("Category")
    tbl.add_column("Findings", justify="right")
    for label, n in (
        ("Dependency confusion", a.dependency_confusion),
        ("Typosquatting", a.typosquatting),
        ("Suspicious metadata", a.suspicious_metadata),
        ("Registry exposure", a.registry_exposure),
    ):
        tbl.add_row(label, t(n, MAGENTA if n else DIM))
    return tbl


def findings_table(findings: Sequence[Finding], g: Glyphs, top: int | None = 10, title: str = "Top findings") -> Table:
    tbl = Table(box=box_for(g), border_style=BORDER, title=Text(title, style=f"bold {VIOLET}"),
                title_justify="left", header_style=DIM, expand=False)
    tbl.add_column("ID", no_wrap=True, style=VIOLET)
    tbl.add_column("Sev", no_wrap=True)
    tbl.add_column("Score", justify="right", no_wrap=True)
    tbl.add_column("Package", overflow="fold", max_width=34)
    tbl.add_column("Eco", no_wrap=True, style=DIM)
    tbl.add_column("Category", overflow="fold", max_width=24)
    rows = sorted_findings(findings)
    if top is not None:
        rows = rows[:top]
    for f in rows:
        s = sev(f.severity)
        tbl.add_row(
            t(f.id), sev_text(s, g), t(f.risk_score, SEV_STYLE.get(s, "white")),
            Text.assemble((f.package, TEXT), (f"@{f.version}" if f.version else "", DIM)),
            t(eco(f.ecosystem)), t(CATEGORY_LABELS.get(cat(f.category), cat(f.category))),
        )
    return tbl


def ecosystem_table(result: ScanResult, g: Glyphs) -> Table:
    tbl = Table(box=box_for(g), border_style=BORDER, title=Text("Ecosystems", style=f"bold {VIOLET}"),
                title_justify="left", header_style=DIM)
    for col, just in (("Ecosystem", "left"), ("Deps", "right"), ("Internal", "right"), ("Confusion", "right"),
                      ("Typo", "right"), ("Meta", "right"), ("Exposure", "right"), ("Risk", "right")):
        tbl.add_column(col, justify=just, no_wrap=True)
    for es in result.ecosystems:
        risk_label = "info"
        from ripple.models import severity_for_score
        risk_label = severity_for_score(es.risk_score).value
        tbl.add_row(
            t(eco(es.ecosystem), f"bold {TEXT}"), t(es.total), t(es.internal_looking), t(es.confusion),
            t(es.typosquat), t(es.suspicious), t(es.exposure), t(es.risk_score, SEV_STYLE[risk_label]),
        )
    return tbl


def finding_panel(f: Finding, g: Glyphs) -> Panel:
    s = sev(f.severity)
    parts: list[RenderableType] = []
    head = Text()
    head.append(f"{f.package}", style=f"bold {TEXT}")
    head.append(f"@{f.version}" if f.version else "", style=DIM)
    head.append(f"  ({eco(f.ecosystem)})", style=DIM)
    head.append("   ")
    head.append(f"{s.upper()} {f.risk_score}/100", style=SEV_STYLE.get(s, "white"))
    head.append(f"  confidence {round(f.confidence * 100)}%", style=DIM)
    parts.append(head)
    parts.append(Text(""))
    parts.append(t(f.summary))

    def section(title: str, body: RenderableType) -> None:
        parts.append(Text(""))
        parts.append(Text(title, style=f"bold {MAGENTA}"))
        parts.append(body)

    if f.why_flagged:
        section("Why flagged", t(f.why_flagged))
    if f.attack_vector:
        section("Attack vector", t(f.attack_vector))
    if f.evidence:
        ev = Table.grid(padding=(0, 2))
        ev.add_column(style=DIM, no_wrap=True)
        ev.add_column(overflow="fold")
        for item in f.evidence:
            ev.add_row(t(item.label), t(item.value, TEXT if item.mono else ""))
        section("Evidence", ev)
    if f.drivers:
        dr = Table.grid(padding=(0, 2))
        dr.add_column(justify="right", no_wrap=True)
        dr.add_column(overflow="fold")
        for d in f.drivers:
            dr.add_row(t(f"{d.points:+d}", "#F0506E" if d.points > 0 else "#A3E635"),
                       Text.assemble((d.label, TEXT), (f"  {d.detail}" if d.detail else "", DIM)))
        dr.add_row(t(f.risk_score, f"bold {SEV_STYLE.get(s, 'white')}"), t("Total risk score", DIM))
        section("Risk drivers", dr)
    if f.remediation:
        rem = Text()
        for i, r in enumerate(f.remediation, 1):
            rem.append(f"{i}. ", style=VIOLET)
            rem.append(r.title, style=f"bold {TEXT}")
            rem.append(f" {g.dot} {r.detail}\n" if r.detail else "\n", style=DIM)
        rem.rstrip()
        section("Remediation", rem)
    source = Text()
    if f.dependency_source:
        source.append(f"lockfile {f.dependency_source}", style=DIM)
    if f.rule_id:
        source.append(f"   rule {f.rule_id}", style=DIM)
    if source:
        parts.append(Text(""))
        parts.append(source)
    title = Text.assemble((f.id, f"bold {VIOLET}"), (f" {g.dot} ", DIM), (f.title, TEXT))
    return Panel(Group(*parts), title=title, title_align="left", box=box_for(g),
                 border_style=SEV_STYLE.get(s, BORDER).replace("bold ", ""), padding=(1, 2))


# ---------------------------------------------------------------------------
# Full report
# ---------------------------------------------------------------------------

def stage_states_for(result: ScanResult) -> dict[str, tuple[str, str]]:
    """Reconstruct the stage checklist of a finished scan from what it recorded."""
    s = result.summary
    checks = set(result.options.checks)
    states: dict[str, tuple[str, str]] = {sid: ("done", "") for sid, _ in STAGES}
    states["discover"] = ("done", f"{s.total_dependencies} dependencies")
    if result.mode == "offline" or "offline" in " ".join(result.warnings).lower():
        states["registry"] = ("skipped", "offline - registry lookups skipped")
    elif result.mode == "live":
        states["registry"] = ("done", "public registries queried (read-only)")
    if "typosquat" not in checks:
        states["typosquat"] = ("skipped", "check disabled")
    if not checks & {"metadata", "confusion", "exposure"}:
        states["metadata"] = ("skipped", "no metadata checks selected")
    states["score"] = ("done", f"{s.total_findings} findings")
    states["graph"] = ("done", f"{len(result.edges)} dependency edges")
    return states


def render_scan(result: ScanResult, console: Console, top: int = 10, details: int = 0,
                show_stages: bool = True, show_banner: bool = True) -> None:
    """Print the complete scan report to ``console``."""
    g = glyphs_for(console)
    if show_banner:
        console.print(banner_panel(g))
    console.print(header_panel(result, g))
    if show_stages:
        console.print(Panel(stage_lines(stage_states_for(result), g), title=Text("Pipeline", style=f"bold {VIOLET}"),
                            title_align="left", box=box_for(g), border_style=BORDER, padding=(0, 1)))

    summary = result.summary
    label = sev(summary.risk_label)
    overall = Text.assemble(("Overall risk  ", DIM), risk_bar(summary.risk_score, label, g))
    console.print(Panel(overall, box=box_for(g), border_style=SEV_STYLE.get(label, BORDER).replace("bold ", ""),
                        padding=(0, 2)))
    if summary.score_drivers:
        drv = Table.grid(padding=(0, 1))
        drv.add_column(no_wrap=True)
        drv.add_column(overflow="fold")
        for d in summary.score_drivers:
            drv.add_row(Text(f"  {g.dot}", style=MAGENTA), Text(d, style=TEXT))
        console.print(drv)
        console.print()

    console.print(severity_table(result, g))
    console.print(attack_surface_table(result, g))
    if result.ecosystems:
        console.print(ecosystem_table(result, g))
    if result.findings:
        console.print(findings_table(result.findings, g, top=top))
        extra = len(result.findings) - top
        if extra > 0:
            console.print(Text(f"  {g.dot} {extra} more finding(s). Use `ripple analyze <scan> --finding <ID>` or export the full report.",
                               style=DIM))
        for f in sorted_findings(result.findings)[:details]:
            console.print(finding_panel(f, g))
    else:
        console.print(Text(f"  {g.check} No findings. Nothing suspicious was detected.", style="#A3E635"))

    for w in result.warnings:
        console.print(Text.assemble((f"  ! ", "bold #F59E0B"), (w, "#F59E0B")))
    console.print(Text(RESPONSIBLE_USE, style=DIM))


def render_analysis(result: ScanResult, console: Console, top: int = 5) -> None:
    """Deep-dive: attack-surface breakdown, look-alike groups and the top finding panels."""
    g = glyphs_for(console)
    console.print(header_panel(result, g))
    console.print(attack_surface_table(result, g))
    if result.lookalikes:
        tbl = Table(box=box_for(g), border_style=BORDER, title=Text("Look-alike groups", style=f"bold {VIOLET}"),
                    title_justify="left", header_style=DIM)
        tbl.add_column("Original")
        tbl.add_column("Candidate", overflow="fold")
        tbl.add_column("Mutation")
        tbl.add_column("Dist", justify="right")
        tbl.add_column("Registered")
        tbl.add_column("Suspicion", justify="right")
        for grp in result.lookalikes[:8]:
            for c in grp.candidates[:6]:
                tbl.add_row(t(grp.original, VIOLET), t(c.name), t(c.mutation), t(c.distance),
                            t("yes" if c.registered else "no", MAGENTA if c.registered else DIM),
                            t(c.suspicion_score, SEV_STYLE.get(sev(c.severity), "white")))
        console.print(tbl)
    for f in sorted_findings(result.findings)[:top]:
        console.print(finding_panel(f, g))
    if not result.findings:
        console.print(Text(f"  {g.check} No findings to analyse.", style="#A3E635"))


def render_history(entries: Iterable, console: Console) -> None:
    g = glyphs_for(console)
    tbl = Table(box=box_for(g), border_style=BORDER, title=Text("Scan history", style=f"bold {VIOLET}"),
                title_justify="left", header_style=DIM)
    tbl.add_column("Scan ID", style=VIOLET, no_wrap=True)
    tbl.add_column("Project", overflow="ellipsis", no_wrap=True, min_width=6)
    tbl.add_column("Created", no_wrap=True)
    wide = console.width >= 100
    if wide:
        tbl.add_column("Mode", no_wrap=True)
    tbl.add_column("Deps", justify="right", no_wrap=True)
    tbl.add_column("Finds", justify="right", no_wrap=True)
    tbl.add_column("Risk", justify="right", no_wrap=True)
    if wide:
        tbl.add_column("Ecosystems", style=DIM, overflow="ellipsis", no_wrap=True, min_width=6)
    n = 0
    for e in entries:
        n += 1
        label = sev(e.risk_label)
        row = [t(e.id), t(e.project), t(e.created_at[:16].replace("T", " "))]
        if wide:
            row.append(t(e.mode))
        row += [t(fmt_int(e.dependencies)), t(fmt_int(e.findings)), t(f"{e.risk_score}", SEV_STYLE.get(label, "white"))]
        if wide:
            row.append(t(",".join(e.ecosystems)))
        tbl.add_row(*row)
    if n == 0:
        console.print(Text("No saved scans yet. Run `ripple scan <lockfile>` or `ripple demo`.", style=DIM))
    else:
        console.print(tbl)


def render_to_text(result: ScanResult, width: int = 110, top: int = 10, details: int = 0) -> str:
    """Render the report to plain text (no colour) - used for ``-o file`` with the rich format."""
    import io

    buf = io.StringIO()
    console = Console(file=buf, width=width, force_terminal=False, color_system=None, legacy_windows=False,
                      highlight=False)
    # Force ASCII-safe glyphs only when the caller's file cannot encode; here we always write UTF-8 files.
    render_scan(result, console, top=top, details=details)
    return buf.getvalue()
