"""npm ecosystem parsers: package-lock.json (v1/v2/v3), npm-shrinkwrap.json, yarn.lock (classic + berry)."""
from __future__ import annotations

import re
from typing import Any

from ..models import Ecosystem, Package, Resolution
from .base import (
    MAX_PACKAGES, LockfileParseError, ParsedLockfile, add_package, finalize_graph, host_of, is_insecure_url, load_json,
    new_package, to_text, too_many_packages,
)
from .normalize import npm_name

ECO = Ecosystem.NPM
_REGISTRY_TARBALL = re.compile(r"/-/[^/]+\.(tgz|tar\.gz)(#.*)?$")
_REGISTRY_BASE = re.compile(r"^(.*?)/(?:@[^/]+/)?[^/]+/-/[^/]+\.(?:tgz|tar\.gz)(?:#.*)?$")
_REGISTRY_HOSTS = {"npm.pkg.github.com"}
_GIT_PREFIXES = ("git+", "git://", "github:", "gitlab:", "bitbucket:", "gist:", "ssh://git@")
_SHORTHAND = re.compile(r"^[\w.-]+/[\w.-]+(#.*)?$")


def _is_git(s: str | None) -> bool:
    if not s:
        return False
    return s.startswith(_GIT_PREFIXES) or bool(_SHORTHAND.match(s))


def _is_exact(spec: str, version: str) -> bool:
    s = spec.strip()
    return s.lstrip("=v") == version or bool(re.fullmatch(r"\d+\.\d+\.\d+([-+][\w.+-]+)?", s))


def _classify(version: str, resolved: str | None, integrity: str | None, link: bool,
              spec: str | None) -> tuple[Resolution, str | None]:
    """Return (resolution, registry_source)."""
    res = resolved or ""
    if link or res.startswith("file:") or version.startswith(("file:", "link:", "portal:")):
        return Resolution.LOCAL, None
    if _is_git(res) or _is_git(version):
        return Resolution.VCS, res or version
    if version.startswith(("http://", "https://")) and not _REGISTRY_TARBALL.search(version):
        return Resolution.VCS, version
    if res.startswith(("http://", "https://")):
        if _REGISTRY_TARBALL.search(res):
            m = _REGISTRY_BASE.match(res)
            return (Resolution.HASHED if integrity else Resolution.EXACT), (m.group(1) if m else res)
        host = host_of(res)
        if host in _REGISTRY_HOSTS:          # registries whose tarball URLs do not contain `/-/` (GitHub Packages)
            return (Resolution.HASHED if integrity else Resolution.EXACT), f"{res.split('://', 1)[0]}://{host}"
        return Resolution.VCS, res  # arbitrary tarball URL
    if integrity:
        return Resolution.HASHED, None
    if spec is not None and not _is_exact(spec, version):
        return Resolution.RANGE, None
    return Resolution.EXACT, None


def _name_from_path(path: str) -> str:
    return path.rsplit("node_modules/", 1)[-1] if "node_modules/" in path else path


def _v1_to_packages_map(deps: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"": {"_v1": True}}

    def walk(entries: dict[str, Any], base: str) -> None:
        for name, e in entries.items():
            if not isinstance(e, dict):
                continue
            path = f"{base}/node_modules/{name}" if base else f"node_modules/{name}"
            ne: dict[str, Any] = {
                "version": e.get("version", ""), "resolved": e.get("resolved"), "integrity": e.get("integrity"),
                "dev": e.get("dev", False), "dependencies": e.get("requires") or {}, "inBundle": e.get("bundled", False),
            }
            if str(e.get("version", "")).startswith(("file:", "link:")):
                ne["link"] = True
            out[path] = ne
            if isinstance(e.get("dependencies"), dict):
                walk(e["dependencies"], path)

    walk(deps, "")
    return out


