"""Live scan progress driven by the engine's real progress callback."""
from typing import Optional

from rich.console import Console, Group
from rich.live import Live
from rich.panel import Panel
from rich.progress_bar import ProgressBar
from rich.spinner import Spinner
from rich.text import Text

from ripple.models import STAGES
from ripple.reports.rich import BORDER, DIM, MAGENTA, VIOLET, box_for, glyphs_for, stage_lines

_ACTIVE = {"active", "start", "started", "running", "in_progress", "in-progress", "begin"}
_DONE = {"done", "complete", "completed", "finish", "finished", "ok", "success"}
_ERROR = {"error", "failed", "fail"}
_SKIPPED = {"skipped", "skip"}


def normalize_state(state: str) -> str:
    s = (state or "").lower()
    if s in _ACTIVE:
        return "active"
    if s in _DONE:
        return "done"
    if s in _ERROR:
        return "error"
    if s in _SKIPPED:
        return "skipped"
    return "pending"


class ScanProgress:
    """Renders ``Scanning registry metadata…`` + the stage checklist + an overall bar.

    Use as a context manager; pass ``.callback`` to ``engine.run_scan(progress=...)``.
    When the console is not interactive nothing is drawn while running (so pipes and CI logs stay clean).
    """

    def __init__(self, console: Console, live_mode: bool = False):
        self.console = console
        self.g = glyphs_for(console)
        self.live_mode = live_mode
        self.states: dict[str, tuple[str, str]] = {}
        self.active_fraction = 0.0
        self._live: Optional[Live] = None
        self.enabled = console.is_terminal and not console.is_dumb_terminal
        self._spinner = Spinner("dots" if self.g.unicode else "line", style=MAGENTA)

    # -- engine callback -------------------------------------------------------------------------
    def callback(self, stage_id: str, state: str, detail: str = "", fraction: Optional[float] = None) -> None:
        st = normalize_state(state)
        prev_detail = self.states.get(stage_id, ("", ""))[1]
        self.states[stage_id] = (st, detail or prev_detail)
        if st == "active" and fraction is not None:
            self.active_fraction = max(0.0, min(1.0, float(fraction)))
        elif st != "active":
            self.active_fraction = 0.0
        if self._live is not None:
            self._live.update(self._render(), refresh=True)

    # -- math ----------------------------------------------------------------------------------------
    @property
    def fraction(self) -> float:
        total = len(STAGES)
        done = sum(1 for sid, _ in STAGES if self.states.get(sid, ("pending", ""))[0] in ("done", "skipped"))
        active = any(self.states.get(sid, ("pending", ""))[0] == "active" for sid, _ in STAGES)
        return min(1.0, (done + (self.active_fraction if active else 0.0)) / total)

    def _render(self):
        head = Text("Scanning registry metadata", style=f"bold {VIOLET}")
        head.append(self.g.ellipsis, style=VIOLET)
        head.append("  live registry GET requests (read-only)" if self.live_mode else "  offline heuristics, no network",
                    style=DIM)
        spin = self._spinner
        spin.text = head
        bar = ProgressBar(total=100, completed=self.fraction * 100, width=36, complete_style=MAGENTA,
                          finished_style=VIOLET, style=BORDER)
        pct = Text(f" {self.fraction * 100:3.0f}%", style=DIM)
        from rich.columns import Columns

        return Panel(
            Group(spin, Text(""), stage_lines(self.states, self.g), Text(""),
                  Columns([bar, pct], expand=False, padding=(0, 0))),
            box=box_for(self.g), border_style=BORDER, padding=(0, 1))

    # -- context manager ----------------------------------------------------------------------------
    def __enter__(self) -> "ScanProgress":
        if self.enabled:
            self._live = Live(self._render(), console=self.console, refresh_per_second=12, transient=True)
            self._live.__enter__()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._live is not None:
            self._live.__exit__(exc_type, exc, tb)
            self._live = None

    def final_panel(self) -> Panel:
        done = {sid: (st if st != "pending" else "done", d) for sid, (st, d) in self.states.items()}
        for sid, _ in STAGES:
            done.setdefault(sid, ("done", ""))
        return Panel(stage_lines(done, self.g), box=box_for(self.g), border_style=BORDER, padding=(0, 1))
