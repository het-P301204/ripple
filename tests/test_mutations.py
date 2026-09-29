from __future__ import annotations

import pytest

from ripple.models import Ecosystem
from ripple.scanners.mutations import DEFAULT_LIMIT, MUTATION_CLASSES, classify_mutation, generate_variants
from ripple.scanners.similarity import damerau_levenshtein

E = Ecosystem


def names(name, eco, limit=0):
    return {v.name: v for v in generate_variants(name, eco, limit=limit)}


def test_each_mutation_class_is_produced():
    vs = generate_variants("react-dom", E.NPM, limit=0)
    assert {v.mutation for v in vs} == set(MUTATION_CLASSES)


def test_transposition_insertion_deletion_substitution():
    n = names("requests", E.PYPI)
    assert n["requsets"].mutation == "transposition"
    assert n["reqeusts"].mutation == "transposition"
    assert n["reqquests"].mutation == "insertion"
    assert n["reqests"].mutation == "deletion" and n["requets"].mutation == "deletion"
    assert n["rwquests"].mutation == "substitution"      # keyboard-adjacent e -> w


def test_homoglyphs():
    n = names("requests", E.PYPI)
    assert n["requ3sts"].mutation == "homoglyph"
    assert names("lodash", E.NPM)["1odash"].mutation == "homoglyph"
    assert names("webpack", E.NPM)["vvebpack"].mutation == "homoglyph"        # w -> vv
    assert "rnoment" in names("moment", E.NPM)        # m -> rn


def test_separator_variants():
    n = names("cross-env", E.NPM)
    assert n["cross_env"].mutation == "separator" and n["cross.env"].mutation == "separator"
    assert "crossenv" in n                                # separator removal (ranked as a deletion)


def test_prefix_suffix_variants():
    n = names("requests", E.PYPI)
    assert n["python-requests"].mutation == "prefix_suffix" and n["python_requests"].mutation == "prefix_suffix"
    assert n["requests-py"].mutation == "prefix_suffix"
    assert "requests-js" in names("requests", E.NPM)
    assert "node-express" in names("express", E.NPM) and "express-js" in names("express", E.NPM)
    assert "serde-rs" in names("serde", E.RUST)


def test_cap_and_prioritisation():
    vs = generate_variants("requests", E.PYPI)
    assert len(vs) == DEFAULT_LIMIT == 60
    assert len(generate_variants("requests", E.PYPI, limit=10)) == 10
    assert len(generate_variants("requests", E.PYPI, limit=0)) > 60
    scores = [v.plausibility for v in vs]
    assert scores == sorted(scores, reverse=True)
    # the seven canonical look-alikes all survive the cap
    got = {v.name for v in vs}
    assert {"requets", "requsets", "reqquests", "reqests", "requ3sts", "python-requests", "python_requests"} <= got


def test_variants_are_valid_distinct_and_never_the_original():
    for eco, name in [(E.NPM, "lodash"), (E.PYPI, "Flask_Cors"), (E.RUST, "serde_json"), (E.NPM, "@acme/logger")]:
        vs = generate_variants(name, eco, limit=0)
        assert len({v.name for v in vs}) == len(vs)
        assert name not in {v.name for v in vs}
        assert all(v.name and v.plausibility > 0 for v in vs)
    # pypi separator swaps normalise to the original, so they are not "different" names
    assert all(v.name.replace("_", "-") != "flask-cors" for v in generate_variants("Flask_Cors", E.PYPI, limit=0))


def test_scoped_and_go_names_keep_their_prefix():
    for v in generate_variants("@acme/logger", E.NPM, limit=0):
        assert v.name.startswith("@acme/")
    for v in generate_variants("github.com/spf13/cobra", E.GO, limit=0):
        assert v.name.startswith("github.com/spf13/")


def test_tiny_names_produce_nothing():
    assert generate_variants("a", E.NPM) == []


@pytest.mark.parametrize("name", ["express", "requests", "numpy", "serde"])
def test_variants_are_close(name):
    eco = E.RUST if name == "serde" else (E.NPM if name == "express" else E.PYPI)
    non_affix = [v for v in generate_variants(name, eco, limit=0) if v.mutation != "prefix_suffix"]
    assert all(damerau_levenshtein(name, v.name) <= 2 for v in non_affix)


def test_classify_mutation():
    assert classify_mutation("requests", "requsets", E.PYPI) == "transposition"
    assert classify_mutation("requests", "totally-different", E.PYPI) is None
