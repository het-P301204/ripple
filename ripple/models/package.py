"""Package-level models. This module is part of the RIPPLE contract — the
TypeScript mirror lives in web/src/types/scan.ts. Keep them in sync."""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class Ecosystem(str, Enum):
    NPM = "npm"
    PYPI = "pypi"
    GO = "go"
    RUST = "rust"


class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


SEVERITY_ORDER = [Severity.CRITICAL, Severity.HIGH, Severity.MEDIUM, Severity.LOW, Severity.INFO]

# Score → severity thresholds (inclusive lower bounds). Single source of truth.
SEVERITY_THRESHOLDS = {
    Severity.CRITICAL: 80,
    Severity.HIGH: 60,
    Severity.MEDIUM: 35,
    Severity.LOW: 15,
    Severity.INFO: 0,
}


def severity_for_score(score: int | float) -> Severity:
    for sev in SEVERITY_ORDER:
        if score >= SEVERITY_THRESHOLDS[sev]:
            return sev
    return Severity.INFO


class Resolution(str, Enum):
    """How the dependency version is resolved."""
    EXACT = "exact"      # pinned to a single version, no integrity hash
    HASHED = "hashed"    # pinned + integrity hash (best case)
    RANGE = "range"      # semver / PEP 440 range (^1.2.0, >=2, ~=1.4, ...)
    VCS = "vcs"          # git / url dependency
    LOCAL = "local"      # path / file / replace directive
    UNKNOWN = "unknown"


class PublicStatus(str, Enum):
    REGISTERED = "registered"   # exists on the public registry
    NOT_FOUND = "not_found"     # registry returned 404
    UNKNOWN = "unknown"         # not checked (offline mode / check disabled)
    ERROR = "error"             # registry query failed (rate limit, timeout, 5xx)


class PackageStatus(str, Enum):
    CLEAN = "clean"
    FLAGGED = "flagged"
    UNVERIFIED = "unverified"   # registry data unavailable


class InstallScripts(BaseModel):
    """Lifecycle scripts. Values are the script text (truncated to 500 chars)."""
    preinstall: Optional[str] = None
    install: Optional[str] = None
    postinstall: Optional[str] = None
    prepare: Optional[str] = None
    build_script: bool = False   # crates: build.rs present / pypi: sdist-only (setup.py executes on install)

    def any(self) -> bool:
        return bool(self.preinstall or self.install or self.postinstall or self.prepare or self.build_script)


class PackageMetadata(BaseModel):
    """Public-registry metadata (read-only GET results)."""
    registered_at: Optional[str] = None          # ISO timestamp of first publication
    latest_version: Optional[str] = None
    latest_published_at: Optional[str] = None
    versions_count: Optional[int] = None
    weekly_downloads: Optional[int] = None
    maintainers: list[str] = Field(default_factory=list)
    maintainer_changes: int = 0                  # count of maintainer set changes in the observed window
    install_scripts: InstallScripts = Field(default_factory=InstallScripts)
    network_indicators: list[str] = Field(default_factory=list)  # e.g. "curl in postinstall", "http:// URL in script"
    repository_url: Optional[str] = None
    description: Optional[str] = None
    deprecated: bool = False
    version_gap: Optional[int] = None            # major-version distance between resolved and latest
    age_days: Optional[int] = None               # days since registered_at (at scan time)


class Package(BaseModel):
    id: str                                      # f"{ecosystem}:{name}@{version}"
    name: str                                    # normalized (PEP 503 for PyPI, lowercase crates keep '-'/'_' as declared)
    version: str                                 # resolved version from the lockfile ("" if unknown)
    spec: Optional[str] = None                   # the requested range/specifier if it differs from `version`
    ecosystem: Ecosystem
    registry: str                                # public registry base URL used for this ecosystem
    registry_source: Optional[str] = None        # where the lockfile says it was resolved from (URL / index)
    resolution: Resolution = Resolution.UNKNOWN
    integrity: Optional[str] = None              # sha512-..., sha256:..., h1:... (go.sum), checksum (Cargo)
    dev: bool = False
    direct: bool = True                          # declared directly by the project (vs transitive)
    depth: int = 0
    dependencies: list[str] = Field(default_factory=list)   # package ids this package depends on
    dependents_count: int = 0
    source_file: str = ""                        # lockfile the package came from
    public_status: PublicStatus = PublicStatus.UNKNOWN
    internal_looking: bool = False
    internal_reasons: list[str] = Field(default_factory=list)
    metadata: Optional[PackageMetadata] = None
    risk_score: int = 0                          # max risk across the package's findings (0 if none)
    severity: Severity = Severity.INFO
    status: PackageStatus = PackageStatus.CLEAN
    finding_ids: list[str] = Field(default_factory=list)
    confusion: bool = False                      # flagged as dependency-confusion candidate
    typosquat: bool = False                      # flagged as likely typosquat OR has registered look-alikes
    metadata_flag: bool = False                  # suspicious metadata signals
    registry_exposure: bool = False
