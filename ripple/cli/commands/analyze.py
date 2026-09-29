import asyncio
from pathlib import Path
from typing import Optional

import typer
from rich.panel import Panel
from rich.table import Table

from ripple.cli.output.console import err, out, set_debug
from ripple.cli.output.errors import CliError, guarded
from ripple.models import ScanResult
from ripple.reports.common import sev
from ripple.reports.rich import (
    BORDER, DIM, SEV_STYLE, TEXT, VIOLET, Text, box_for, finding_panel, glyphs_for, render_analysis, t,
)
from ripple.server import store


def _load_target(target: str) -> ScanResult:
    """A saved scan id / 'latest', a ScanResult JSON export, or a lockfile (scanned offline, not saved)."""
    try:
        return store.resolve(target)
    except store.ScanNotFound:
        pass
    path = Path(target)
    if path.is_file():
        raw = path.read_bytes()
        try:
            return ScanResult.model_validate_json(raw)
        except Exception:
            pass
        from ripple.cli.files import display_path
        from ripple.engine import ScanInput, detect, run_scan  # engine-owned
        from ripple.models import ScanOptions

        disp = display_path(path)
        info = detect(disp, raw)
        info = info if isinstance(info, dict) else getattr(info, "model_dump", lambda: dict(vars(info)))()
        if not info.get("supported"):
            from ripple.cli.commands.scan import unsupported_guidance

            unsupported_guidance([path.name])
            raise typer.Exit(2)
        err().print(Text("Analysing lockfile offline (not saved to history).", style=DIM))
        return asyncio.run(run_scan([ScanInput(filename=disp, content=raw)], ScanOptions(),
                                    project=path.resolve().parent.name or "project"))
    if target == "latest":
        raise CliError("There are no saved scans yet.", "Run `ripple scan <lockfile>` or `ripple demo` first.", title="No scans")
    raise CliError(f"'{target}' is neither a saved scan id nor a readable file.",
                   "List saved scans with `ripple history`.", title="Nothing to analyse")


def _package_panel(result: ScanResult, package_id: str, console) -> None:
    pkg = next((p for p in result.packages if p.id == package_id), None)
    if pkg is None:
        return
    g = glyphs_for(console)
    tbl = Table.grid(padding=(0, 2))
    tbl.add_column(style=DIM, no_wrap=True)
    tbl.add_column(overflow="fold")
    tbl.add_row("Package", t(f"{pkg.name}@{pkg.version}", TEXT))
    tbl.add_row("Resolution", t(sev(pkg.resolution)))
    tbl.add_row("Integrity", t(pkg.integrity or "none"))
    tbl.add_row("Registry source", t(pkg.registry_source or pkg.registry))
    tbl.add_row("Public status", t(sev(pkg.public_status)))
    tbl.add_row("Direct / dev", t(f"{pkg.direct} / {pkg.dev}  (depth {pkg.depth}, {pkg.dependents_count} dependents)"))
    m = pkg.metadata
    if m:
        tbl.add_row("Registered", t(m.registered_at or "-"))
        tbl.add_row("Weekly downloads", t(f"{m.weekly_downloads:,}" if m.weekly_downloads is not None else "-"))
        tbl.add_row("Maintainers", t(", ".join(m.maintainers) or "-"))
        if m.install_scripts.any():
            scripts = [k for k in ("preinstall", "install", "postinstall", "prepare") if getattr(m.install_scripts, k)]
            tbl.add_row("Install scripts", t(", ".join(scripts) + (" + build script" if m.install_scripts.build_script else ""), "#F59E0B"))
        for ind in m.network_indicators:
            tbl.add_row("Network indicator", t(ind, "#F97316"))
    console.print(Panel(tbl, title=Text("Package context", style=f"bold {VIOLET}"), title_align="left",
                        box=box_for(g), border_style=BORDER, padding=(0, 1)))
    dependents = [e.source for e in result.edges if e.target == package_id][:8]
    if dependents:
        console.print(Text("  Pulled in by: " + ", ".join(dependents), style=DIM))


@guarded
def analyze(
    target: str = typer.Argument(..., help="Saved scan id / 'latest', an exported scan JSON, or a lockfile (scanned offline)."),
    finding: Optional[str] = typer.Option(None, "--finding", "-F", help="Deep-dive one finding, e.g. RIP-0001."),
    top: int = typer.Option(5, "--top", min=1, help="Finding panels to show when no --finding is given."),
    debug: bool = typer.Option(False, "--debug", help="Show technical details on errors."),
) -> None:
    """Deep-dive a saved scan or a single finding (drivers, evidence, remediation)."""
    set_debug(debug)
    result = _load_target(target)
    console = out()
    if finding:
        wanted = finding.strip().upper()
        f = next((x for x in result.findings if x.id.upper() == wanted), None)
        if f is None:
            ids = ", ".join(x.id for x in result.findings[:8]) or "none"
            raise CliError(f"Finding '{finding}' does not exist in scan {result.id}.",
                           f"Available findings include: {ids}.", title="Finding not found")
        g = glyphs_for(console)
        console.print(finding_panel(f, g))
        _package_panel(result, f.package_id, console)
        group = next((grp for grp in result.lookalikes if grp.original == f.package or
                      any(c.name == f.package for c in grp.candidates)), None)
        if group:
            tbl = Table(box=box_for(g), border_style=BORDER,
                        title=Text(f"Look-alikes of {group.original}", style=f"bold {VIOLET}"),
                        title_justify="left", header_style=DIM)
            for col in ("Candidate", "Mutation", "Dist", "Registered", "Suspicion"):
                tbl.add_column(col)
            for c in group.candidates[:8]:
                tbl.add_row(t(c.name), t(c.mutation), t(c.distance), t("yes" if c.registered else "no"),
                            t(c.suspicion_score, SEV_STYLE.get(sev(c.severity), "white")))
            console.print(tbl)
        return
    render_analysis(result, console, top=top)
