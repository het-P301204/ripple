import asyncio
from pathlib import Path
from typing import List, Optional

import typer
from rich.panel import Panel

from ripple.cli import files as lockfiles
from ripple.cli.output.console import err, out, set_debug
from ripple.cli.output.emit import SEVERITIES, apply_fail_on, emit, validate_format, validate_severity
from ripple.cli.output.errors import CliError, guarded
from ripple.cli.output.progress import ScanProgress
from ripple.config import cache_dir, load_settings
from ripple.models import ALL_CHECKS, Ecosystem, ScanOptions, ScanResult, ScanSource
from ripple.reports.rich import DIM, Text, banner_panel, box_for, glyphs_for
from ripple.server import store

_CHECK_ALIASES = {
    "confusion": "confusion", "dependency_confusion": "confusion", "dependency-confusion": "confusion",
    "typosquat": "typosquat", "typosquatting": "typosquat", "typo": "typosquat",
    "metadata": "metadata", "meta": "metadata",
    "exposure": "exposure", "registry_exposure": "exposure",
}
_ECO_ALIASES = {
    "npm": "npm", "node": "npm", "js": "npm", "pypi": "pypi", "pip": "pypi", "python": "pypi",
    "go": "go", "golang": "go", "rust": "rust", "cargo": "rust", "crates": "rust",
}


def parse_checks(value: Optional[str], full: bool) -> List[str]:
    if full or not value:
        return list(ALL_CHECKS)
    checks: List[str] = []
    for raw in value.split(","):
        raw = raw.strip().lower()
        if not raw:
            continue
        if raw not in _CHECK_ALIASES:
            raise CliError(f"Unknown check '{raw}'.", f"Valid checks: {', '.join(ALL_CHECKS)}.", title="Invalid option")
        canon = _CHECK_ALIASES[raw]
        if canon not in checks:
            checks.append(canon)
    return checks or list(ALL_CHECKS)


def parse_ecosystem(value: Optional[str]) -> Optional[Ecosystem]:
    if not value:
        return None
    key = value.strip().lower()
    if key not in _ECO_ALIASES:
        raise CliError(f"Unknown ecosystem '{value}'.", "Choose one of: npm, pypi, go, rust.", title="Invalid option")
    return Ecosystem(_ECO_ALIASES[key])


def unsupported_guidance(names: List[str]) -> None:
    console = err()
    g = glyphs_for(console)
    body = Text()
    body.append("RIPPLE could not analyse: ", style="white")
    detailed = len(names) > 1 or any(("(" in n or ": " in n) for n in names)
    shown = ("\n" + "\n".join("  - " + n for n in names)) if detailed else (names[0] if names else "the given input")
    body.append(shown, style="bold #F0506E")
    body.append("\n\nSupported lockfiles\n", style="bold #A78BFA")
    for eco, fl in lockfiles.SUPPORTED_TABLE:
        body.append(f"  {eco:<6}", style="#F472B6")
        body.append(f"{fl}\n", style="white")
    body.append("\nPass a lockfile, or a directory to search for lockfiles recursively "
                "(node_modules, .git, venv and target are skipped).", style=DIM)
    console.print(Panel(body, title=Text("Unsupported lockfile" if names else "No lockfiles found", style="bold #F0506E"), title_align="left",
                        box=box_for(g), border_style="#F0506E", padding=(0, 2)))


def build_inputs(paths: List[Path], detect, ScanInput, ecosystem=None):
    """Resolve CLI paths to engine inputs. Returns ``(inputs, display_names, unsupported, saw_dir)``."""
    try:
        discovered, explicit, saw_dir, missing = lockfiles.collect(paths)
    except lockfiles.TooManyFiles as exc:
        raise CliError(f"Directory search stopped: {exc}.",
                       "Point RIPPLE at a project directory or at specific lockfiles instead of a very large tree.",
                       title="Too many files") from None
    if missing:
        raise CliError("Path not found: " + ", ".join(str(m) for m in missing),
                       "Check the path, or run `ripple demo` for a built-in example.", title="Invalid input")
    inputs = []
    names: List[str] = []
    unsupported: List[str] = []
    seen = set()
    total_bytes = 0
    candidates = [(p, False) for p in discovered] + [(p, True) for p in explicit]
    for path, is_explicit in candidates:
        key = path.resolve()
        if key in seen:
            continue
        seen.add(key)
        if path.stat().st_size > lockfiles.MAX_FILE_BYTES:
            unsupported.append(f"{path.name} (larger than 25 MB)")
            continue
        total_bytes += path.stat().st_size
        if total_bytes > lockfiles.MAX_TOTAL_BYTES:
            raise CliError(f"The lockfiles add up to more than {lockfiles.MAX_TOTAL_BYTES // (1024 * 1024)} MB.",
                           "Scan them in smaller batches.", title="Input too large")
        content = path.read_bytes()
        disp = lockfiles.display_path(path)
        try:
            info = detect(disp, content, ecosystem) if ecosystem else detect(disp, content)
        except TypeError:
            info = detect(disp, content)
        info = info if isinstance(info, dict) else getattr(info, "model_dump", lambda: dict(vars(info)))()
        if not info.get("supported"):
            if is_explicit:
                reason = str(info.get("error") or "").strip()
                if "is not a supported file" in reason:
                    reason = "unrecognised file name - pass -e/--ecosystem {npm,pypi,go,rust} to force a parser"
                unsupported.append(f"{path.name} ({reason})" if reason else path.name)
            continue
        inputs.append(ScanInput(filename=disp, content=content))
        names.append(disp)
    return inputs, names, unsupported, saw_dir


