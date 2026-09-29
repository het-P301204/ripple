"""Emit a scan result in the requested format to stdout or a file."""
from pathlib import Path
from typing import Optional

from ripple.models import ScanResult
from ripple.reports import render
from ripple.reports.common import count_at_or_above, sev
from ripple.reports.rich import DIM, glyphs_for, render_scan, render_to_text

from .console import err, out, write_stdout
from .errors import CliError

FORMATS = ("rich", "json", "sarif", "csv", "html")
SEVERITIES = ("critical", "high", "medium", "low", "info")


def validate_format(value: str, allowed=FORMATS) -> str:
    v = (value or "").lower()
    if v not in allowed:
        raise CliError(f"Unknown format '{value}'.", f"Choose one of: {', '.join(allowed)}.", title="Invalid option")
    return v


def validate_severity(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    v = value.lower()
    if v not in SEVERITIES:
        raise CliError(f"Unknown severity '{value}'.", f"Choose one of: {', '.join(SEVERITIES)}.", title="Invalid option")
    return v


def write_file(path: Path, text: str) -> None:
    path = Path(path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="")
    except OSError as exc:
        raise CliError(f"Could not write '{path}': {exc.strerror or exc}") from exc


def emit(result: ScanResult, fmt: str, output: Optional[Path], top: int = 10, details: int = 0,
         show_banner: bool = True, csv_kind: str = "findings") -> None:
    if fmt == "rich":
        if output:
            write_file(output, render_to_text(result, top=top, details=details))
            err().print(f"Wrote {output}", style=DIM, markup=False)
        else:
            render_scan(result, out(), top=top, details=details, show_banner=show_banner)
        return
    if fmt == "csv" and csv_kind != "findings":
        from ripple.reports.csv import to_csv

        text = to_csv(result, csv_kind)
    else:
        text = render(result, fmt)
    if output:
        write_file(output, text)
        err().print(f"Wrote {fmt.upper()} report to {output}", style=DIM, markup=False)
    else:
        write_stdout(text)


def apply_fail_on(result: ScanResult, fail_on: Optional[str]) -> int:
    """Return the process exit code for ``--fail-on`` (1 when findings >= severity, else 0)."""
    if not fail_on:
        return 0
    n = count_at_or_above(result, fail_on)
    if n:
        console = err()
        g = glyphs_for(console)
        console.print(f"{g.error} --fail-on {fail_on}: {n} finding(s) at or above {fail_on}.", style="bold #F0506E")
        return 1
    return 0
