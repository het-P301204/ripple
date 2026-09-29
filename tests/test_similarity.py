from __future__ import annotations

import pytest

from ripple.models import Ecosystem
from ripple.scanners.popular import POPULAR, is_allowlisted, is_popular
from ripple.scanners.similarity import affix_stripped, damerau_levenshtein, dehomoglyph, similarity
from ripple.scanners.typosquatting import find_squat_target


@pytest.mark.parametrize("a,b,d", [
    ("", "", 0), ("abc", "abc", 0), ("abc", "", 3), ("", "abc", 3),
    ("requests", "requets", 1),          # deletion
    ("requests", "reqeusts", 1),         # adjacent transposition counts once
    ("requests", "requesst", 1),
    ("kitten", "sitting", 3),
    ("ca", "abc", 2),                    # true Damerau-Levenshtein (OSA would say 3)
    ("lodash", "lodahs", 1),
    ("express", "expresss", 1),
])
def test_damerau_levenshtein(a, b, d):
    assert damerau_levenshtein(a, b) == d
    assert damerau_levenshtein(b, a) == d


def test_similarity_normalised():
    assert similarity("requests", "requests") == 1.0
    assert similarity("requests", "requets") == pytest.approx(0.875)
    assert similarity("abc", "xyz") == 0.0
    assert similarity("", "") == 1.0
    assert 0.0 <= similarity("ab", "abcdefgh") <= 1.0


def test_dehomoglyph_and_affixes():
    assert dehomoglyph("requ3sts") == "requests"
    assert dehomoglyph("rnodule") == "module"
    assert dehomoglyph("vvebpack") == "webpack"
    assert "requests" in affix_stripped("python-requests", Ecosystem.PYPI)
    assert "express" in affix_stripped("node-express", Ecosystem.NPM)
    assert "serde" in affix_stripped("serde-rs", Ecosystem.RUST)


def test_popular_lists_are_large_and_unique():
    for eco, names in POPULAR.items():
        assert len(names) >= 150, eco
        assert len(set(names)) == len(names)
    assert is_popular(Ecosystem.PYPI, "Requests") and is_popular(Ecosystem.RUST, "serde-json") and not is_popular(Ecosystem.NPM, "acme-widget")


@pytest.mark.parametrize("eco,name,popular,kind", [
    (Ecosystem.PYPI, "requets", "requests", "edit_distance"),
    (Ecosystem.NPM, "lodahs", "lodash", "edit_distance"),
    (Ecosystem.NPM, "crossenv", "cross-env", "edit_distance"),
    (Ecosystem.PYPI, "requ3sts", "requests", "homoglyph"),
    (Ecosystem.PYPI, "python-requests", "requests", "affix"),
    (Ecosystem.RUST, "lazy_statik", "lazy_static", "edit_distance"),
])
def test_squat_targets_found(eco, name, popular, kind):
    hit = find_squat_target(eco, name)
    assert hit is not None and hit[0] == popular and hit[2] == kind


@pytest.mark.parametrize("eco,name", [
    (Ecosystem.NPM, "lodash"),            # the popular package itself
    (Ecosystem.NPM, "chai"),              # short and allow-listed / popular sibling
    (Ecosystem.NPM, "vue"),
    (Ecosystem.NPM, "acme-widget"),
    (Ecosystem.PYPI, "flask-cors"),
    (Ecosystem.PYPI, "abc"),              # too short to compare
    (Ecosystem.NPM, "@types/react"),      # public scope
    (Ecosystem.GO, "github.com/acme/payments"),
])
def test_no_false_positives(eco, name):
    assert find_squat_target(eco, name) is None


def test_allowlist_pairs():
    assert is_allowlisted("chalk", "chai") and is_allowlisted("Chai", "chalk")
    assert not is_allowlisted("lodash", "lodahs")


def test_max_edit_distance_option_limits_matches():
    # two edits away from "requests": needs len >= 8 and max_edit_distance >= 2
    assert find_squat_target(Ecosystem.PYPI, "rzquesta", 2) is not None
    assert find_squat_target(Ecosystem.PYPI, "rzquesta", 1) is None
    assert find_squat_target(Ecosystem.PYPI, "rekuests", 1) is not None       # single substitution
