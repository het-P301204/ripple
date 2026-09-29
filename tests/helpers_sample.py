"""Hand-built ScanResult + lockfile fixtures for the CLI/report/server tests (no engine needed)."""
from __future__ import annotations

import json

import pytest

from ripple.models import (
    AttackSurface,
    Category,
    Ecosystem,
    EcosystemSummary,
    EvidenceItem,
    Finding,
    LookalikeCandidate,
    LookalikeGroup,
    Package,
    Remediation,
    RiskDriver,
    ScanOptions,
    ScanResult,
    ScanSource,
    ScanSummary,
    Severity,
    SeverityCounts,
)


@pytest.fixture()
def ripple_home(tmp_path, monkeypatch):
    home = tmp_path / "ripple-home"
    monkeypatch.setenv("RIPPLE_HOME", str(home))
    return home


def _finding(i: int, **kw) -> Finding:
    base = dict(
        id=f"RIP-{i:04d}",
        package_id="npm:@acme/internal-utils@2.4.0",
        package="@acme/internal-utils",
        version="2.4.0",
        ecosystem=Ecosystem.NPM,
        category=Category.DEPENDENCY_CONFUSION,
        title="Dependency Confusion Candidate",
        severity=Severity.CRITICAL,
        risk_score=91,
        confidence=0.93,
        summary="Internal-looking package is not registered publicly and resolves via a range.",
        why_flagged="Scope looks private and the name is unclaimed on the public registry.",
        attack_vector="An attacker could register the name publicly and win version resolution.",
        evidence=[EvidenceItem(label="Public registry", value="404 Not Found"),
                  EvidenceItem(label="Spec", value="^2.4.0")],
        drivers=[RiskDriver(label="Internal-looking name", points=30, detail="scope @acme"),
                 RiskDriver(label="Unregistered publicly", points=40, detail="404"),
                 RiskDriver(label="Range resolution", points=21, detail="caret range")],
        remediation=[Remediation(title="Claim the name", detail="Register a placeholder package."),
                     Remediation(title="Pin exact version", detail="Use integrity hashes.")],
        resolution_type="range",
        dependency_source="services/api/package-lock.json",
        registry="https://registry.npmjs.org",
        detected_at="2026-09-29T10:00:00Z",
        public_status="not_found",
        rule_id="RIPPLE-DC-001",
    )
    base.update(kw)
    return Finding(**base)


