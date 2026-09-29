"""PyPI ecosystem parsers: requirements.txt, Pipfile.lock, pyproject.toml (PEP 621 + Poetry + PEP 735)."""
from __future__ import annotations

import re
from typing import Any

try:  # Python 3.11+
    import tomllib
except ModuleNotFoundError:  # pragma: no cover
    import tomli as tomllib  # type: ignore

from ..models import Ecosystem, Package, Resolution
from .base import (
    LockfileParseError, ParsedLockfile, add_package, finalize_graph, is_insecure_url, is_public_source,
    load_json, new_package, to_text,
)
from .normalize import normalize_pypi

ECO = Ecosystem.PYPI
_REQ_RE = re.compile(r"^\s*([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(\[[^\]]*\])?\s*(.*)$")
_HASH_RE = re.compile(r"--hash[= ]\s*([A-Za-z0-9_]+):([0-9a-fA-F]+)")
_VCS_RE = re.compile(r"^(?:git|hg|svn|bzr)\+", re.I)


def _strip_comment(line: str) -> str:
    return re.sub(r"(^|\s)#.*$", "", line).rstrip()


def _exact_version(spec: str) -> str | None:
    clauses = [c.strip() for c in spec.split(",") if c.strip()]
    if len(clauses) == 1:
        m = re.fullmatch(r"===?\s*([A-Za-z0-9_.!+-]+)", clauses[0])
        if m and "*" not in m.group(1):
            return m.group(1)
    return None


def parse_requirement_spec(text: str) -> dict[str, Any] | None:
    """Parse a PEP 508-ish requirement (no options). Returns dict(name, extras, spec, marker, url) or None."""
    body = text.strip()
    marker = None
    if ";" in body and not _VCS_RE.match(body) and "://" not in body.split(";", 1)[0]:
        body, marker = (s.strip() for s in body.split(";", 1))
    elif ";" in body:
        body, marker = (s.strip() for s in body.split(";", 1))
    m = _REQ_RE.match(body)
    if not m:
        return None
    name, extras, rest = m.group(1), m.group(2), m.group(3).strip()
    url = None
    if rest.startswith("@"):
        url = rest[1:].strip()
        rest = ""
    rest = rest.strip("()")
    if rest and not re.match(r"^[<>=!~]", rest):
        return None
    return {"name": name, "extras": extras, "spec": rest.replace(" ", ""), "marker": marker, "url": url}


def _egg_name(url: str) -> str | None:
    m = re.search(r"[#&]egg=([A-Za-z0-9._-]+)", url)
    if m:
        return m.group(1)
    base = url.split("#")[0].split("?")[0].rstrip("/").rsplit("/", 1)[-1]
    base = re.sub(r"@.*$", "", base)
    base = re.sub(r"\.git$", "", base)
    return _archive_project(base) or None


_ARCHIVE_EXT = re.compile(r"\.(?:tar\.gz|tar\.bz2|tar\.xz|tgz|tar|zip|whl)$", re.I)


def _archive_project(base: str) -> str:
    """``pkg-1.0.tar.gz`` / ``foo-1.0-py3-none-any.whl`` -> ``pkg`` / ``foo`` (other names are returned unchanged)."""
    if not _ARCHIVE_EXT.search(base):
        return base
    stem = _ARCHIVE_EXT.sub("", base)
    m = re.match(r"^(.+?)-\d", stem)
    return m.group(1) if m else stem


def _vcs_pinned(url: str) -> bool:
    m = re.search(r"@([0-9a-fA-F]{7,40})(?:[#?]|$)", url)
    return bool(m and len(m.group(1)) >= 7)


