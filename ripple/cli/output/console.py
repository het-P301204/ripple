"""Console factories and stdio setup (safe on Windows code pages)."""
import os
import sys

from rich.console import Console

_state = {"debug": False}


def set_debug(value: bool) -> None:
    _state["debug"] = bool(value)


def debug_enabled(local: bool = False) -> bool:
    return bool(local or _state["debug"] or os.environ.get("RIPPLE_DEBUG") in ("1", "true", "yes"))


def setup_stdio() -> None:
    """Never crash on unencodable output: replace instead of raising (Windows cp1252 pipes etc.)."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")  # type: ignore[union-attr]
        except Exception:
            pass


def out() -> Console:
    """Console bound to stdout (resolved lazily so test runners can swap streams)."""
    return Console(highlight=False, soft_wrap=False)


def err() -> Console:
    """Console bound to stderr for progress, notices and errors."""
    return Console(stderr=True, highlight=False, soft_wrap=False)


def write_stdout(text: str) -> None:
    """Write machine-readable output (json/sarif/csv/html) as UTF-8 regardless of the console code page."""
    try:
        sys.stdout.flush()
        buf = sys.stdout.buffer  # type: ignore[attr-defined]
        buf.write(text.encode("utf-8"))
        buf.flush()
    except Exception:
        sys.stdout.write(text)
        sys.stdout.flush()
