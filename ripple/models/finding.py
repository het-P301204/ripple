from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from .package import Ecosystem, Severity


class Category(str, Enum):
    DEPENDENCY_CONFUSION = "dependency_confusion"
    TYPOSQUATTING = "typosquatting"
    SUSPICIOUS_METADATA = "suspicious_metadata"
    REGISTRY_EXPOSURE = "registry_exposure"


CATEGORY_LABELS = {
    Category.DEPENDENCY_CONFUSION: "Dependency Confusion",
    Category.TYPOSQUATTING: "Typosquatting",
    Category.SUSPICIOUS_METADATA: "Suspicious Metadata",
    Category.REGISTRY_EXPOSURE: "Registry Exposure",
}


class EvidenceItem(BaseModel):
    label: str
    value: str
    mono: bool = True  # render value in monospace (names, versions, URLs, hashes)


class RiskDriver(BaseModel):
    """One explainable contributor to a risk score. Sum of `points` (clamped to 0..100) == risk_score."""
    label: str           # "Internal-looking name"
    points: int          # +30
    detail: str = ""     # one-line explanation


class Remediation(BaseModel):
    title: str
    detail: str


class Finding(BaseModel):
    id: str                                  # stable, e.g. "RIP-0001" ordered by risk desc
    package_id: str
    package: str                             # display name
    version: str
    ecosystem: Ecosystem
    category: Category
    title: str                               # "Dependency Confusion Candidate"
    severity: Severity
    risk_score: int                          # 0..100
    confidence: float                        # 0..1
    summary: str                             # short explanation for the card
    why_flagged: str                         # detection logic, plain language
    attack_vector: str                       # how exploitation could occur (defender framing)
    evidence: list[EvidenceItem] = Field(default_factory=list)
    drivers: list[RiskDriver] = Field(default_factory=list)
    remediation: list[Remediation] = Field(default_factory=list)
    resolution_type: str = "unknown"         # Resolution value
    dependency_source: str = ""              # lockfile
    registry: str = ""
    detected_at: str = ""                    # ISO timestamp
    public_status: str = "unknown"
    related_package: Optional[str] = None    # typosquat: the legitimate package it resembles / is resembled by
    rule_id: str = ""                        # "RIPPLE-DC-001", used as SARIF ruleId
