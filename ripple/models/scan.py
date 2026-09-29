from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from .finding import Finding
from .package import Ecosystem, Package, Severity

# Ordered pipeline stages. The engine emits a ProgressEvent as each stage starts/finishes;
# the UI renders exactly these (never a fake timer).
STAGES: list[tuple[str, str]] = [
    ("parse", "Lockfile parsed"),
    ("discover", "Dependencies discovered"),
    ("registry", "Registry metadata collected"),
    ("typosquat", "Typosquatting variants analysed"),
    ("metadata", "Metadata risk profiled"),
    ("score", "Risk profiles calculated"),
    ("graph", "Attack surface built"),
]


class CheckKind(str, Enum):
    CONFUSION = "confusion"
    TYPOSQUAT = "typosquat"
    METADATA = "metadata"
    EXPOSURE = "exposure"


ALL_CHECKS = [c.value for c in CheckKind]


class ScanOptions(BaseModel):
    checks: list[str] = Field(default_factory=lambda: list(ALL_CHECKS))
    ecosystem: Optional[Ecosystem] = None      # manual override; None = auto-detect
    live: bool = False                         # True = query real registries (read-only GET); False = offline heuristics
    max_edit_distance: int = 2
    rate_limit_rps: float = 5.0
    timeout_s: float = 10.0
    cache_ttl_s: int = 3600
    internal_scopes: list[str] = Field(default_factory=list)    # user-declared private scopes/prefixes, e.g. ["@acme", "acme-"]
    registry_overrides: dict[str, str] = Field(default_factory=dict)  # ecosystem -> registry URL


class ScanSource(BaseModel):
    kind: str = "file"                          # "demo" | "file" | "folder"
    files: list[str] = Field(default_factory=list)


class SeverityCounts(BaseModel):
    critical: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0
    info: int = 0


class AttackSurface(BaseModel):
    dependency_confusion: int = 0
    typosquatting: int = 0
    suspicious_metadata: int = 0
    registry_exposure: int = 0


class EcosystemSummary(BaseModel):
    ecosystem: Ecosystem
    lockfiles: list[str] = Field(default_factory=list)
    registry: str = ""
    total: int = 0
    direct: int = 0
    public: int = 0
    internal_looking: int = 0
    confusion: int = 0
    typosquat: int = 0
    suspicious: int = 0
    exposure: int = 0
    registry_coverage: float = 0.0              # 0..1 share of packages whose registry status is known
    risk_score: int = 0
    severity_counts: SeverityCounts = Field(default_factory=SeverityCounts)


class ScanSummary(BaseModel):
    total_dependencies: int = 0
    direct_dependencies: int = 0
    public_packages: int = 0
    internal_looking: int = 0
    confusion_candidates: int = 0
    typosquat_candidates: int = 0
    suspicious_metadata: int = 0
    registry_exposure: int = 0
    ecosystems: int = 0
    total_findings: int = 0
    risk_score: int = 0                         # overall 0..100
    risk_label: str = "info"                    # Severity value for the overall score
    severity_counts: SeverityCounts = Field(default_factory=SeverityCounts)
    attack_surface: AttackSurface = Field(default_factory=AttackSurface)
    score_drivers: list[str] = Field(default_factory=list)   # human-readable explanation of overall score


class Edge(BaseModel):
    source: str      # package id
    target: str      # package id
    kind: str = "depends"   # "depends" | "dev"


class LookalikeCandidate(BaseModel):
    name: str
    mutation: str                               # transposition|insertion|deletion|substitution|homoglyph|separator|prefix_suffix
    similarity: float                           # 0..1 normalized (1 - dl_distance/max_len)
    distance: int                               # Damerau-Levenshtein
    registered: bool                            # exists on the public registry
    registered_at: Optional[str] = None
    weekly_downloads: Optional[int] = None
    maintainers: list[str] = Field(default_factory=list)
    install_scripts: list[str] = Field(default_factory=list)   # e.g. ["postinstall"]
    suspicion_score: int = 0                    # 0..100
    severity: Severity = Severity.INFO
    drivers: list[str] = Field(default_factory=list)


class LookalikeGroup(BaseModel):
    original: str
    original_package_id: str
    ecosystem: Ecosystem
    original_weekly_downloads: Optional[int] = None
    candidates: list[LookalikeCandidate] = Field(default_factory=list)   # sorted by suspicion desc, only registered ones + top unregistered variants


class ScanResult(BaseModel):
    id: str
    project: str
    created_at: str
    duration_ms: int = 0
    mode: str = "offline"                       # "offline" | "live" | "demo"
    version: str = ""
    source: ScanSource = Field(default_factory=ScanSource)
    options: ScanOptions = Field(default_factory=ScanOptions)
    summary: ScanSummary = Field(default_factory=ScanSummary)
    ecosystems: list[EcosystemSummary] = Field(default_factory=list)
    packages: list[Package] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)      # sorted by risk_score desc
    edges: list[Edge] = Field(default_factory=list)
    lookalikes: list[LookalikeGroup] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)           # e.g. "PyPI registry unavailable — 12 packages unverified"


class ScanHistoryEntry(BaseModel):
    id: str
    project: str
    created_at: str
    mode: str
    dependencies: int
    findings: int
    risk_score: int
    risk_label: str
    ecosystems: list[str]


class ProgressStage(BaseModel):
    id: str
    label: str
    state: str = "pending"        # pending | active | done | error | skipped
    detail: str = ""              # "187 dependencies discovered"


class JobStatus(BaseModel):
    job_id: str
    status: str = "queued"        # queued | running | done | error
    progress: float = 0.0         # 0..1 (derived from real stage completion + per-registry request counts)
    stages: list[ProgressStage] = Field(default_factory=list)
    scan_id: Optional[str] = None
    error: Optional[str] = None           # user-safe message, never a stack trace
    error_code: Optional[str] = None      # "unsupported_lockfile" | "registry_unavailable" | "parse_error" | "internal"
