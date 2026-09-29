"""Rust ecosystem parser: Cargo.lock (v1-v4)."""
from __future__ import annotations

import re
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover
    import tomli as tomllib  # type: ignore

from ..models import Ecosystem, Package, Resolution
from .base import (
    MAX_PACKAGES, LockfileParseError, ParsedLockfile, add_package, finalize_graph, host_of, is_insecure_url,
    new_package, to_text, too_many_packages,
)
from .normalize import normalize_crate

ECO = Ecosystem.RUST


def _dep_key(dep: str) -> tuple[str, str | None, str | None]:
    m = re.match(r"^(\S+)(?:\s+(\S+))?(?:\s+\((.*)\))?$", dep.strip())
    if not m:
        return dep, None, None
    return m.group(1), m.group(2), m.group(3)


def _is_public_index(url: str) -> bool:
    h = host_of(url)
    return h in ("index.crates.io", "crates.io") or (h == "github.com" and "rust-lang/crates.io-index" in url)


def parse_cargo_lock(content: bytes | str, filename: str = "Cargo.lock") -> ParsedLockfile:
    text = to_text(content, filename)
    try:
        data = tomllib.loads(text)
    except (tomllib.TOMLDecodeError, ValueError):
        raise LockfileParseError("File is not valid TOML.", filename) from None
    pkgs = data.get("package")
    if pkgs is None and "version" not in data:
        raise LockfileParseError("File does not look like a Cargo.lock (no [[package]] tables).", filename)
    out = ParsedLockfile(filename=filename, ecosystem=ECO, kind="Cargo.lock", hashes_declared=True)
    out.meta["lock_version"] = data.get("version")
    raw: list[dict[str, Any]] = [p for p in (pkgs or []) if isinstance(p, dict) and p.get("name")]

    if len(raw) > MAX_PACKAGES:
        raise too_many_packages(filename)
    by_name: dict[str, list[dict[str, Any]]] = {}
    by_name_version: dict[tuple[str, Any], dict[str, Any]] = {}
    for p in raw:
        by_name.setdefault(p["name"], []).append(p)
        by_name_version.setdefault((p["name"], p.get("version")), p)     # O(1) exact lookup (no quadratic scans)

    # Cargo.lock v1 keeps checksums in a trailing [metadata] table: "checksum <name> <version> (<source>)" = "<sha256>"
    legacy_sums: dict[tuple[str, str], str] = {}
    meta_table = data.get("metadata")
    if isinstance(meta_table, dict):
        for k, v in meta_table.items():
            if isinstance(k, str) and k.startswith("checksum ") and isinstance(v, str):
                parts = k.split()
                if len(parts) >= 3:
                    legacy_sums[(parts[1], parts[2])] = v

    def resolve(dep: str) -> dict[str, Any] | None:
        n, v, _src = _dep_key(dep)
        if v:
            hit = by_name_version.get((n, v))
            if hit is not None:
                return hit
        cands = by_name.get(n)
        return cands[0] if cands else None

    depended: set[int] = set()
    for p in raw:
        for d in p.get("dependencies") or []:
            t = resolve(d)
            if t is not None:
                depended.add(id(t))
    roots = [p for p in raw if not p.get("source") and id(p) not in depended]
    if roots:
        out.project_name = roots[0]["name"]

    store: dict[str, Package] = {}
    entry_id: dict[int, str] = {}
    root_ids = {id(r) for r in roots}
    for p in raw:
        if id(p) in root_ids:
            continue
        name = normalize_crate(p["name"])
        version = str(p.get("version", ""))
        source = p.get("source")
        checksum = p.get("checksum") or legacy_sums.get((p["name"], str(p.get("version", ""))))
        registry_source = None
        if not source:
            res = Resolution.LOCAL
        elif source.startswith("git+"):
            res = Resolution.VCS
            registry_source = source[4:]
            if is_insecure_url(registry_source):
                out.insecure_sources.append(registry_source)
        elif source.startswith(("registry+", "sparse+")):
            url = source.split("+", 1)[1]
            if not _is_public_index(url):
                registry_source = url
            res = Resolution.HASHED if checksum else Resolution.EXACT
            if is_insecure_url(url):
                out.insecure_sources.append(url)
        else:
            res = Resolution.EXACT
            registry_source = source
        pkg = new_package(ECO, name, version, filename, registry_source=registry_source, resolution=res,
                          integrity=checksum)
        entry_id[id(p)] = add_package(store, pkg).id

    for p in raw:
        me = entry_id.get(id(p))
        if not me:
            continue
        for d in p.get("dependencies") or []:
            t = resolve(d)
            if t is not None and id(t) in entry_id:
                store[me].dependencies.append(entry_id[id(t)])

    direct: set[str] = set()
    # workspace members and path dependencies have no `source`: whatever they depend on is declared by this project
    for r in (p for p in raw if not p.get("source")):
        for d in r.get("dependencies") or []:
            t = resolve(d)
            if t is not None and id(t) in entry_id:
                direct.add(entry_id[id(t)])
    if not roots:
        out.warnings.append("No workspace root found in Cargo.lock; every crate was treated as direct.")
        direct = set(store)
    out.packages = finalize_graph(store, direct)
    return out