def sample_scan(scan_id: str = "scan-sample-0001", mode: str = "offline", created_at: str = "2026-09-29T10:00:00Z",
                project: str = "payments-api") -> ScanResult:
    findings = [
        _finding(1),
        _finding(2, package_id="pypi:requets@2.0.0", package="requets", version="2.0.0", ecosystem=Ecosystem.PYPI,
                 category=Category.TYPOSQUATTING, title="Likely Typosquat", severity=Severity.HIGH, risk_score=72,
                 confidence=0.8, rule_id="RIPPLE-TS-001", related_package="requests",
                 dependency_source="requirements.txt", registry="https://pypi.org", public_status="registered",
                 resolution_type="exact"),
        _finding(3, package_id="npm:=cmd|calc@1.0.0", package="=cmd|'/c calc'!A1", version="1.0.0",
                 category=Category.SUSPICIOUS_METADATA, title="Suspicious [bold red]Metadata[/]",
                 severity=Severity.MEDIUM, risk_score=48, confidence=0.6, rule_id="RIPPLE-SM-001",
                 summary="+ starts with a plus; installs a postinstall script", public_status="registered"),
        _finding(4, package_id="rust:serde@1.0.0", package="serde", version="1.0.0", ecosystem=Ecosystem.RUST,
                 category=Category.REGISTRY_EXPOSURE, title="Insecure Registry Channel", severity=Severity.LOW,
                 risk_score=20, confidence=0.9, rule_id="RIPPLE-RE-001", dependency_source="Cargo.lock",
                 registry="https://crates.io", public_status="registered", resolution_type="exact"),
        _finding(5, package_id="npm:left-pad@1.3.0", package="left-pad", version="1.3.0",
                 category=Category.REGISTRY_EXPOSURE, title="Insecure Registry Channel", severity=Severity.LOW,
                 risk_score=18, confidence=0.9, rule_id="RIPPLE-RE-002", public_status="registered"),
    ]
    packages = [
        Package(id="npm:@acme/internal-utils@2.4.0", name="@acme/internal-utils", version="2.4.0", ecosystem=Ecosystem.NPM,
                registry="https://registry.npmjs.org", risk_score=91, severity=Severity.CRITICAL,
                source_file="services/api/package-lock.json", finding_ids=["RIP-0001"], confusion=True,
                internal_looking=True),
        Package(id="pypi:requets@2.0.0", name="requets", version="2.0.0", ecosystem=Ecosystem.PYPI,
                registry="https://pypi.org", risk_score=72, severity=Severity.HIGH, source_file="requirements.txt",
                finding_ids=["RIP-0002"], typosquat=True),
        Package(id="rust:serde@1.0.0", name="serde", version="1.0.0", ecosystem=Ecosystem.RUST,
                registry="https://crates.io", source_file="Cargo.lock"),
    ]
    counts = SeverityCounts(critical=1, high=1, medium=1, low=2)
    return ScanResult(
        id=scan_id, project=project, created_at=created_at, duration_ms=1234, mode=mode, version="1.0.0",
        source=ScanSource(kind="file", files=["services/api/package-lock.json", "requirements.txt", "Cargo.lock"]),
        options=ScanOptions(),
        summary=ScanSummary(
            total_dependencies=3, direct_dependencies=3, public_packages=2, internal_looking=1,
            confusion_candidates=1, typosquat_candidates=1, suspicious_metadata=1, registry_exposure=2,
            ecosystems=3, total_findings=5, risk_score=72, risk_label="high", severity_counts=counts,
            attack_surface=AttackSurface(dependency_confusion=1, typosquatting=1, suspicious_metadata=1,
                                         registry_exposure=2),
            score_drivers=["1 critical dependency-confusion candidate", "1 likely typosquat"],
        ),
        ecosystems=[
            EcosystemSummary(ecosystem=Ecosystem.NPM, lockfiles=["services/api/package-lock.json"], total=1, direct=1,
                             confusion=1, risk_score=91, severity_counts=SeverityCounts(critical=1)),
            EcosystemSummary(ecosystem=Ecosystem.PYPI, lockfiles=["requirements.txt"], total=1, direct=1, typosquat=1,
                             risk_score=72, severity_counts=SeverityCounts(high=1)),
            EcosystemSummary(ecosystem=Ecosystem.RUST, lockfiles=["Cargo.lock"], total=1, direct=1, exposure=1,
                             risk_score=20, severity_counts=SeverityCounts(low=1)),
        ],
        packages=packages,
        findings=findings,
        lookalikes=[LookalikeGroup(original="requests", original_package_id="pypi:requests@2.31.0",
                                   ecosystem=Ecosystem.PYPI, candidates=[
                                       LookalikeCandidate(name="requets", mutation="deletion", similarity=0.86,
                                                          distance=1, registered=True, suspicion_score=72,
                                                          severity=Severity.HIGH)])],
        warnings=["PyPI registry unavailable - 1 package unverified"],
    )


# Tiny real lockfiles for CLI/server end-to-end tests against the real engine ---------------------------

PACKAGE_LOCK = json.dumps({
    "name": "demo-app", "version": "1.0.0", "lockfileVersion": 3, "requires": True,
    "packages": {
        "": {"name": "demo-app", "version": "1.0.0", "dependencies": {"left-pad": "^1.3.0", "@acme/internal-utils": "^2.4.0"}},
        "node_modules/left-pad": {"version": "1.3.0", "resolved": "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
                                  "integrity": "sha512-" + "A" * 86 + "=="},
        "node_modules/@acme/internal-utils": {"version": "2.4.0",
                                              "resolved": "http://npm.internal.acme.example/@acme/internal-utils/-/internal-utils-2.4.0.tgz"},
    },
}, indent=2)

