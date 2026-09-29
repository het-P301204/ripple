import platform
import sys

import typer

from ripple.cli.output.console import out
from ripple.config import get_version


def version_text() -> str:
    return f"RIPPLE {get_version()}"


def version() -> None:
    """Show the RIPPLE version."""
    out().print(f"{version_text()}  (Python {platform.python_version()}, {sys.platform})", markup=False)
