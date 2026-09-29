"""Package-name normalization per ecosystem."""
from __future__ import annotations

import re
from urllib.parse import unquote

from ..models import Ecosystem

_PEP503 = re.compile(r"[-_.]+")


def normalize_pypi(name: str) -> str:
    """PEP 503: runs of ``-_.`` collapse to ``-`` and the name is lowercased."""
    return _PEP503.sub("-", name.strip()).lower()


def normalize_npm(name: str) -> str:
    """npm names are lowercase; ``@scope/name`` (also ``@scope%2fname``) is preserved."""
    n = unquote(name.strip()).lower()
    if n.startswith("@") and "/" not in n:
        return n
    return n


def npm_name(name: str) -> str:
    """The name as npm knows it: URL-decoded but **case preserved**.

    Legacy packages such as ``JSONStream`` are case-sensitive on the registry (``jsonstream`` is a different, unrelated
    project), so an unscoped name from a lockfile must never be lowercased before it is looked up or shown. Use
    :func:`normalize_npm` / :func:`comparison_key` only for comparisons.
    """
    n = unquote(name.strip())
    return n.lower() if n.startswith("@") else n      # scoped packages post-date the lowercase-only rule


def normalize_go(path: str) -> str:
    """Go module paths are case-sensitive; only strip whitespace, ``.git`` and trailing slashes."""
    p = path.strip().strip('"').rstrip("/")
    if p.endswith(".git"):
        p = p[:-4]
    return p


def normalize_crate(name: str) -> str:
    """crates.io treats ``-`` and ``_`` as equivalent; the declared spelling is kept (lowercased)."""
    return name.strip().lower()


def normalize_name(ecosystem: Ecosystem | str, name: str) -> str:
    eco = Ecosystem(ecosystem)
    if eco is Ecosystem.PYPI:
        return normalize_pypi(name)
    if eco is Ecosystem.NPM:
        return normalize_npm(name)
    if eco is Ecosystem.GO:
        return normalize_go(name)
    return normalize_crate(name)


def comparison_key(ecosystem: Ecosystem | str, name: str) -> str:
    """Key under which two spellings refer to the same project on the registry."""
    eco = Ecosystem(ecosystem)
    n = normalize_name(eco, name)
    if eco is Ecosystem.RUST:
        return n.replace("-", "_")
    if eco is Ecosystem.GO:
        return n.lower()
    return n


def split_npm_scope(name: str) -> tuple[str | None, str]:
    if name.startswith("@") and "/" in name:
        scope, bare = name.split("/", 1)
        return scope, bare
    return None, name


def go_escape(path: str) -> str:
    """Module path escaping used by the Go proxy protocol (uppercase -> ``!lower``)."""
    return "".join("!" + c.lower() if c.isupper() else c for c in path)
