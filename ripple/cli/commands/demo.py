from pathlib import Path
from typing import Optional

import typer

from ripple.cli.output.console import out, set_debug
from ripple.cli.output.emit import apply_fail_on, emit, validate_format, validate_severity
from ripple.cli.output.errors import guarded
from ripple.reports.rich import banner_panel, glyphs_for
from ripple.server import store

from .serve import run_server


@guarded
def demo(
    format: str = typer.Option("rich", "--format", "-f", help="rich, json, sarif, csv or html."),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Write the report to a file instead of stdout."),
    serve: bool = typer.Option(False, "--serve", help="After the demo, start the dashboard and open it in your browser."),
    port: int = typer.Option(8787, "--port", "-p", help="Port for --serve."),
    no_save: bool = typer.Option(False, "--no-save", help="Do not add the demo scan to the history."),
    top: int = typer.Option(10, "--top", min=1, help="Findings shown in the rich summary table."),
    details: int = typer.Option(0, "--details", min=0, help="Also print detail panels for the top N findings (rich)."),
    fail_on: Optional[str] = typer.Option(None, "--fail-on", help="Exit 1 when any finding is at or above this severity."),
    debug: bool = typer.Option(False, "--debug", help="Show technical details on errors."),
) -> None:
    """Run the built-in offline demo scan (synthetic 'payments-api' project, no network)."""
    set_debug(debug)
    fmt = validate_format(format)
    fail_on = validate_severity(fail_on)
    if no_save:
        from ripple.demo import build_demo_scan

        result = build_demo_scan()
    else:
        result = store.ensure_demo()
    if fmt == "rich" and output is None:
        out().print(banner_panel(glyphs_for(out()), "Demo mode: synthetic offline dataset. No network access, no real packages."))
    emit(result, fmt, output, top=top, details=details, show_banner=False)
    code = apply_fail_on(result, fail_on)
    if serve:
        if no_save:
            store.save(result)
        run_server(port=port, open_browser=True)
    if code:
        raise typer.Exit(code)
