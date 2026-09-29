from __future__ import annotations

import pytest

from ripple.models import Ecosystem
from ripple.parsers.normalize import (
    comparison_key, go_escape, normalize_crate, normalize_go, normalize_name, normalize_npm, normalize_pypi,
    split_npm_scope,
)


@pytest.mark.parametrize("raw,expected", [
    ("Requests", "requests"), ("python_dateutil", "python-dateutil"), ("Foo.Bar__baz", "foo-bar-baz"),
    ("zope.interface", "zope-interface"), ("  Django ", "django"), ("a-_.b", "a-b"),
])
def test_pypi_pep503(raw, expected):
    assert normalize_pypi(raw) == expected


def test_npm_case_and_scope():
    assert normalize_npm("Lodash") == "lodash"
    assert normalize_npm("@Scope/Name") == "@scope/name"
    assert normalize_npm("@scope%2Fname") == "@scope/name"
    assert split_npm_scope("@acme/logger") == ("@acme", "logger")
    assert split_npm_scope("lodash") == (None, "lodash")


def test_go_paths_are_case_sensitive():
    assert normalize_go("github.com/Azure/azure-sdk-for-go/") == "github.com/Azure/azure-sdk-for-go"
    assert normalize_go("github.com/x/y.git") == "github.com/x/y"
    assert go_escape("github.com/Azure/sdk") == "github.com/!azure/sdk"


def test_crate_names_keep_separators_but_compare_equal():
    assert normalize_crate("Serde_Json") == "serde_json"
    assert normalize_name(Ecosystem.RUST, "serde-json") == "serde-json"
    assert comparison_key(Ecosystem.RUST, "serde-json") == comparison_key(Ecosystem.RUST, "serde_json")
    assert comparison_key(Ecosystem.PYPI, "Foo_Bar") == comparison_key(Ecosystem.PYPI, "foo.bar")
    assert comparison_key(Ecosystem.NPM, "foo-bar") != comparison_key(Ecosystem.NPM, "foo_bar")
    assert comparison_key(Ecosystem.GO, "github.com/A/B") == "github.com/a/b"
