from typing import Optional

from ripple.cli.output.errors import CliError
from ripple.models import ScanResult
from ripple.server import store


def resolve_scan(ref: str) -> ScanResult:
    """Resolve ``latest`` / a scan id (or unique prefix) to a saved scan, with a friendly error."""
    try:
        return store.resolve(ref)
    except store.ScanNotFound:
        if ref == "latest":
            raise CliError("There are no saved scans yet.", "Run `ripple scan <lockfile>` or `ripple demo` first.",
                           title="No scans")
        raise CliError(f"No saved scan matches '{ref}'.", "List saved scans with `ripple history`.", title="Scan not found")