def _package_from_req(req: dict[str, Any], filename: str, hashes: list[str], dev: bool = False,
                      index: str | None = None) -> Package | None:
    name = normalize_pypi(req["name"])
    spec = req["spec"]
    url = req.get("url")
    if url:
        if _VCS_RE.match(url) or url.startswith(("http://", "https://")):
            res = Resolution.VCS
        else:
            res = Resolution.LOCAL
        return new_package(ECO, name, "", filename, spec=url, registry_source=url, resolution=res, dev=dev)
    exact = _exact_version(spec)
    integrity = f"{hashes[0][0]}:{hashes[0][1]}" if hashes else None
    if exact:
        res = Resolution.HASHED if integrity else Resolution.EXACT
        return new_package(ECO, name, exact, filename, registry_source=index, resolution=res,
                           integrity=integrity, dev=dev)
    return new_package(ECO, name, "", filename, spec=spec or "*", registry_source=index, resolution=Resolution.RANGE,
                       integrity=integrity, dev=dev)


MAX_LOGICAL_LINE = 64 * 1024


def _logical_entries(text: str) -> list[dict[str, Any]]:
    """Join backslash continuations and attach pip-compile ``# via`` annotations to the preceding entry."""
    entries: list[dict[str, Any]] = []
    # Pieces of the logical line being continued. A list (not repeated ``buf += ...`` / ``buf[:-1]`` copies):
    # 300k ``a \\`` continuation lines used to cost O(n^2) - tens of seconds for a 2 MB file.
    parts: list[str] = []
    size = 0
    cur: dict[str, Any] | None = None
    collecting = False
    for raw in text.splitlines():
        s = raw.strip()
        if parts:
            if s.startswith("#"):
                continue
            if size <= MAX_LOGICAL_LINE:            # ignore the rest of an absurdly long continued line
                parts.append(s)
                size += len(s) + 1
        elif not s:
            continue
        elif s.startswith("#"):
            m = re.match(r"#\s*via\s*(.*)$", s)
            if m and cur is not None:
                collecting = True
                if m.group(1):
                    cur["via"].append(m.group(1).strip())
            elif collecting and cur is not None:
                item = s.lstrip("#").strip()
                if item:
                    cur["via"].append(item)
            else:
                collecting = False
            continue
        else:
            parts = [s]
            size = len(s)
            collecting = False
        if parts[-1].endswith("\\"):
            parts[-1] = parts[-1][:-1].rstrip()
            if not parts[-1]:
                parts.pop()
            continue
        cur = {"line": " ".join(parts), "via": []}
        entries.append(cur)
        parts, size = [], 0
    if parts:
        entries.append({"line": " ".join(parts), "via": []})
    return entries


def parse_requirements(content: bytes | str, filename: str = "requirements.txt") -> ParsedLockfile:
    text = to_text(content, filename)
    out = ParsedLockfile(filename=filename, ecosystem=ECO, kind="requirements.txt")
    store: dict[str, Package] = {}
    name_to_id: dict[str, str] = {}
    parents: dict[str, list[str]] = {}
    hashed_any = False
    for entry in _logical_entries(text):
        body = _strip_comment(entry["line"])
        if not body:
            continue
        hashes = _HASH_RE.findall(body)
        body_nohash = _HASH_RE.sub("", body).strip()
        if body_nohash.startswith("-") and not body_nohash.startswith(("-e ", "--editable")):
            _option(body_nohash, out)
            continue
        pkg = _parse_line(body_nohash, filename, hashes, out)
        if pkg is None:
            continue
        if hashes:
            pkg.integrity = pkg.integrity or f"{hashes[0][0]}:{hashes[0][1]}"
            if pkg.resolution is Resolution.EXACT:
                pkg.resolution = Resolution.HASHED
        hashed_any = hashed_any or bool(hashes)
        merged = add_package(store, pkg)
        name_to_id[merged.name] = merged.id
        if entry["via"]:
            parents[merged.id] = entry["via"]
    primary = out.index_urls[0] if out.index_urls else None
    if primary and not is_public_source(ECO, primary):
        for p in store.values():
            if p.resolution not in (Resolution.VCS, Resolution.LOCAL):
                p.registry_source = primary
    out.hashes_declared = hashed_any
    direct: set[str] = set()
    for pid in store:
        ps = parents.get(pid)
        if not ps:
            direct.add(pid)
            continue
        for item in ps:
            if item.startswith("-"):
                direct.add(pid)
                continue
            parent_id = name_to_id.get(normalize_pypi(item.split()[0]))
            if parent_id and parent_id != pid:
                store[parent_id].dependencies.append(pid)
    out.packages = finalize_graph(store, direct)
    return out