def _bundled_integrity(pk: dict[str, Any], path: str) -> str:
    """Bundled dependencies ship inside their parent's tarball, so the parent's hash is the one that covers them."""
    base = path
    while "/node_modules/" in base:
        base = base.rsplit("/node_modules/", 1)[0]
        parent = pk.get(base)
        if isinstance(parent, dict) and parent.get("integrity"):
            return str(parent["integrity"])
    return "bundled"


def _lookup(pk: dict[str, Any], path: str, dep: str) -> str | None:
    """Node resolution: look in the package's own node_modules, then each ancestor's."""
    base = path
    while True:
        cand = f"{base}/node_modules/{dep}" if base else f"node_modules/{dep}"
        if cand in pk:
            return cand
        if not base:
            return None
        idx = base.rfind("node_modules/")
        base = base[:idx].rstrip("/") if idx > 0 else ""


def parse_package_lock(content: bytes | str, filename: str = "package-lock.json") -> ParsedLockfile:
    data = load_json(to_text(content, filename), filename)
    if not isinstance(data, dict):
        raise LockfileParseError("package-lock.json must contain a JSON object.", filename)
    if isinstance(data.get("packages"), dict):
        pk: dict[str, Any] = data["packages"]
    elif isinstance(data.get("dependencies"), dict):
        pk = _v1_to_packages_map(data["dependencies"])
    elif "lockfileVersion" in data or "name" in data:
        pk = {"": {}}
    else:
        raise LockfileParseError("File does not look like an npm lockfile (no 'packages' or 'dependencies').", filename)

    root = pk.get("") or {}
    v1 = bool(root.get("_v1"))
    ws_members = [p for p in pk if p and "node_modules/" not in p and isinstance(pk[p], dict)]
    root_deps: dict[str, str] = {}
    if not v1:
        for key in ("dependencies", "devDependencies", "optionalDependencies"):
            if isinstance(root.get(key), dict):
                root_deps.update(root[key])
        for wp in ws_members:  # workspaces
            for key in ("dependencies", "devDependencies", "optionalDependencies"):
                if isinstance(pk[wp].get(key), dict):
                    for k, v in pk[wp][key].items():
                        root_deps.setdefault(k, v)

    out = ParsedLockfile(filename=filename, ecosystem=ECO, kind="package-lock.json", hashes_declared=True,
                         project_name=data.get("name") or root.get("name"))
    out.meta["lockfile_version"] = data.get("lockfileVersion")
    store: dict[str, Package] = {}
    path_to_id: dict[str, str] = {}
    entries = [(p, e) for p, e in pk.items() if p and "node_modules/" in p and isinstance(e, dict)]
    if len(entries) > MAX_PACKAGES:
        raise too_many_packages(filename)
    for path, e in entries:
        name = npm_name(e.get("name") or _name_from_path(path))
        version = str(e.get("version", "") or "")
        link = bool(e.get("link"))
        if link and isinstance(e.get("resolved"), str) and e["resolved"] in pk:
            version = version or str(pk[e["resolved"]].get("version", ""))
        integrity = e.get("integrity")
        if not integrity and (e.get("inBundle") or e.get("bundled")):
            integrity = _bundled_integrity(pk, path)
        top = path == f"node_modules/{_name_from_path(path)}"
        spec = root_deps.get(_name_from_path(path)) if top else None
        res, src = _classify(version, e.get("resolved"), integrity, link, spec)
        if isinstance(e.get("resolved"), str) and is_insecure_url(e["resolved"]):
            out.insecure_sources.append(e["resolved"])
        pkg = new_package(ECO, name, version, filename, spec=spec if spec and spec != version else None,
                          registry_source=src, resolution=res, integrity=integrity,
                          dev=bool(e.get("dev") or e.get("devOptional")))
        path_to_id[path] = add_package(store, pkg).id

    for path, e in entries:
        me = path_to_id[path]
        src_entry = pk.get(e["resolved"], e) if e.get("link") and isinstance(e.get("resolved"), str) else e
        start = e["resolved"] if src_entry is not e else path      # a workspace link resolves from the member's own folder
        reqs: dict[str, str] = {}
        for key in ("dependencies", "optionalDependencies", "peerDependencies"):
            if isinstance(src_entry.get(key), dict):
                for k, v in src_entry[key].items():
                    reqs.setdefault(k, v)
        for dep, rng in reqs.items():
            tp = _lookup(pk, start, dep)
            if tp and tp in path_to_id:
                store[me].dependencies.append(path_to_id[tp])
                tgt = store[path_to_id[tp]]
                if tgt.spec is None and isinstance(rng, str) and rng != tgt.version and tp not in root_deps:
                    tgt.spec = rng

    direct: set[str] = set()
    if v1 or not root:
        depended = {d for p in store.values() for d in p.dependencies}
        direct = {i for i in store if i not in depended}
    else:
        member_deps = {wp: {k for key in ("dependencies", "devDependencies", "optionalDependencies")
                            for k in (pk[wp].get(key) or {})} for wp in ws_members}
        for path, pid in path_to_id.items():
            nm = _name_from_path(path)
            if path == f"node_modules/{nm}" and nm in root_deps:
                direct.add(pid)
            elif "/node_modules/" in path and path.rsplit("/node_modules/", 1)[0] in member_deps \
                    and nm in member_deps[path.rsplit("/node_modules/", 1)[0]]:
                direct.add(pid)                                # installed inside a workspace member
            entry = pk.get(path) or {}
            if entry.get("link") and entry.get("resolved") in ws_members:
                direct.add(pid)                                # workspace members are part of the project itself
    if v1:
        out.warnings.append("lockfileVersion 1 does not record which dependencies are direct; packages nothing else "
                            "depends on were treated as direct.")
    out.packages = finalize_graph(store, direct)
    return out


