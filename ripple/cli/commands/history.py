import json
from typing import Optional

import typer

from ripple.cli.output.console import out, set_debug
from ripple.cli.output.errors import guarded
from ripple.reports.rich import render_history
from ripple.server import store


@guarded
def history(
    limit: int = typer.Option(20, "--limit", "-n", min=1, help="Maximum number of scans to list."),
    as_json: bool = typer.Option(False, "--json", help="Print machine-readable JSON."),
    debug: bool = typer.Option(False, "--debug", help="Show technical details on errors."),
) -> None:
    """List saved scans, newest first."""
    set_debug(debug)
    entries = store.history()[:limit]
    if as_json:
        from ripple.cli.output.console import write_stdout

        write_stdout(json.dumps([e.model_dump(mode="json") for e in entries], indent=2) + "\n")
        return
    render_history(entries, out())