def _option(line: str, out: ParsedLockfile) -> None:
    parts = line.split(None, 1)
    opt = parts[0]
    val = parts[1].strip() if len(parts) > 1 else ""
    if "=" in opt and not val:
        opt, val = opt.split("=", 1)
    if opt in ("-i", "--index-url"):
        out.index_urls.append(val)
        if is_insecure_url(val):
            out.insecure_sources.append(val)
    elif opt == "--extra-index-url":
        out.extra_index_urls.append(val)
        if is_insecure_url(val):
            out.insecure_sources.append(val)
    elif opt in ("-r", "--requirement", "-c", "--constraint"):
        out.includes.append(val)
        out.warnings.append(f"'{opt} {val}' referenced but not followed; scan that file separately.")
    elif opt in ("--trusted-host",):
        out.meta.setdefault("trusted_hosts", []).append(val)
    elif opt in ("-f", "--find-links"):
        out.meta.setdefault("find_links", []).append(val)
        if is_insecure_url(val):
            out.insecure_sources.append(val)
    elif opt == "--require-hashes":
        out.meta["require_hashes"] = True


def _parse_line(body: str, filename: str, hashes: list[tuple[str, str]], out: ParsedLockfile) -> Package | None:
    editable = False
    if body.startswith(("-e ", "--editable ")):
        editable = True
        body = body.split(None, 1)[1].strip()
    if _VCS_RE.match(body) or body.startswith(("http://", "https://", "file:")):
        nm = _egg_name(body)
        if not nm:
            out.warnings.append("Skipped a URL requirement without a resolvable package name.")
            return None
        url_ok = body.startswith("file:")
        if is_insecure_url(body):
            out.insecure_sources.append(body)
        return new_package(ECO, normalize_pypi(nm), "", filename, spec=body, registry_source=body,
                           resolution=Resolution.LOCAL if url_ok else Resolution.VCS)
    if body.startswith((".", "/")) or re.match(r"^[A-Za-z]:[\\/]", body):
        nm = _archive_project(re.sub(r"[\\/]+$", "", body).replace("\\", "/").rsplit("/", 1)[-1])
        if nm.strip(".") == "":
            return None          # `-e .` / `..`: the project under scan itself, not a dependency
        return new_package(ECO, normalize_pypi(nm), "", filename, spec=body, resolution=Resolution.LOCAL)
    req = parse_requirement_spec(body)
    if not req:
        out.warnings.append("Skipped a line that could not be parsed as a requirement.")
        return None
    if req["url"] and is_insecure_url(req["url"]):
        out.insecure_sources.append(req["url"])
    pkg = _package_from_req(req, filename, hashes)
    if pkg and editable and pkg.resolution is Resolution.RANGE:
        pkg.resolution = Resolution.LOCAL
    return pkg


# ---------------------------------------------------------------------------------------------------------
# Pipfile.lock
# ---------------------------------------------------------------------------------------------------------

