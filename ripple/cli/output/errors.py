"""User-facing errors: friendly message + exit code 2, never a traceback (unless --debug)."""
import functools
from typing import Callable, Optional

import click
import typer
from rich.panel import Panel

from ripple.reports.rich import ASCII, UNICODE, VIOLET, DIM, SEV_STYLE, Text, box_for, glyphs_for
from ripple.server.errors import classify

from .console import debug_enabled, err

EXIT_OK = 0
EXIT_FINDINGS = 1
EXIT_ERROR = 2


class CliError(Exception):
    """Raised by commands for expected problems; message is shown verbatim."""

    def __init__(self, message: str, hint: Optional[str] = None, title: str = "Error"):
        super().__init__(message)
        self.message = message
        self.hint = hint
        self.title = title


def show_error(message: str, hint: Optional[str] = None, title: str = "Error") -> None:
    console = err()
    g = glyphs_for(console)
    body = Text()
    body.append(message, style="white")
    if hint:
        body.append("\n\n")
        body.append(hint, style=DIM)
    console.print(Panel(body, title=Text(title, style=SEV_STYLE["critical"]), title_align="left", box=box_for(g),
                        border_style="#F0506E", padding=(0, 2)))


def silence_stdout() -> None:
    """Point stdout at devnull so the interpreter's exit-time flush cannot raise on a closed pipe."""
    import os
    import sys

    try:
        devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull, sys.stdout.fileno())
    except Exception:
        pass


def guarded(fn: Callable) -> Callable:
    """Wrap a command: convert any failure into a friendly message and exit code 2."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        local_debug = bool(kwargs.get("debug"))
        try:
            return fn(*args, **kwargs)
        except (typer.Exit, typer.Abort, click.exceptions.Exit, click.ClickException, click.Abort):
            raise
        except (BrokenPipeError, OSError) as exc:
            if isinstance(exc, BrokenPipeError) or getattr(exc, "errno", None) in (22, 32):
                silence_stdout()      # e.g. `ripple report | head`: the reader went away; exit quietly
                raise typer.Exit(0)
            code, message = classify(exc)
            show_error(message, f"error code: {code}. Re-run with --debug for technical details.", "Scan failed")
            if debug_enabled(local_debug):
                err().print_exception(show_locals=False)
            raise typer.Exit(EXIT_ERROR)
        except KeyboardInterrupt:
            err().print("Interrupted.")
            raise typer.Exit(130)
        except CliError as exc:
            show_error(exc.message, exc.hint, exc.title)
            raise typer.Exit(EXIT_ERROR)
        except Exception as exc:  # noqa: BLE001 - last line of defence for the CLI
            code, message = classify(exc)
            show_error(message, f"error code: {code}. Re-run with --debug for technical details.", "Scan failed")
            if debug_enabled(local_debug):
                err().print_exception(show_locals=False)
            raise typer.Exit(EXIT_ERROR)

    return wrapper
