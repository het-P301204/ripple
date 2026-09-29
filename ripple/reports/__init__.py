"""Report renderers: rich (terminal), json, sarif, csv, html."""
from __future__ import annotations

from typing import Callable

from ripple.models import ScanResult

FORMATS = ("rich", "json", "sarif", "csv", "html")
EXPORT_FORMATS = ("json", "sarif", "csv", "html")

MEDIA_TYPES = {
    "json": "application/json",
    "sarif": "application/sarif+json",
    "csv": "text/csv; charset=utf-8",
    "html": "text/html; charset=utf-8",
}
EXTENSIONS = {"json": "json", "sarif": "sarif", "csv": "csv", "html": "html", "rich": "txt"}


def render(result: ScanResult, fmt: str) -> str:
    """Render ``result`` to text in a non-terminal format (json/sarif/csv/html/rich-as-text)."""
    fmt = fmt.lower()
    if fmt == "json":
        from .json import to_json

        return to_json(result)
    if fmt == "sarif":
        from .sarif import to_sarif

        return to_sarif(result)
    if fmt == "csv":
        from .csv import to_csv

        return to_csv(result)
    if fmt == "html":
        from .html import to_html

        return to_html(result)
    if fmt == "rich":
        from .rich import render_to_text

        return render_to_text(result)
    raise ValueError(f"unknown report format: {fmt}")


__all__ = ["render", "FORMATS", "EXPORT_FORMATS", "MEDIA_TYPES", "EXTENSIONS"]