def parse_pipfile_lock(content: bytes | str, filename: str = "Pipfile.lock") -> ParsedLockfile:
    data = load_json(to_text(content, filename), filename)
    if not isinstance(data, dict) or ("default" not in data and "develop" not in data):
        raise LockfileParseError("File does not look like a Pipfile.lock (no 'default'/'develop' sections).", filename)
    out = ParsedLockfile(filename=filename, ecosystem=ECO, kind="Pipfile.lock", hashes_declared=True)
    sources = {s.get("name"): s for s in (data.get("_meta", {}).get("sources") or []) if isinstance(s, dict)}
    for s in sources.values():
        url = s.get("url", "")
        if s.get("verify_ssl") is False or is_insecure_url(url):
            out.insecure_sources.append(url or "(source with TLS verification disabled)")
    urls = [s.get("url") for s in sources.values() if s.get("url")]
    out.index_urls = [u for u in urls if not is_public_source(ECO, u)]
    if len(urls) > 1:
        out.extra_index_urls = [u for u in urls[1:]]
        out.meta["multiple_sources"] = True
    store: dict[str, Package] = {}
    for section, dev in (("default", False), ("develop", True)):
        for raw_name, e in (data.get(section) or {}).items():
            if not isinstance(e, dict):
                continue
            name = normalize_pypi(raw_name)
            src_url = sources.get(e.get("index"), {}).get("url") if e.get("index") else None
            hashes = e.get("hashes") or []
            integrity = hashes[0] if hashes else None
            if e.get("git") or e.get("ref"):
                pkg = new_package(ECO, name, "", filename, spec=e.get("git"), registry_source=e.get("git"),
                                  resolution=Resolution.VCS, dev=dev)
                if e.get("ref"):
                    pkg.registry_source = f"{e.get('git')}@{e['ref']}"
            elif e.get("path") or e.get("file"):
                pkg = new_package(ECO, name, "", filename, resolution=Resolution.LOCAL, dev=dev)
            else:
                ver = str(e.get("version", "")).lstrip("=")
                exact = str(e.get("version", "")).startswith("==")
                res = Resolution.HASHED if integrity and exact else (Resolution.EXACT if exact else Resolution.RANGE)
                pkg = new_package(ECO, name, ver if exact else "", filename, spec=None if exact else e.get("version") or "*",
                                  registry_source=src_url if src_url and not is_public_source(ECO, src_url) else None,
                                  resolution=res, integrity=integrity, dev=dev)
                if e.get("index") and src_url and is_public_source(ECO, src_url):
                    pkg.registry_source = None
            add_package(store, pkg)
    out.packages = finalize_graph(store, set(store))
    for p in out.packages:
        p.depth = 1
    return out


# ---------------------------------------------------------------------------------------------------------
# pyproject.toml
# ---------------------------------------------------------------------------------------------------------

def _poetry_spec(name: str, val: Any, filename: str, dev: bool, index: str | None) -> Package | None:
    if name.lower() == "python":
        return None
    n = normalize_pypi(name)
    if isinstance(val, list):
        val = val[0] if val else "*"
    if isinstance(val, dict):
        if "git" in val:
            ref = val.get("rev") or val.get("tag") or val.get("branch")
            url = val["git"] + (f"@{ref}" if ref else "")
            return new_package(ECO, n, "", filename, spec=url, registry_source=url, resolution=Resolution.VCS, dev=dev)
        if "path" in val:
            return new_package(ECO, n, "", filename, spec=val["path"], resolution=Resolution.LOCAL, dev=dev)
        if "url" in val:
            return new_package(ECO, n, "", filename, spec=val["url"], registry_source=val["url"],
                               resolution=Resolution.VCS, dev=dev)
        idx = val.get("source") or index
        val = val.get("version", "*")
        index = idx
    v = str(val).strip()
    if re.fullmatch(r"=?=?\s*\d[\w.!+-]*", v) and not v.startswith(("^", "~", ">", "<")):
        return new_package(ECO, n, v.lstrip("= "), filename, resolution=Resolution.EXACT, dev=dev,
                           registry_source=index)
    return new_package(ECO, n, "", filename, spec=v or "*", resolution=Resolution.RANGE, dev=dev, registry_source=index)