@guarded
def scan(
    paths: List[Path] = typer.Argument(..., help="Lockfiles or directories to scan (directories are searched recursively)."),
    ecosystem: Optional[str] = typer.Option(None, "--ecosystem", "-e", help="Force ecosystem: npm, pypi, go or rust (default: auto-detect)."),
    format: str = typer.Option("rich", "--format", "-f", help="Output format: rich, json, sarif, csv or html."),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Write the report to this file instead of stdout."),
    checks: Optional[str] = typer.Option(None, "--checks", help="Comma-separated checks: confusion,typosquat,metadata,exposure."),
    full: bool = typer.Option(False, "--full", help="Run every check (default)."),
    live: bool = typer.Option(False, "--live/--offline", help="--live queries public registries with read-only GET requests. Default: --offline."),
    rate_limit: Optional[float] = typer.Option(None, "--rate-limit", help="Max registry requests per second (live mode)."),
    timeout: Optional[float] = typer.Option(None, "--timeout", help="Per-request registry timeout in seconds (live mode)."),
    internal_scope: Optional[List[str]] = typer.Option(None, "--internal-scope", help="Private scope/prefix, e.g. @acme (repeatable)."),
    fail_on: Optional[str] = typer.Option(None, "--fail-on", help="Exit 1 when any finding is at or above this severity (critical|high|medium|low)."),
    no_save: bool = typer.Option(False, "--no-save", help="Do not save the result to the scan history."),
    project: Optional[str] = typer.Option(None, "--project", help="Project name shown in reports."),
    top: int = typer.Option(10, "--top", min=1, help="Findings shown in the rich summary table."),
    details: int = typer.Option(0, "--details", min=0, help="Also print detail panels for the top N findings (rich)."),
    debug: bool = typer.Option(False, "--debug", help="Show technical details on errors."),
) -> None:
    """Scan lockfiles for dependency-confusion, typosquatting, metadata and registry-exposure risk."""
    set_debug(debug)
    fmt = validate_format(format)
    fail_on = validate_severity(fail_on)
    eco = parse_ecosystem(ecosystem)
    check_list = parse_checks(checks, full)
    console_err = err()

    try:
        from ripple.engine import ScanInput, detect, run_scan
    except ImportError as exc:  # pragma: no cover - engine is required at runtime
        raise CliError("The RIPPLE analysis engine is not available in this installation.", str(exc)) from exc

    inputs, names, unsupported, saw_dir = build_inputs(paths, detect, ScanInput, eco)
    if not inputs:
        if saw_dir and not unsupported:
            unsupported = lockfiles.find_unsupported(paths)
        unsupported_guidance(unsupported)
        raise typer.Exit(2)
    if unsupported:
        console_err.print(Text(f"Skipping unsupported file(s): {', '.join(unsupported)}", style="#F59E0B"))

    settings = load_settings()
    sc = settings.scanner
    options = ScanOptions(
        checks=check_list,
        ecosystem=eco,
        live=live,
        max_edit_distance=sc.max_edit_distance,
        rate_limit_rps=rate_limit if rate_limit is not None else sc.rate_limit_rps,
        timeout_s=timeout if timeout is not None else sc.timeout_s,
        cache_ttl_s=sc.cache_ttl_s,
        internal_scopes=list(dict.fromkeys(list(sc.internal_scopes) + list(internal_scope or []))),
        registry_overrides=settings.registry_overrides() if live else {},
    )

    quiet = fmt != "rich" and output is None  # machine output on stdout: keep stdout clean
    if fmt == "rich" and output is None:
        out().print(banner_panel(glyphs_for(out())))
    if live:
        g = glyphs_for(console_err)
        console_err.print(Panel(
            Text("LIVE mode: RIPPLE will send read-only GET requests to the public package registries for the "
                 "dependency names found in your lockfiles (rate-limited, cached). No package is installed, "
                 "executed, registered or published. Use only on projects you are authorized to assess.",
                 style="#F59E0B"),
            title=Text("Live registry lookups", style="bold #F59E0B"), title_align="left", box=box_for(g),
            border_style="#F59E0B", padding=(0, 2)))

    src = ScanSource(kind="folder" if saw_dir else "file", files=names)
    proj = project or lockfiles.guess_project(paths) or "project"
    progress_console = console_err if quiet else err()
    progress = ScanProgress(progress_console, live_mode=live)
    with progress:
        result: ScanResult = asyncio.run(
            run_scan(inputs, options, project=proj, progress=progress.callback, source=src,
                     cache_dir=str(cache_dir()) if live else None))
    if progress.enabled and not (fmt == "rich" and output is None):
        progress_console.print(progress.final_panel())

    if not no_save:
        try:
            result = store.save(result)
        except OSError as exc:
            console_err.print(Text(f"Could not save scan history: {exc.strerror or exc}", style="#F59E0B"))

    emit(result, fmt, output, top=top, details=details, show_banner=False)
    if not no_save:
        console_err.print(Text(f"Saved as {result.id}  (ripple report {result.id}, ripple analyze {result.id})", style=DIM))
    code = apply_fail_on(result, fail_on)
    if code:
        raise typer.Exit(code)
