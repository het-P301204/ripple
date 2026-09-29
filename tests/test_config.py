import json

import pytest

from helpers_sample import ripple_home  # noqa: F401  (fixture)
from ripple import config


def test_defaults(ripple_home):
    s = config.load_settings()
    assert s.registries == {"npm": "https://registry.npmjs.org", "pypi": "https://pypi.org",
                            "go": "https://proxy.golang.org", "rust": "https://crates.io"}
    assert s.scanner.max_edit_distance == 2 and s.scanner.rate_limit_rps == 5
    assert s.scanner.timeout_s == 10 and s.scanner.cache_ttl_s == 3600
    assert s.scanner.thresholds.model_dump() == {"critical": 80, "high": 60, "medium": 35, "low": 15}
    assert s.scanner.internal_scopes == []
    assert s.output.default_format == "rich"
    assert s.registry_overrides() == {}


def test_paths_follow_ripple_home(ripple_home):
    assert config.home_dir() == ripple_home
    assert config.scans_dir() == ripple_home / "scans" and config.scans_dir().is_dir()
    assert config.cache_dir() == ripple_home / "cache" and config.cache_dir().is_dir()
    assert config.settings_path() == ripple_home / "settings.json"


def test_save_and_reload_roundtrip(ripple_home):
    s = config.load_settings()
    s.scanner.max_edit_distance = 3
    s.scanner.internal_scopes = ["@acme", "acme-", "@acme"]
    s.registries["npm"] = "https://npm.internal.example/"
    s.output.default_format = "json"
    config.save_settings(s)
    again = config.load_settings()
    assert again.scanner.max_edit_distance == 3
    assert again.scanner.internal_scopes == ["@acme", "acme-"]
    assert again.registries["npm"] == "https://npm.internal.example"
    assert again.registry_overrides() == {"npm": "https://npm.internal.example"}
    assert again.output.default_format == "json"
    assert json.loads(config.settings_path().read_text())["scanner"]["thresholds"]["critical"] == 80


def test_corrupt_file_falls_back_to_defaults(ripple_home):
    ripple_home.mkdir(parents=True)
    config.settings_path().write_text("{not json")
    assert config.load_settings().scanner.max_edit_distance == 2


def test_partial_file_is_merged_over_defaults(ripple_home):
    ripple_home.mkdir(parents=True)
    config.settings_path().write_text(json.dumps({"scanner": {"timeout_s": 30}}))
    s = config.load_settings()
    assert s.scanner.timeout_s == 30 and s.scanner.rate_limit_rps == 5 and "go" in s.registries


@pytest.mark.parametrize("payload", [
    {"registries": {"npm": "ftp://evil"}},
    {"registries": {"npm": "javascript:alert(1)"}},
    {"registries": {"cobol": "https://x.example"}},
    {"scanner": {"max_edit_distance": 9}},
    {"scanner": {"rate_limit_rps": 0}},
    {"scanner": {"thresholds": {"critical": 10, "high": 60, "medium": 35, "low": 15}}},
    {"output": {"default_format": "pdf"}},
])
def test_invalid_settings_are_rejected(payload):
    with pytest.raises(ValueError):  # pydantic ValidationError subclasses ValueError
        config.parse_settings(payload)


def test_get_version_is_a_string():
    assert isinstance(config.get_version(), str) and config.get_version()
