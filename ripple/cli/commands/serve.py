import os
import threading
import webbrowser

import typer
from rich.text import Text

from ripple.cli.output.console import err, set_debug
from ripple.cli.output.errors import CliError, guarded
from ripple.reports.rich import DIM, MAGENTA, VIOLET

LOOPBACK = {"127.0.0.1", "localhost", "::1"}


def run_server(host: str = "127.0.0.1", port: int = 8787, open_browser: bool = False, path: str = "/") -> None:
    try:
        import uvicorn

        from ripple.server.app import STATIC_DIR
    except ImportError as exc:  # pragma: no cover
        raise CliError("The web server dependencies are not installed.", "Install with: pip install -e .") from exc

    console = err()
    if host not in LOOPBACK:
        console.print(Text(f"Warning: binding to {host} exposes RIPPLE beyond this machine. "
                           "The API has no authentication; keep the default 127.0.0.1 unless you know what you are doing.",
                           style="#F59E0B"))
        # Host-header validation (DNS-rebinding defence) is relaxed only as far as needed: a specific bind
        # address is allowed by name; only a wildcard bind (0.0.0.0 / ::) has to accept any Host.
        os.environ["RIPPLE_ALLOWED_HOSTS"] = "*" if host in ("0.0.0.0", "::", "") else host.strip("[]")
    shown_host = "localhost" if host in ("127.0.0.1", "::1") else host
    url = f"http://{shown_host}:{port}{path}"
    console.print(Text.assemble(("RIPPLE server ", f"bold {VIOLET}"), (f"listening on http://{host}:{port}", MAGENTA)))
    if not (STATIC_DIR / "index.html").is_file():
        console.print(Text("Dashboard not built yet. Run `cd web && npm install && npm run build`, or use the dev "
                           "server (`cd web && npm run dev`, http://localhost:5175). The JSON API is available at /api.",
                           style=DIM))
    console.print(Text("Press Ctrl+C to stop.", style=DIM))
    if open_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    try:
        uvicorn.run("ripple.server.app:app", host=host, port=port, log_level="warning", access_log=False)
    except OSError as exc:
        raise CliError(f"Could not start the server on {host}:{port}: {exc.strerror or exc}",
                       "Is the port already in use? Try `--port 8788`.") from exc


@guarded
def serve(
    host: str = typer.Option("127.0.0.1", "--host", help="Bind address (default: localhost only)."),
    port: int = typer.Option(8787, "--port", "-p", min=1, max=65535, help="Port to listen on."),
    open_browser: bool = typer.Option(False, "--open", help="Open the dashboard in your browser."),
    debug: bool = typer.Option(False, "--debug", help="Show technical details on errors."),
) -> None:
    """Start the dashboard and JSON API (http://127.0.0.1:8787)."""
    set_debug(debug)
    run_server(host, port, open_browser)