def parse_pyproject(content: bytes | str, filename: str = "pyproject.toml") -> ParsedLockfile:
    text = to_text(content, filename)
    try:
        data = tomllib.loads(text)
    except (tomllib.TOMLDecodeError, ValueError):
        raise LockfileParseError("File is not valid TOML.", filename) from None
    out = ParsedLockfile(filename=filename, ecosystem=ECO, kind="pyproject.toml")
    store: dict[str, Package] = {}
    proj = data.get("project") or {}
    tool = data.get("tool") or {}
    poetry = tool.get("poetry") or {}
    out.project_name = proj.get("name") or poetry.get("name")

    def add_pep508(lines: list[Any], dev: bool) -> None:
        for line in lines or []:
            if not isinstance(line, str):
                continue  # PEP 735 include-group tables
            req = parse_requirement_spec(line)
            if req:
                pkg = _package_from_req(req, filename, [], dev=dev)
                if pkg:
                    add_package(store, pkg)

    add_pep508(proj.get("dependencies"), False)
    for grp, lines in (proj.get("optional-dependencies") or {}).items():
        add_pep508(lines, False)
    for grp, lines in (data.get("dependency-groups") or {}).items():
        add_pep508(lines, True)
    add_pep508((tool.get("uv") or {}).get("dev-dependencies"), True)
    add_pep508((data.get("build-system") or {}).get("requires"), True)
    # PEP 517 build requirements are conventionally unpinned; remember them so "floating version" does not fire on them
    out.meta["build_requires"] = sorted(
        normalize_pypi(r["name"]) for r in (parse_requirement_spec(x) for x in (data.get("build-system") or {}).get("requires") or []
                                            if isinstance(x, str)) if r)

    # poetry sources → private index signals
    sources = poetry.get("source") or []
    if isinstance(sources, dict):
        sources = [sources]
    src_by_name = {s.get("name"): s for s in sources if isinstance(s, dict)}
    for s in src_by_name.values():
        url = s.get("url", "")
        if url and not is_public_source(ECO, url):
            (out.extra_index_urls if s.get("priority") in ("supplemental", "explicit", None) and out.index_urls else out.index_urls).append(url)
        if is_insecure_url(url):
            out.insecure_sources.append(url)
    for idx in (tool.get("uv") or {}).get("index") or []:
        if isinstance(idx, dict) and idx.get("url"):
            (out.index_urls if idx.get("default") else out.extra_index_urls).append(idx["url"])
    for u in (tool.get("uv") or {}).get("extra-index-url") or []:
        out.extra_index_urls.append(u)

    def poetry_deps(table: dict[str, Any], dev: bool) -> None:
        for nm, val in (table or {}).items():
            src_name = val.get("source") if isinstance(val, dict) else None
            idx = src_by_name.get(src_name, {}).get("url") if src_name else None
            pkg = _poetry_spec(nm, val, filename, dev, idx)
            if pkg:
                add_package(store, pkg)

    poetry_deps(poetry.get("dependencies"), False)
    poetry_deps(poetry.get("dev-dependencies"), True)
    for gname, grp in (poetry.get("group") or {}).items():
        poetry_deps((grp or {}).get("dependencies"), gname != "main")

    # [tool.uv.sources] overrides where a dependency really comes from (git / path / workspace / named index)
    uv_sources = (tool.get("uv") or {}).get("sources") or {}
    if isinstance(uv_sources, dict):
        for p in store.values():
            src = uv_sources.get(p.name) or uv_sources.get(p.name.replace("-", "_"))
            if isinstance(src, list):
                src = src[0] if src else None
            if not isinstance(src, dict):
                continue
            if src.get("git"):
                ref = src.get("rev") or src.get("tag") or src.get("branch")
                p.resolution, p.registry_source = Resolution.VCS, str(src["git"]) + (f"@{ref}" if ref else "")
                p.spec = p.registry_source
            elif src.get("url"):
                p.resolution, p.registry_source, p.spec = Resolution.VCS, str(src["url"]), str(src["url"])
            elif src.get("path") or src.get("workspace"):
                p.resolution, p.registry_source = Resolution.LOCAL, None
                p.spec = str(src.get("path") or "workspace")

    if not store and not proj and not poetry and not data.get("dependency-groups"):
        raise LockfileParseError("pyproject.toml declares no dependencies (no [project] or [tool.poetry] section).", filename)
    out.packages = finalize_graph(store, set(store))
    for p in out.packages:
        p.depth = 1
    return out
