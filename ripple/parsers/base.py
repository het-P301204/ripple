"""Shared parser types and helpers."""
from __future__ import annotations

import json
import re
from collections import deque
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from ..models import Ecosystem, Package, Resolution
from ..security import clean_label, escape_controls, redact_secrets

MAX_LOCKFILE_BYTES = 40 * 1024 * 1024
MAX_PACKAGES = 50_000            # distinct packages per lockfile and per scan (memory / CPU / result-size bound)
MAX_NAME_LEN = 512               # npm allows 214, Go module paths a little more; longer is not a real name
MAX_VERSION_LEN = 256
MAX_FIELD_LEN = 2048             # spec / registry_source / integrity are display-only: truncated, not rejected

PUBLIC_REGISTRIES: dict[Ecosystem, str] = {
    Ecosystem.NPM: "https://registry.npmjs.org",
    Ecosystem.PYPI: "https://pypi.org",
    Ecosystem.GO: "https://proxy.golang.org",
    Ecosystem.RUST: "https://crates.io",
}

# Hosts that serve the *public* registry for each ecosystem (artifact CDNs included).
PUBLIC_REGISTRY_HOSTS: dict[Ecosystem, set[str]] = {
    Ecosystem.NPM: {"registry.npmjs.org", "registry.yarnpkg.com", "registry.npmjs.com"},
    Ecosystem.PYPI: {"pypi.org", "files.pythonhosted.org", "pypi.python.org", "www.pypi.org"},
    Ecosystem.GO: {"proxy.golang.org", "sum.golang.org", "goproxy.io", "goproxy.cn"},
    Ecosystem.RUST: {"crates.io", "index.crates.io", "static.crates.io"},
}


class LockfileParseError(Exception):
    """A supported lockfile that could not be parsed. ``str(e)`` is safe to show to users."""

    def __init__(self, message: str, filename: str = ""):
        super().__init__(message)
        self.message = message
        self.filename = filename


class UnsupportedLockfile(LockfileParseError):
    """File type is not one RIPPLE understands."""


@dataclass
class ParsedLockfile:
    filename: str
    ecosystem: Ecosystem
    kind: str                                   # package-lock.json | yarn.lock | requirements.txt | ...
    packages: list[Package] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    index_urls: list[str] = field(default_factory=list)          # explicit primary index / registry URLs
    extra_index_urls: list[str] = field(default_factory=list)    # additional indexes (mixed-index exposure)
    insecure_sources: list[str] = field(default_factory=list)    # http:// or TLS-verification disabled
    includes: list[str] = field(default_factory=list)            # `-r other.txt` references (not followed)
    hashes_declared: bool = False                                # lockfile format carries integrity data at all
    project_name: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)


def make_id(ecosystem: Ecosystem | str, name: str, version: str) -> str:
    return f"{Ecosystem(ecosystem).value}:{name}@{version}"


