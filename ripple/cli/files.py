"""Lockfile discovery for ``ripple scan``."""
import os
import re
from pathlib import Path
from typing import Iterable, Optional

SKIP_DIRS = {
    "node_modules", ".git", ".hg", ".svn", "venv", ".venv", "env", ".env", "target", "__pycache__", ".tox",
    "site-packages", ".mypy_cache", ".pytest_cache", "vendor", ".idea", ".vscode", "dist", "build",
}

KNOWN_NAMES = {
    "package-lock.json", "npm-shrinkwrap.json", "yarn.lock",
    "pipfile.lock", "pyproject.toml", "poetry.lock", "uv.lock", "go.mod", "go.sum", "cargo.lock",
}
_REQ_RE = re.compile(r"^(requirements|constraints)([-_.][\w.\-]+)?\.(txt|in)$", re.IGNORECASE)

MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_TOTAL_BYTES = 200 * 1024 * 1024      # all files of one scan, held in memory together
MAX_DISCOVERED = 500                     # lockfiles found while walking directories
MAX_VISITED_DIRS = 100_000               # a walk of a huge tree (e.g. C:\ or ~) stops instead of running for hours

SUPPORTED_TABLE = [
    ("npm", "package-lock.json, npm-shrinkwrap.json, yarn.lock"),
    ("PyPI", "requirements.txt, pyproject.toml, Pipfile.lock,"),
    ("", "poetry.lock, uv.lock"),
    ("Go", "go.mod, go.sum"),
    ("Rust", "Cargo.lock"),
]


def is_lockfile_name(name: str) -> bool:
    low = name.lower()
    return low in KNOWN_NAMES or bool(_REQ_RE.match(name))


def display_path(path: Path) -> str:
    """Relative POSIX path when under the cwd, else the absolute POSIX path."""
    try:
        rel = os.path.relpath(path, Path.cwd())
        if not rel.startswith(".."):
            return Path(rel).as_posix()
    except ValueError:  # different drive on Windows
        pass
    return path.resolve().as_posix()


class TooManyFiles(Exception):
    """Directory discovery hit MAX_DISCOVERED lockfiles or MAX_VISITED_DIRS directories."""


def _is_link(path: str) -> bool:
    """Symlink or Windows junction. Discovery never follows or reads them: an untrusted repository could
    otherwise plant ``requirements.txt -> ~/.aws/credentials`` and have its contents echoed into a report."""
    if os.path.islink(path):
        return True
    isjunction = getattr(os.path, "isjunction", None)
    return bool(isjunction and isjunction(path))


def walk_dir(root: Path) -> list[Path]:
    found: list[Path] = []
    visited = 0
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        visited += 1
        if visited > MAX_VISITED_DIRS:
            raise TooManyFiles(f"more than {MAX_VISITED_DIRS:,} directories")
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.endswith(".egg-info")
                             and not _is_link(os.path.join(dirpath, d)))
        in_req_dir = os.path.basename(dirpath).lower() in ("requirements", "reqs")
        for name in sorted(filenames):
            wanted = is_lockfile_name(name) or (in_req_dir and name.lower().endswith((".txt", ".in")))
            if wanted and not _is_link(os.path.join(dirpath, name)):
                found.append(Path(dirpath) / name)
                if len(found) > MAX_DISCOVERED:
                    raise TooManyFiles(f"more than {MAX_DISCOVERED} lockfiles")
    return found


def collect(paths: Iterable[Path]) -> tuple[list[Path], list[Path], bool, list[Path]]:
    """Return ``(lockfiles, explicit_files, saw_directory, missing)``.

    ``lockfiles`` are discovered inside directories (name-matched); ``explicit_files`` were passed directly
    and must be validated by the engine's detector; ``missing`` do not exist.
    """
    discovered: list[Path] = []
    explicit: list[Path] = []
    missing: list[Path] = []
    saw_dir = False
    for p in paths:
        if p.is_dir():
            saw_dir = True
            discovered.extend(walk_dir(p))
        elif p.is_file():
            explicit.append(p)
        else:
            missing.append(p)
    return discovered, explicit, saw_dir, missing


def guess_project(paths: list[Path]) -> Optional[str]:
    if not paths:
        return None
    first = paths[0].resolve()
    base = first if first.is_dir() else first.parent
    return base.name or None


def find_unsupported(paths: Iterable[Path], limit: int = 5) -> list[str]:
    """Lockfiles of package managers RIPPLE does not read (pnpm, Composer, ...) found under the given directories.

    Only used to explain an empty result ("No lockfiles found") so a pnpm project is not told it has nothing to scan.
    """
    from ripple.parsers.detect import KNOWN_UNSUPPORTED

    out: list[str] = []
    for root in paths:
        if not root.is_dir():
            continue
        visited = 0
        for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
            visited += 1
            if visited > 5_000:
                break
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.endswith(".egg-info")
                                 and not _is_link(os.path.join(dirpath, d)))
            for name in sorted(filenames):
                hint = KNOWN_UNSUPPORTED.get(name.lower())
                if hint and name.lower() not in ("package.json", "pom.xml", "environment.yml"):
                    out.append(f"{display_path(Path(dirpath) / name)}: {hint}")
                    if len(out) >= limit:
                        return out
    return out
