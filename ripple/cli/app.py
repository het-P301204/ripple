"""RIPPLE command line interface (Typer + Rich)."""
import sys
from typing import Optional

import typer

from ripple.cli.commands.analyze import analyze
from ripple.cli.commands.demo import demo
from ripple.cli.commands.export import export
from ripple.cli.commands.history import history
from ripple.cli.commands.report import report
from ripple.cli.commands.scan import scan
from ripple.cli.commands.serve import serve
from ripple.cli.commands.version import version, version_text
from ripple.cli.output.console import out, set_debug, setup_stdio

app = typer.Typer(
    name="ripple",
    help="RIPPLE Supply Chain Scanner - read-only software supply chain attack surface analysis "
         "(dependency confusion, typosquatting, suspicious metadata, registry exposure). "
         "For authorized security assessment only.",
    no_args_is_help=True,
    add_completion=False,
    rich_markup_mode=None,
    pretty_exceptions_enable=False,
)


def _version_callback(value: bool) -> None:
    if value:
        typer.echo(version_text())
        raise typer.Exit()


@app.callback()
def _root(
    version_flag: Optional[bool] = typer.Option(None, "--version", "-V", callback=_version_callback, is_eager=True,
                                                help="Show the version and exit."),
    debug: bool = typer.Option(False, "--debug", help="Show technical details on errors."),
) -> None:
    set_debug(debug)


app.command("scan")(scan)
app.command("analyze")(analyze)
app.command("report")(report)
app.command("export")(export)
app.command("demo")(demo)
app.command("serve")(serve)
app.command("history")(history)
app.command("version")(version)


def main() -> None:
    setup_stdio()
    try:
        app()
    except BrokenPipeError:  # e.g. `ripple demo | head`
        try:
            sys.stdout.close()
        except Exception:
            pass
        sys.exit(0)


if __name__ == "__main__":
    main()