REQUIREMENTS = "requests==2.31.0\nrequets==2.0.0\nflask>=2.0\n"
CARGO_LOCK = (
    '# This file is automatically @generated by Cargo.\nversion = 3\n\n'
    '[[package]]\nname = "serde"\nversion = "1.0.190"\n'
    'source = "registry+https://github.com/rust-lang/crates.io-index"\n'
    'checksum = "' + "a" * 64 + '"\n'
)


# ---------------------------------------------------------------------------------------------------------
# A fake engine so server/job tests are deterministic and can provoke failures/progress states.
# ---------------------------------------------------------------------------------------------------------
import asyncio  # noqa: E402
import sys  # noqa: E402
import threading  # noqa: E402
import types  # noqa: E402
import uuid  # noqa: E402
from dataclasses import dataclass  # noqa: E402

from ripple.models import STAGES  # noqa: E402

FAKE_SUPPORTED = {"package-lock.json", "requirements.txt", "cargo.lock", "go.mod", "go.sum"}


@dataclass
class FakeScanInput:
    filename: str
    content: object


class FakeEngine:
    def __init__(self):
        self.gate = None                 # threading.Event: when set on the instance, run_scan blocks after stage 1
        self.calls = []                  # (options, project, source, [filenames])
        self.demo_builds = 0

    # engine interface -----------------------------------------------------------------------------
    def detect(self, filename, content):
        base = filename.replace("\\", "/").rsplit("/", 1)[-1]
        low = base.lower()
        ok = low in FAKE_SUPPORTED or (low.startswith("requirements") and low.endswith(".txt"))
        return {"filename": filename, "ecosystem": "npm" if base.lower().startswith("package") else ("pypi" if ok else None),
                "supported": ok, "kind": base if ok else None, "dependency_count": 3 if ok else None,
                "error": None if ok else "Unsupported lockfile"}

    async def run_scan(self, inputs, options, *, project=None, registries=None, progress=None, source=None,
                       cache_dir=None, **_kw):
        self.calls.append((options, project, source, [i.filename for i in inputs]))
        for n, (sid, _label) in enumerate(STAGES):
            if progress:
                progress(sid, "active", "", 0.0)
                progress(sid, "active", "", 0.5)
            if n == 1 and self.gate is not None:
                await asyncio.get_running_loop().run_in_executor(None, self.gate.wait, 10)
            if progress:
                progress(sid, "done", f"{sid} finished", 1.0)
        payload = b"".join(i.content if isinstance(i.content, bytes) else i.content.encode() for i in inputs)
        if b"BOOM" in payload:
            raise RuntimeError(r"secret internal detail C:\Users\victim\repo\engine.py line 42")
        if b"BADPARSE" in payload:
            raise ValueError(r"bad token at C:\secret\path")
        if b"REGDOWN" in payload:
            class RegistryError(Exception):
                pass

            raise RegistryError("HTTP 503 from https://registry.internal.example/token=abc")
        scan = sample_scan(scan_id=f"scan-{uuid.uuid4().hex[:10]}", project=project or "project")
        return scan

    def build_demo_scan(self):
        self.demo_builds += 1
        return sample_scan(scan_id="scan-demo-payments-api", mode="demo", created_at="2026-09-29T09:00:00Z",
                           project="payments-api")

    def demo_inputs(self):
        return [FakeScanInput("package-lock.json", PACKAGE_LOCK)]


def install_fake_engine(monkeypatch) -> FakeEngine:
    fake = FakeEngine()
    eng = types.ModuleType("ripple.engine")
    eng.ScanInput = FakeScanInput
    eng.detect = fake.detect
    eng.run_scan = fake.run_scan
    demo = types.ModuleType("ripple.demo")
    demo.build_demo_scan = fake.build_demo_scan
    demo.demo_inputs = fake.demo_inputs
    monkeypatch.setitem(sys.modules, "ripple.engine", eng)
    monkeypatch.setitem(sys.modules, "ripple.demo", demo)
    return fake


@pytest.fixture()
def fake_engine(monkeypatch):
    return install_fake_engine(monkeypatch)
