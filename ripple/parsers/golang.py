"""Go ecosystem parsers: go.mod and go.sum."""
from __future__ import annotations

import re

from ..models import Ecosystem, Package, Resolution
from .base import (
    LockfileParseError, ParsedLockfile, add_package, finalize_graph, new_package, to_text,
)
from .normalize import normalize_go

ECO = Ecosystem.GO


def _tokens(line: str) -> tuple[list[str], bool]:
    indirect = bool(re.search(r"//\s*indirect\b", line))
    line = re.sub(r"//.*$", "", line).strip()
    toks = re.findall(r'"[^"]*"|\S+', line)
    return [t.strip('"') for t in toks], indirect


def _blocks(text: str) -> list[tuple[str, str]]:
    """Yield (directive, body) pairs, expanding ``directive ( ... )`` blocks."""
    out: list[tuple[str, str]] = []
    block: str | None = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("//"):
            continue
        if block:
            if line.startswith(")"):
                block = None
            else:
                out.append((block, line))
            continue
        m = re.match(r"^(\w+)\s*\(\s*(//.*)?$", line)
        if m:
            block = m.group(1)
            continue
        m = re.match(r"^(\w+)\s+(.*)$", line)
        if m:
            out.append((m.group(1), m.group(2)))
    return out


def parse_go_mod(content: bytes | str, filename: str = "go.mod") -> ParsedLockfile:
    text = to_text(content, filename)
    directives = _blocks(text)
    if not any(d in ("module", "require", "go") for d, _ in directives):
        raise LockfileParseError("File does not look like a go.mod (no module/go/require directive).", filename)
    out = ParsedLockfile(filename=filename, ecosystem=ECO, kind="go.mod")
    replaces: dict[tuple[str, str | None], list[str]] = {}
    for d, body in directives:
        toks, _ = _tokens(body)
        if d == "module" and toks:
            out.project_name = toks[0]
        elif d == "replace" and "=>" in toks:
            i = toks.index("=>")
            left, right = toks[:i], toks[i + 1:]
            if left and right:
                replaces[(normalize_go(left[0]), left[1] if len(left) > 1 else None)] = right
        elif d == "go" and toks:
            out.meta["go_version"] = toks[0]
    store: dict[str, Package] = {}
    direct: set[str] = set()
    for d, body in directives:
        if d != "require":
            continue
        toks, indirect = _tokens(body)
        if len(toks) < 2:
            continue
        name, version = normalize_go(toks[0]), toks[1]
        rep = replaces.get((name, version)) or replaces.get((name, None))
        res, src = Resolution.EXACT, None
        if rep:
            target = rep[0]
            if target.startswith((".", "/")) or re.match(r"^[A-Za-z]:[\\/]", target):
                res, src = Resolution.LOCAL, target
            else:
                res, src = Resolution.VCS, target + (f"@{rep[1]}" if len(rep) > 1 else "")
        pkg = new_package(ECO, name, version, filename, registry_source=src, resolution=res)
        merged = add_package(store, pkg)
        if not indirect:
            direct.add(merged.id)
    out.packages = finalize_graph(store, direct)
    out.meta["replaced"] = sorted(n for n, _ in replaces)
    return out


def parse_go_sum(content: bytes | str, filename: str = "go.sum") -> ParsedLockfile:
    text = to_text(content, filename)
    out = ParsedLockfile(filename=filename, ecosystem=ECO, kind="go.sum", hashes_declared=True)
    sums: dict[str, str] = {}
    store: dict[str, Package] = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) != 3 or not parts[2].startswith("h1:"):
            if line.strip():
                out.warnings.append("Ignored a malformed go.sum line.")
            continue
        mod, ver, h = parts
        if ver.endswith("/go.mod"):
            continue
        name = normalize_go(mod)
        sums[f"{name}@{ver}"] = h
        add_package(store, new_package(ECO, name, ver, filename, resolution=Resolution.HASHED, integrity=h))
    if not sums and text.strip():
        raise LockfileParseError("File does not look like a go.sum.", filename)
    out.meta["sums"] = sums
    out.packages = finalize_graph(store, set())
    return out


def merge_go_sum(gomod: ParsedLockfile, gosum: ParsedLockfile) -> None:
    """Attach go.sum ``h1:`` hashes to the matching go.mod packages (in place)."""
    sums: dict[str, str] = gosum.meta.get("sums", {})
    for p in gomod.packages:
        h = sums.get(f"{p.name}@{p.version}")
        if h:
            p.integrity = h
            if p.resolution is Resolution.EXACT:
                p.resolution = Resolution.HASHED
    gomod.hashes_declared = True
    gomod.meta["go_sum"] = True
    gomod.meta["go_sum_file"] = gosum.filename
