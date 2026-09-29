"""Plausible look-alike name generation (typosquat variants) for a package name."""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..models import Ecosystem
from ..parsers.normalize import comparison_key
from .similarity import affixes_for

MUTATION_CLASSES = ["transposition", "insertion", "deletion", "substitution", "homoglyph", "separator", "prefix_suffix"]
DEFAULT_LIMIT = 60

_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"]


def _build_neighbors() -> dict[str, list[str]]:
    pos = {ch: (r, c) for r, row in enumerate(_ROWS) for c, ch in enumerate(row)}
    nb: dict[str, list[str]] = {}
    for ch, (r, c) in pos.items():
        cand = [(r, c - 1), (r, c + 1)]
        if r == 0:
            cand += [(1, c - 1), (1, c)]
        elif r == 1:
            cand += [(0, c), (0, c + 1), (2, c - 1), (2, c)]
        else:
            cand += [(1, c), (1, c + 1)]
        nb[ch] = [_ROWS[rr][cc] for rr, cc in cand if 0 <= rr < 3 and 0 <= cc < len(_ROWS[rr])]
    return nb


KEYBOARD_NEIGHBORS = _build_neighbors()
HOMOGLYPHS: dict[str, list[str]] = {
    "o": ["0"], "l": ["1", "i"], "i": ["1", "l"], "e": ["3"], "a": ["4"], "s": ["5"], "b": ["6"], "t": ["7"],
    "g": ["9", "q"], "z": ["2"], "0": ["o"], "1": ["l", "i"], "m": ["rn"], "w": ["vv"], "d": ["cl"], "u": ["v"],
}
_MULTI_HOMOGLYPHS = {"rn": "m", "vv": "w", "cl": "d"}
_VOWELS = "aeiou"
_SEPS = "-_."

_VALID = {
    Ecosystem.NPM: re.compile(r"^(@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$"),
    Ecosystem.PYPI: re.compile(r"^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$"),
    Ecosystem.RUST: re.compile(r"^[a-z][a-z0-9_-]*$"),
    Ecosystem.GO: re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/~-]*$"),
}


@dataclass(frozen=True)
class Variant:
    name: str
    mutation: str
    plausibility: float


def _split(name: str, ecosystem: Ecosystem) -> tuple[str, str]:
    """(fixed_prefix, mutable_core): scopes / Go module hosts are left intact."""
    if ecosystem is Ecosystem.NPM and name.startswith("@") and "/" in name:
        scope, bare = name.split("/", 1)
        return scope + "/", bare
    if ecosystem is Ecosystem.GO and "/" in name:
        head, tail = name.rsplit("/", 1)
        return head + "/", tail
    return "", name


def _core_variants(s: str, ecosystem: Ecosystem) -> list[tuple[str, str, float]]:
    out: list[tuple[str, str, float]] = []
    n = len(s)
    # transposition
    for i in range(n - 1):
        if s[i] != s[i + 1]:
            out.append((s[:i] + s[i + 1] + s[i] + s[i + 2:], "transposition", 0.90))
    # insertion: doubled char, then keyboard-adjacent char
    for i in range(n):
        if s[i] not in _SEPS:
            out.append((s[:i] + s[i] + s[i:], "insertion", 0.88))
    for i, ch in enumerate(s):
        for nb in KEYBOARD_NEIGHBORS.get(ch, [])[:2]:
            out.append((s[:i + 1] + nb + s[i + 1:], "insertion", 0.50))
    # deletion
    if n > 3:
        for i in range(n):
            out.append((s[:i] + s[i + 1:], "deletion", 0.85))
    # substitution: keyboard-adjacent, then vowel swaps
    for i, ch in enumerate(s):
        for nb in KEYBOARD_NEIGHBORS.get(ch, []):
            out.append((s[:i] + nb + s[i + 1:], "substitution", 0.60))
        if ch in _VOWELS:
            for v in _VOWELS:
                if v != ch:
                    out.append((s[:i] + v + s[i + 1:], "substitution", 0.45))
    # homoglyph
    for i, ch in enumerate(s):
        for g in HOMOGLYPHS.get(ch, []):
            out.append((s[:i] + g + s[i + 1:], "homoglyph", 0.80))
    for src, dst in _MULTI_HOMOGLYPHS.items():
        for m in re.finditer(re.escape(src), s):
            out.append((s[:m.start()] + dst + s[m.end():], "homoglyph", 0.80))
    # separators
    for i, ch in enumerate(s):
        if ch in _SEPS:
            for other in _SEPS:
                if other != ch:
                    out.append((s[:i] + other + s[i + 1:], "separator", 0.75))
            out.append((s[:i] + s[i + 1:], "separator", 0.75))
    # prefixes / suffixes
    prefixes, suffixes = affixes_for(ecosystem)
    for p in prefixes:
        out.append((p + s, "prefix_suffix", 0.72))
    for x in suffixes:
        out.append((s + x, "prefix_suffix", 0.70))
    return out


def generate_variants(name: str, ecosystem: Ecosystem | str, limit: int = DEFAULT_LIMIT) -> list[Variant]:
    """Return up to ``limit`` distinct variants of ``name``, most plausible first.

    The original name (and anything that normalizes to it on the registry) is never returned.
    """
    eco = Ecosystem(ecosystem)
    prefix, core = _split(name.lower() if eco is not Ecosystem.GO else name, eco)
    if len(core) < 2:
        return []
    orig_key = comparison_key(eco, name)
    best: dict[str, Variant] = {}
    for cand, mut, plaus in _core_variants(core, eco):
        full = prefix + cand
        if not cand or full == name or comparison_key(eco, full) == orig_key:
            continue
        if not _VALID[eco].match(full) or len(full) > 214:
            continue
        cur = best.get(full)
        if cur is None or plaus > cur.plausibility:
            best[full] = Variant(full, mut, plaus)
    order = {m: i for i, m in enumerate(MUTATION_CLASSES)}
    ranked = sorted(best.values(), key=lambda v: (-v.plausibility, order[v.mutation], v.name))
    return ranked[:limit] if limit else ranked


def classify_mutation(original: str, other: str, ecosystem: Ecosystem | str) -> str | None:
    """Best-effort label for how ``other`` relates to ``original`` (None if it is not a known variant class)."""
    for v in generate_variants(original, ecosystem, limit=0):
        if v.name == other:
            return v.mutation
    return None