# ---------------------------------------------------------------------------------------------------------
# yarn.lock
# ---------------------------------------------------------------------------------------------------------

def _split_specs(header: str) -> list[str]:
    return [a or b.strip() for a, b in re.findall(r'"([^"]+)"|([^,\s][^,]*)', header.rstrip(":"))]


def _spec_name(spec: str) -> str:
    spec = spec.strip().strip('"')
    i = spec.find("@", 1)
    return spec[:i] if i > 0 else spec


def _real_name(spec: str) -> str:
    """Package name behind a yarn spec, following ``alias@npm:real-name@range`` aliases."""
    spec = spec.strip().strip('"')
    name = _spec_name(spec)
    rest = spec[len(name) + 1:]
    if rest.startswith("npm:"):
        target = rest[4:]
        if target and not target[0].isdigit() and not target.startswith(("^", "~", ">", "<", "=", "*")):
            return _spec_name(target)
    return name


def _clean_range(rng: str) -> str:
    """Human-readable range from a berry descriptor (``npm:^1.0.0``, ``patch:pkg@npm%3A^1.0.0#...``)."""
    from urllib.parse import unquote

    r = unquote(rng)
    if r.startswith("patch:"):
        r = r[6:].split("#", 1)[0]
        m = re.search(r"@npm:(.+)$", r)
        r = m.group(1) if m else r
    return r.replace("npm:", "", 1)


def _kv(line: str) -> tuple[str, str | None]:
    line = line.strip()
    if line.endswith(":"):
        return line[:-1].strip().strip('"'), None
    m = re.match(r'^("[^"]+"|[^\s:]+):?\s+(.*)$', line)
    if not m:
        return line, ""
    return m.group(1).strip('"'), m.group(2).strip().strip('"')


def _parse_yarn_blocks(text: str) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    cur: dict[str, Any] | None = None
    section: str | None = None
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        line = raw.strip()
        if indent == 0:
            if not line.endswith(":"):
                continue
            cur = {"specs": _split_specs(line), "fields": {}, "deps": {}, "optional": {}}
            blocks.append(cur)
            section = None
        elif cur is None:
            continue
        elif indent == 2:
            k, v = _kv(line)
            if v is None:
                section = k
            else:
                section = None
                cur["fields"][k] = v
        elif indent >= 4 and section in ("dependencies", "optionalDependencies"):
            k, v = _kv(line)
            cur["deps" if section == "dependencies" else "optional"][k] = v or ""
    return blocks


