"""SARIF 2.1.0 structure tests (lightweight structural validator; no network, no external schema)."""
import json

import pytest

from helpers_sample import sample_scan
from ripple.reports.sarif import LEVEL_FOR_SEVERITY, security_severity, to_sarif, to_sarif_dict

LEVELS = {"error", "warning", "note", "none"}


def validate_sarif(doc: dict) -> None:
    """Structural subset of the SARIF 2.1.0 schema that GitHub code scanning relies on."""
    assert doc["version"] == "2.1.0"
    assert doc["$schema"].endswith("sarif-2.1.0.json")
    assert isinstance(doc["runs"], list) and len(doc["runs"]) == 1
    run = doc["runs"][0]
    driver = run["tool"]["driver"]
    assert driver["name"] == "RIPPLE"
    assert isinstance(driver["version"], str) and driver["version"]
    assert driver["informationUri"].startswith("https://")
    rules = driver["rules"]
    ids = [r["id"] for r in rules]
    assert len(ids) == len(set(ids)), "rule ids must be unique"
    for r in rules:
        assert r["shortDescription"]["text"]
        assert r["help"]["text"]
        assert r["defaultConfiguration"]["level"] in LEVELS
        assert 0.0 <= float(r["properties"]["security-severity"]) <= 10.0
    for res in run["results"]:
        assert res["ruleId"] in ids
        assert rules[res["ruleIndex"]]["id"] == res["ruleId"], "ruleIndex must point at the matching rule"
        assert res["level"] in LEVELS
        assert isinstance(res["message"]["text"], str) and res["message"]["text"]
        loc = res["locations"][0]["physicalLocation"]
        assert loc["artifactLocation"]["uri"]
        assert "\\" not in loc["artifactLocation"]["uri"]
        assert loc["region"]["startLine"] >= 1
        assert all(isinstance(v, str) and v for v in res["partialFingerprints"].values())
        props = res["properties"]
        for key in ("risk_score", "confidence", "ecosystem", "package", "version", "category", "drivers",
                    "security-severity"):
            assert key in props, key
        assert 0.0 <= float(props["security-severity"]) <= 10.0
        assert isinstance(props["security-severity"], str)


def test_sarif_is_valid_and_consistent():
    scan = sample_scan()
    doc = json.loads(to_sarif(scan))
    validate_sarif(doc)
    run = doc["runs"][0]
    assert len(run["results"]) == len(scan.findings)
    used = {r["ruleId"] for r in run["results"]}
    declared = {r["id"] for r in run["tool"]["driver"]["rules"]}
    assert used == declared, "rules[] must be exactly the distinct rule ids used by results[]"


def test_levels_map_from_severity():
    doc = to_sarif_dict(sample_scan())
    by_id = {r["properties"]["finding_id"]: r for r in doc["runs"][0]["results"]}
    assert by_id["RIP-0001"]["level"] == "error"    # critical
    assert by_id["RIP-0002"]["level"] == "error"    # high
    assert by_id["RIP-0003"]["level"] == "warning"  # medium
    assert by_id["RIP-0004"]["level"] == "note"     # low
    assert LEVEL_FOR_SEVERITY["info"] == "note"


def test_security_severity_from_risk_score():
    assert security_severity(0) == "0.0"
    assert security_severity(72) == "7.2"
    assert security_severity(100) == "10.0"
    assert security_severity(250) == "10.0"
    doc = to_sarif_dict(sample_scan())
    first = doc["runs"][0]["results"][0]
    assert first["properties"]["security-severity"] == "9.1"


def test_rule_default_level_is_worst_severity_of_its_results():
    doc = to_sarif_dict(sample_scan())
    rules = {r["id"]: r for r in doc["runs"][0]["tool"]["driver"]["rules"]}
    assert rules["RIPPLE-DC-001"]["defaultConfiguration"]["level"] == "error"
    assert rules["RIPPLE-RE-001"]["defaultConfiguration"]["level"] == "note"


def test_location_falls_back_when_lockfile_unknown():
    scan = sample_scan()
    scan.findings[0].dependency_source = ""
    doc = to_sarif_dict(scan)
    uri = doc["runs"][0]["results"][0]["locations"][0]["physicalLocation"]["artifactLocation"]["uri"]
    assert uri == "services/api/package-lock.json"  # first scanned source file
    scan.source.files = []
    doc = to_sarif_dict(scan)
    uri = doc["runs"][0]["results"][0]["locations"][0]["physicalLocation"]["artifactLocation"]["uri"]
    assert uri == "unknown-lockfile"


def test_windows_paths_are_normalised():
    scan = sample_scan()
    scan.findings[0].dependency_source = ".\\services\\api\\package-lock.json"
    doc = to_sarif_dict(scan)
    assert doc["runs"][0]["results"][0]["locations"][0]["physicalLocation"]["artifactLocation"]["uri"] == \
        "services/api/package-lock.json"


def test_fingerprints_are_stable_and_distinct():
    a = to_sarif_dict(sample_scan())
    b = to_sarif_dict(sample_scan())
    fa = [r["partialFingerprints"]["rippleFinding/v1"] for r in a["runs"][0]["results"]]
    fb = [r["partialFingerprints"]["rippleFinding/v1"] for r in b["runs"][0]["results"]]
    assert fa == fb
    assert len(set(fa)) == len(fa)


def test_empty_scan_is_valid_sarif():
    scan = sample_scan()
    scan.findings = []
    doc = json.loads(to_sarif(scan))
    validate_sarif(doc)
    assert doc["runs"][0]["results"] == []
    assert doc["runs"][0]["tool"]["driver"]["rules"] == []


def test_validates_against_jsonschema_subset_when_available():
    jsonschema = pytest.importorskip("jsonschema")
    schema = {
        "type": "object", "required": ["version", "runs"],
        "properties": {
            "version": {"const": "2.1.0"},
            "runs": {"type": "array", "minItems": 1, "items": {
                "type": "object", "required": ["tool", "results"],
                "properties": {
                    "tool": {"type": "object", "required": ["driver"], "properties": {
                        "driver": {"type": "object", "required": ["name"]}}},
                    "results": {"type": "array", "items": {
                        "type": "object", "required": ["message"],
                        "properties": {"level": {"enum": ["none", "note", "warning", "error"]},
                                       "message": {"type": "object", "required": ["text"]}}}},
                }}},
        },
    }
    jsonschema.validate(to_sarif_dict(sample_scan()), schema)
