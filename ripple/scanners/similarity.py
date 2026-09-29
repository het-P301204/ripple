"""String-distance helpers used by the typosquatting analysis."""
from __future__ import annotations

from ..models import Ecosystem

_DEHOMOGLYPH_MULTI = (("rn", "m"), ("vv", "w"), ("cl", "d"))
_DEHOMOGLYPH_SINGLE = str.maketrans({"0": "o", "1": "l", "3": "e", "5": "s", "4": "a", "7": "t", "6": "b", "9": "g"})


def damerau_levenshtein(a: str, b: str) -> int:
    """True (unrestricted) Damerau-Levenshtein distance: insert, delete, substitute, transpose adjacent."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    da: dict[str, int] = {}
    maxdist = len(a) + len(b)
    d = [[0] * (len(b) + 2) for _ in range(len(a) + 2)]
    d[0][0] = maxdist
    for i in range(len(a) + 1):
        d[i + 1][0] = maxdist
        d[i + 1][1] = i
    for j in range(len(b) + 1):
        d[0][j + 1] = maxdist
        d[1][j + 1] = j
    for i in range(1, len(a) + 1):
        db = 0
        for j in range(1, len(b) + 1):
            i1 = da.get(b[j - 1], 0)
            j1 = db
            cost = 1
            if a[i - 1] == b[j - 1]:
                cost = 0
                db = j
            d[i + 1][j + 1] = min(
                d[i][j] + cost,                      # substitution
                d[i + 1][j] + 1,                     # insertion
                d[i][j + 1] + 1,                     # deletion
                d[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1),  # transposition
            )
        da[a[i - 1]] = i
    return d[len(a) + 1][len(b) + 1]


def similarity(a: str, b: str) -> float:
    """Normalized similarity in [0, 1]: ``1 - distance / max_len``."""
    m = max(len(a), len(b))
    if m == 0:
        return 1.0
    return round(1.0 - damerau_levenshtein(a, b) / m, 4)


def dehomoglyph(s: str) -> str:
    """Collapse common look-alike characters (``rn``->``m``, ``vv``->``w``, ``0``->``o`` ...)."""
    out = s.lower()
    for src, dst in _DEHOMOGLYPH_MULTI:
        out = out.replace(src, dst)
    return out.translate(_DEHOMOGLYPH_SINGLE)


_AFFIXES: dict[Ecosystem, tuple[tuple[str, ...], tuple[str, ...]]] = {
    Ecosystem.NPM: (("node-", "js-", "npm-", "the-"), ("-js", ".js", "js", "-node", "-cli", "-lib", "-utils", "-core", "2")),
    Ecosystem.PYPI: (("python-", "python_", "py-", "py_", "py"), ("-py", "_py", "-python", "_python", "-lib", "-utils", "-core", "2", "3")),
    Ecosystem.RUST: (("rust-", "rs-"), ("-rs", "_rs", "-rust", "-lib", "-core", "-utils", "-sys", "2")),
    Ecosystem.GO: (("go-",), ("-go", "-golang", "2")),
}


# Suffixes that thousands of legitimate packages use for their own sub-packages (``postcss-js``, ``vite-node``,
# ``pydantic-core``, ``jest-cli``). Without registry evidence they are far too common to call a squat.
COMMON_SUFFIXES = frozenset({"-js", ".js", "-node", "-cli", "-lib", "-utils", "-core", "-sys"})


def affix_stripped(name: str, ecosystem: Ecosystem, strict: bool = False) -> list[str]:
    """Names obtained by stripping one well-known prefix/suffix (``python-requests`` -> ``requests``).

    ``strict`` drops the suffixes in :data:`COMMON_SUFFIXES` (used when no registry data corroborates the hit).
    """
    prefixes, suffixes = _AFFIXES[ecosystem]
    n = name.lower()
    out: list[str] = []
    for p in prefixes:
        if n.startswith(p) and len(n) - len(p) >= 3:
            out.append(n[len(p):])
    for s in suffixes:
        if strict and s in COMMON_SUFFIXES:
            continue
        if n.endswith(s) and len(n) - len(s) >= 3:
            out.append(n[: -len(s)])
    return out


def whole_token_swap(a: str, b: str) -> bool:
    """True when two separator-delimited names differ only by replacing one whole word (``css-loader`` vs
    ``ts-loader``, ``unicode-bidi`` vs ``unicode-xid``) rather than by a typo inside a word."""
    import re

    ta, tb = re.split(r"[-_.]", a), re.split(r"[-_.]", b)
    if len(ta) != len(tb) or len(ta) < 2:
        return False
    diff = [(x, y) for x, y in zip(ta, tb) if x != y]
    if len(diff) != 1:
        return False
    x, y = diff[0]
    return damerau_levenshtein(x, y) >= 2 or max(len(x), len(y)) <= 4


def affixes_for(ecosystem: Ecosystem) -> tuple[tuple[str, ...], tuple[str, ...]]:
    return _AFFIXES[ecosystem]
