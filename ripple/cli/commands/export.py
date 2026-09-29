from pathlib import Path
from typing import Optional

import typer

from ripple.cli.output.console import err, set_debug
from ripple.cli.output.emit import emit, validate_format, write_file
from ripple.cli.output.errors import CliError, guarded
from ripple.reports import EXTENSIONS, EXPORT_FORMATS, render
from ripple.reports.common import slug

from ._common import resolve_scan


@guarded
def export(
    scan_id: str = typer.Argument("latest", help="Saved scan id (or unique prefix), or 'latest'."),
    format: str = typer.Option("json", "--format", "-f", help="json, sarif, csv or html (print-ready)."),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Destination file (default: ./ripple-<scan>.<ext>)."),
    packages: bool = typer.Option(False, "--packages", help="CSV only: export the package inventory instead of findings."),
    debug: bool = typer.Option(False, "--debug", help="Show technical details on errors."),
) -> None:
    """Export a saved scan to a file (JSON, SARIF 2.1.0, CSV or a self-contained HTML report)."""
    set_debug(debug)
    fmt = validate_format(format, EXPORT_FORMATS)
    result = resolve_scan(scan_id)
    dest = output or Path(f"ripple-{slug(result.id)}.{EXTENSIONS[fmt]}")
    emit(result, fmt, dest, csv_kind="packages" if (packages and fmt == "csv") else "findings")