def _decode_bytes(content: bytes, filename: str) -> str:
    """Decode lockfile bytes: BOM-marked UTF-16/32 (PowerShell's ``pip freeze > requirements.txt``), UTF-8, then a
    legacy 8-bit code page for text with stray non-UTF-8 characters. Binary data is rejected with a clear message."""
    import codecs

    if content.startswith((codecs.BOM_UTF32_LE, codecs.BOM_UTF32_BE)):
        enc = "utf-32"
    elif content.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        enc = "utf-16"
    else:
        enc = ""
        head = content[:4096]
        if b"\x00" in head:
            even, odd = head[0::2].count(0), head[1::2].count(0)
            half = max(len(head) // 2, 1)
            if odd > 0.4 * half and even < 0.05 * half:
                enc = "utf-16-le"
            elif even > 0.4 * half and odd < 0.05 * half:
                enc = "utf-16-be"
            else:
                raise LockfileParseError("File looks like binary data, not a text lockfile.", filename)
    if enc:
        try:
            return content.decode(enc).lstrip("﻿")
        except UnicodeError:
            raise LockfileParseError("File is not valid UTF-16/UTF-32 text.", filename) from None
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        # e.g. a Windows-1252 comment in a requirements file; keep the file usable instead of rejecting it
        return content.decode("cp1252", errors="replace")


def to_text(content: bytes | str, filename: str = "") -> str:
    if isinstance(content, bytes):
        if len(content) > MAX_LOCKFILE_BYTES:
            raise LockfileParseError("File is too large to analyse (limit 40 MB).", filename)
        return _decode_bytes(content, filename)
    if len(content) > MAX_LOCKFILE_BYTES:
        raise LockfileParseError("File is too large to analyse (limit 40 MB).", filename)
    return content.lstrip("\ufeff")


def load_json(text: str, filename: str) -> Any:
    try:
        return json.loads(text)
    except (json.JSONDecodeError, RecursionError):
        raise LockfileParseError("File is not valid JSON.", filename) from None


def host_of(url: str | None) -> str:
    if not url:
        return ""
    u = url.strip()
    if "://" not in u:
        # scp-like git URLs (git@host:path) and bare hosts
        m = re.match(r"^(?:[\w.-]+@)?([\w.-]+):", u)
        return (m.group(1) if m else u.split("/")[0]).lower()
    try:
        return (urlparse(u).hostname or "").lower()
    except ValueError:
        return ""


def scheme_of(url: str | None) -> str:
    if not url or "://" not in url:
        return ""
    return url.split("://", 1)[0].lower().split("+")[-1]


def is_public_source(ecosystem: Ecosystem, url: str | None) -> bool:
    """True when ``url`` points at the ecosystem's public registry. Missing => treated as default/public."""
    if not url:
        return True
    return host_of(url) in PUBLIC_REGISTRY_HOSTS[ecosystem]


def is_insecure_url(url: str | None) -> bool:
    return bool(url) and url.strip().lower().startswith(("http://", "git://", "ftp://"))


_SHA_RE = re.compile(r"^[0-9a-f]{40}$|^[0-9a-f]{64}$", re.I)


def looks_like_commit(ref: str | None) -> bool:
    return bool(ref) and bool(_SHA_RE.match(ref))


def too_many_packages(filename: str = "") -> LockfileParseError:
    return LockfileParseError(
        f"The lockfile lists more than {MAX_PACKAGES:,} packages. Scan a smaller project or split the file.", filename)


def new_package(ecosystem: Ecosystem, name: str, version: str, source_file: str, **kw: Any) -> Package:
    # Names/versions/specs come straight from an untrusted file: neutralise control characters (terminal
    # escape sequences, bidi overrides) and bound lengths before they reach any report.
    name = escape_controls(name)
    version = escape_controls(version)
    if len(name) > MAX_NAME_LEN or len(version) > MAX_VERSION_LEN:
        raise LockfileParseError("A package name or version is unreasonably long; the file looks malformed.", source_file)
    for key in ("spec", "registry_source", "integrity"):
        val = kw.get(key)
        if val is not None:
            kw[key] = redact_secrets(escape_controls(val))[:MAX_FIELD_LEN]
    return Package(
        id=make_id(ecosystem, name, version), name=name, version=version, ecosystem=ecosystem,
        registry=PUBLIC_REGISTRIES[ecosystem], source_file=clean_label(source_file, 300), **kw,
    )


def merge_duplicate(existing: Package, other: Package) -> None:
    """Fold a second occurrence of the same package id (e.g. hoisted+nested npm copies) into the first."""
    existing.direct = existing.direct or other.direct
    existing.dev = existing.dev and other.dev
    seen = set(existing.dependencies)             # set lookup: a hostile file can list 100k+ dependencies
    for dep in other.dependencies:
        if dep not in seen:
            seen.add(dep)
            existing.dependencies.append(dep)
    if not existing.integrity and other.integrity:
        existing.integrity = other.integrity
    if existing.spec is None and other.spec is not None:
        existing.spec = other.spec


def add_package(store: dict[str, Package], pkg: Package) -> Package:
    cur = store.get(pkg.id)
    if cur is None:
        if len(store) >= MAX_PACKAGES:
            raise too_many_packages(pkg.source_file)
        store[pkg.id] = pkg
        return pkg
    merge_duplicate(cur, pkg)
    return cur


def finalize_graph(store: dict[str, Package], direct_ids: set[str]) -> list[Package]:
    """Set ``direct`` / ``depth`` (1 = direct dependency, 2+ = transitive) and drop dangling edges."""
    for p in store.values():
        p.dependencies = [d for d in dict.fromkeys(p.dependencies) if d in store and d != p.id]
        p.direct = p.id in direct_ids
    depth: dict[str, int] = {i: 1 for i in direct_ids if i in store}
    q = deque(sorted(depth))
    while q:
        cur = q.popleft()
        for d in store[cur].dependencies:
            if d not in depth:
                depth[d] = depth[cur] + 1
                q.append(d)
    for pid, p in store.items():
        p.depth = depth.get(pid, 2)
    return list(store.values())


def resolution_from(integrity: str | None, exact: bool) -> Resolution:
    if integrity:
        return Resolution.HASHED
    return Resolution.EXACT if exact else Resolution.RANGE
