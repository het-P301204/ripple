"""PyPI lockfiles written by other tools: ``poetry.lock`` and ``uv.lock`` (both TOML with ``[[package]]`` tables)."""
from __future__ import annotations

from typing import Any

try:  # Python 3.11+
    import tomllib
except ModuleNotFoundError:  # pragma: no cover
    import tomli as tomllib  # type: ignore

from ..models import Ecosystem, Package, Resolution
from .base import (
    LockfileParseError, ParsedLockfile, add_package, finalize_graph, is_insecure_url, is_public_source, new_package,
    to_text,
)
from .normalize import normalize_pypi

ECO = Ecosystem.PYPI


def _load(content: bytes | str, filename: str) -> dict[str, Any]:
    text = to_text(content, filename)
    try:
        data = tomllib.loads(text)
    except (tomllib.TOMLDecodeError, ValueError):
        raise LockfileParseError("File is not valid TOML.", filename) from None
    if not isinstance(data, dict):
        raise LockfileParseError("File is not a TOML table.", filename)
    return data


def _dep_names(deps: Any) -> list[str]:
    """Dependency names from either a poetry ``[package.dependencies]`` table or a uv ``dependencies = [{name=..}]`` list."""
    if isinstance(deps, dict):
        return [normalize_pypi(k) for k in deps]
    if isinstance(deps, list):
        return [normalize_pypi(d["name"]) for d in deps if isinstance(d, dict) and d.get("name")]
    return []


def _link(store: dict[str, Package], by_name: dict[str, list[str]], parent: str, dep_names: list[str]) -> None:
    for dn in dep_names:
        for tid in by_name.get(dn, [])[:1]:
            if tid != parent:
                store[parent].dependencies.append(tid)


# ---------------------------------------------------------------------------------------------------------
# poetry.lock
# ---------------------------------------------------------------------------------------------------------

def parse_poetry_lock(content: bytes | str, filename: str = "poetry.lock") -> ParsedLockfile:
    data = _load(content, filename)
    pkgs = data.get("package")
    if not isinstance(pkgs, list) or ("metadata" not in data and not pkgs):
        raise LockfileParseError("File does not look like a poetry.lock (no [[package]] tables).", filename)
    out = ParsedLockfile(filename=filename, ecosystem=ECO, kind="poetry.lock", hashes_declared=True)
    meta = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    out.meta["lock_version"] = meta.get("lock-version")
    store: dict[str, Package] = {}
    by_name: dict[str, list[str]] = {}
    raw_deps: list[tuple[str, list[str]]] = []
    for e in pkgs:
        if not isinstance(e, dict) or not e.get("name"):
            continue
        name = normalize_pypi(str(e["name"]))
        version = str(e.get("version", "") or "")
        src = e.get("source") if isinstance(e.get("source"), dict) else {}
        stype = src.get("type")
        files = e.get("files") if isinstance(e.get("files"), list) else []
        integrity = next((f["hash"] for f in files if isinstance(f, dict) and f.get("hash")), None)
        groups = e.get("groups")
        dev = (e.get("category") == "dev") if "category" in e else (
            isinstance(groups, list) and bool(groups) and "main" not in groups)
        registry_source = None
        if stype == "git":
            res = Resolution.VCS
            ref = src.get("resolved_reference") or src.get("reference")
            registry_source = str(src.get("url", "")) + (f"@{ref}" if ref else "")
        elif stype in ("directory", "file"):
            res = Resolution.LOCAL
        elif stype == "url":
            res = Resolution.VCS
            registry_source = src.get("url")
        else:
            res = Resolution.HASHED if integrity else Resolution.EXACT
            if stype == "legacy" and src.get("url") and not is_public_source(ECO, src["url"]):
                registry_source = src["url"]
        if registry_source and is_insecure_url(registry_source):
            out.insecure_sources.append(registry_source)
        pkg = add_package(store, new_package(ECO, name, version, filename, registry_source=registry_source,
                                             resolution=res, integrity=integrity, dev=dev))
        by_name.setdefault(name, []).append(pkg.id)
        raw_deps.append((pkg.id, _dep_names(e.get("dependencies"))))
    for pid, names in raw_deps:
        _link(store, by_name, pid, names)
    depended = {d for p in store.values() for d in p.dependencies}
    direct = {i for i in store if i not in depended}
    out.warnings.append("poetry.lock does not record which dependencies are direct; packages nothing else depends on "
                        "were treated as direct. Scan pyproject.toml as well for the declared set.")
    out.packages = finalize_graph(store, direct)
    return out