def parse_yarn_lock(content: bytes | str, filename: str = "yarn.lock") -> ParsedLockfile:
    text = to_text(content, filename)
    berry = "__metadata:" in text
    if not berry and "yarn lockfile v1" not in text and not re.search(r"^\S.*:\s*\n\s+version\s", text, re.M):
        raise LockfileParseError("File does not look like a yarn.lock.", filename)
    blocks = _parse_yarn_blocks(text)
    if len(blocks) > MAX_PACKAGES:
        raise too_many_packages(filename)
    out = ParsedLockfile(filename=filename, ecosystem=ECO, kind="yarn.lock", hashes_declared=True)
    out.meta["yarn_berry"] = berry
    store: dict[str, Package] = {}
    spec_to_id: dict[str, str] = {}
    name_to_ids: dict[str, list[str]] = {}
    workspace_deps: dict[str, str] = {}
    pending: list[tuple[str, dict[str, str]]] = []

    for b in blocks:
        f = b["fields"]
        if b["specs"] == ["__metadata"] or not b["specs"]:
            continue
        resolution_field = f.get("resolution", "") if berry else ""
        name = npm_name(_spec_name(resolution_field) if resolution_field else _real_name(b["specs"][0]))
        version = f.get("version", "")
        if berry and "@workspace:" in resolution_field:
            for dk, dv in {**b["deps"], **b["optional"]}.items():
                workspace_deps.setdefault(npm_name(dk), dv)
            continue
        resolved = f.get("resolved")
        integrity = f.get("integrity") or (f"checksum:{f['checksum']}" if f.get("checksum") else None)
        link = False
        if berry and resolution_field:
            proto = resolution_field[len(_spec_name(resolution_field)) + 1:]
            if proto.startswith(("portal:", "link:", "file:")):
                link = True
            elif proto.startswith(("git", "github:", "https:", "http:", "ssh:")):
                resolved = proto
        res, src = _classify(version, resolved, integrity, link, None)
        if berry and res is Resolution.EXACT and integrity:
            res = Resolution.HASHED
        if resolved and is_insecure_url(resolved):
            out.insecure_sources.append(resolved)
        pkg = new_package(ECO, name, version, filename, registry_source=src, resolution=res, integrity=integrity)
        merged = add_package(store, pkg)
        for s in b["specs"]:
            spec_to_id[s.strip().strip('"')] = merged.id
        name_to_ids.setdefault(name, []).append(merged.id)
        pending.append((merged.id, {**b["deps"], **b["optional"]}))

    for pid, deps in pending:
        for dn, dr in deps.items():
            dn = npm_name(dn)
            tid = (spec_to_id.get(f"{dn}@{dr}") or spec_to_id.get(f"{dn}@npm:{dr}")
                   or (name_to_ids.get(dn) or [None])[0])
            if tid:
                store[pid].dependencies.append(tid)
                if store[tid].spec is None and dr and dr != store[tid].version:
                    store[tid].spec = _clean_range(dr)

    direct: set[str] = set()
    if workspace_deps:
        for dn, dr in workspace_deps.items():
            tid = spec_to_id.get(f"{dn}@{dr}") or (name_to_ids.get(dn) or [None])[0]
            if tid:
                direct.add(tid)
                if store[tid].spec is None and dr != store[tid].version:
                    store[tid].spec = _clean_range(dr)
    else:
        depended = {d for p in store.values() for d in p.dependencies}
        direct = {i for i in store if i not in depended}
        out.warnings.append("yarn.lock does not record which dependencies are direct; top-level entries were treated as direct.")
    out.packages = finalize_graph(store, direct)
    return out
