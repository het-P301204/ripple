from pathlib import Path
from typing import Optional

import typer

from ripple.cli.output.console import set_debug
from ripple.cli.output.emit import apply_fail_on, emit, validate_format, validate_severity
from ripple.cli.output.errors import guarded

from ._common import resolve_scan


@guarded
def report(
    scan_id: str = typer.Argument("latest", help="Saved scan id (or unique prefix), or 'latest'."),
    format: str = typer.Option("rich", "--format", "-f", help="rich, json, sarif, csv or html."),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Write to a file instead of stdout."),
    top: int = typer.Option(10, "--top", min=1, help="Findings shown in the rich summary table."),
    details: int = typer.Option(0, "--details", min=0, help="Also print detail panels for the top N findings (rich)."),
    fail_on: Optional[str] = typer.Option(None, "--fail-on", help="Exit 1 when any finding is at or above this severity."),
    debug: bool = typer.Option(False, "--debug", help="Show technical details on errors."),
) -> None:
    """Re-render a saved scan (no network access, no re-scan)."""
    set_debug(debug)
    fmt = validate_format(format)
    fail_on = validate_severity(fail_on)
    result = resolve_scan(scan_id)
    emit(result, fmt, output, top=top, details=details)
    code = apply_fail_on(result, fail_on)
    if code:
        raise typer.Exit(code)