# ---------------------------------------------------------------------------------------------------------
# uv.lock
# ---------------------------------------------------------------------------------------------------------

def parse_uv_lock(content: bytes | str, filename: str = "uv.lock") -> ParsedLockfile:
    data = _load(content, filename)
    pkgs = data.get("package")
    if not isinstance(pkgs, list) or not (("version" in data) or pkgs):
        raise LockfileParseError("File does not look like a uv.lock (no [[package]] tables).", filename)
    out = ParsedLockfile(filename=filename, ecosystem=ECO, kind="uv.lock", hashes_declared=True)
    out.meta["lock_version"] = data.get("version")
    out.meta["requires_python"] = data.get("requires-python")
    store: dict[str, Package] = {}
    by_name: dict[str, list[str]] = {}
    raw_deps: list[tuple[str, list[str]]] = []
    roots: list[tuple[list[str], list[str]]] = []          # (runtime dep names, dev dep names) of workspace members
    for e in pkgs:
        if not isinstance(e, dict) or not e.get("name"):
            continue
        name = normalize_pypi(str(e["name"]))
        src = e.get("source") if isinstance(e.get("source"), dict) else {}
        deps = _dep_names(e.get("dependencies"))
        opt = e.get("optional-dependencies") if isinstance(e.get("optional-dependencies"), dict) else {}
        devd = e.get("dev-dependencies") if isinstance(e.get("dev-dependencies"), dict) else {}
        if "virtual" in src or "editable" in src and src.get("editable") in (".", "./"):
            # the project itself (or a workspace root): its dependencies are the direct set
            roots.append((deps + [n for grp in opt.values() for n in _dep_names(grp)],
                          [n for grp in devd.values() for n in _dep_names(grp)]))
            out.project_name = out.project_name or str(e["name"])
            continue
        version = str(e.get("version", "") or "")
        sdist = e.get("sdist") if isinstance(e.get("sdist"), dict) else {}
        wheels = [w for w in (e.get("wheels") or []) if isinstance(w, dict)]
        integrity = sdist.get("hash") or next((w["hash"] for w in wheels if w.get("hash")), None)
        registry_source = None
        if "registry" in src:
            res = Resolution.HASHED if integrity else Resolution.EXACT
            if not is_public_source(ECO, str(src["registry"])):
                registry_source = str(src["registry"])
        elif "git" in src:
            res, registry_source = Resolution.VCS, str(src["git"])
        elif "url" in src:
            res, registry_source = Resolution.VCS, str(src["url"])
        elif any(k in src for k in ("path", "directory", "editable", "virtual")):
            res = Resolution.LOCAL
        else:
            res = Resolution.HASHED if integrity else Resolution.EXACT
        if registry_source and is_insecure_url(registry_source):
            out.insecure_sources.append(registry_source)
        pkg = add_package(store, new_package(ECO, name, version, filename, registry_source=registry_source,
                                             resolution=res, integrity=integrity))
        by_name.setdefault(name, []).append(pkg.id)
        raw_deps.append((pkg.id, deps + [n for grp in opt.values() for n in _dep_names(grp)]))
    for pid, names in raw_deps:
        _link(store, by_name, pid, names)
    direct: set[str] = set()
    if roots:
        for runtime, dev in roots:
            for n in runtime + dev:
                for tid in by_name.get(n, [])[:1]:
                    direct.add(tid)
                    if n in dev and n not in runtime:
                        store[tid].dev = True
    else:
        depended = {d for p in store.values() for d in p.dependencies}
        direct = {i for i in store if i not in depended}
        out.warnings.append("uv.lock has no project entry; packages nothing else depends on were treated as direct.")
    # propagate the dev flag: a package is dev only when every path to it goes through dev-only roots
    runtime_reach: set[str] = set()
    stack = [i for i in direct if not store[i].dev]
    while stack:
        cur = stack.pop()
        if cur in runtime_reach:
            continue
        runtime_reach.add(cur)
        stack.extend(store[cur].dependencies)
    if roots:
        dev_reach: set[str] = set()
        stack = [i for i in direct if store[i].dev]
        while stack:
            cur = stack.pop()
            if cur not in dev_reach:
                dev_reach.add(cur)
                stack.extend(store[cur].dependencies)
        for pid, p in store.items():
            p.dev = pid not in runtime_reach and pid in dev_reach
    out.packages = finalize_graph(store, direct)
    return out
