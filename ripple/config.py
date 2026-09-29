"""RIPPLE configuration: home directory, paths and persisted settings.

Settings mirror the ``Settings`` TypeScript type in ``web/src/types/scan.ts``.
Everything lives under ``~/.ripple`` unless ``RIPPLE_HOME`` is set (used by tests).
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .security import escape_controls, validate_registry_url

DEFAULT_REGISTRIES: dict[str, str] = {
    "npm": "https://registry.npmjs.org",
    "pypi": "https://pypi.org",
    "go": "https://proxy.golang.org",
    "rust": "https://crates.io",
}

FALLBACK_VERSION = "1.0.0"


def get_version() -> str:
    """Package version, imported defensively (``ripple/__init__.py`` is owned by the engine)."""
    try:
        from ripple import __version__  # type: ignore

        return str(__version__)
    except Exception:  # pragma: no cover - depends on engine agent
        return FALLBACK_VERSION


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

def home_dir() -> Path:
    override = os.environ.get("RIPPLE_HOME")
    base = Path(override).expanduser() if override else Path.home() / ".ripple"
    return base


def _private_mkdir(p: Path) -> None:
    """Create ``p`` (and parents) owner-only where the OS supports it: scan history lists a project's
    dependencies and private registry hosts, which other local users have no business reading."""
    try:
        p.mkdir(parents=True, exist_ok=True, mode=0o700)
    except OSError:
        p.mkdir(parents=True, exist_ok=True)


def scans_dir(create: bool = True) -> Path:
    p = home_dir() / "scans"
    if create:
        _private_mkdir(p)
    return p


def cache_dir(create: bool = True) -> Path:
    override = os.environ.get("RIPPLE_CACHE_DIR")     # same override the registry layer documents
    p = Path(override).expanduser() if override else home_dir() / "cache"
    if create:
        _private_mkdir(p)
    return p


def settings_path() -> Path:
    return home_dir() / "settings.json"


# ---------------------------------------------------------------------------
# Settings model
# ---------------------------------------------------------------------------

class Thresholds(BaseModel):
    critical: int = 80
    high: int = 60
    medium: int = 35
    low: int = 15

    @field_validator("critical", "high", "medium", "low")
    @classmethod
    def _range(cls, v: int) -> int:
        if not 0 <= v <= 100:
            raise ValueError("thresholds must be between 0 and 100")
        return v

    def check_order(self) -> None:
        if not (self.critical > self.high > self.medium > self.low >= 0):
            raise ValueError("thresholds must satisfy critical > high > medium > low >= 0")


class ScannerSettings(BaseModel):
    max_edit_distance: int = Field(default=2, ge=1, le=3)
    rate_limit_rps: float = Field(default=5.0, gt=0, le=50)
    timeout_s: float = Field(default=10.0, gt=0, le=120)
    cache_ttl_s: int = Field(default=3600, ge=0, le=7 * 86400)
    thresholds: Thresholds = Field(default_factory=Thresholds)
    internal_scopes: list[str] = Field(default_factory=list)

    @field_validator("internal_scopes")
    @classmethod
    def _scopes(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for s in v:
            s = escape_controls(s).strip()
            if s and len(s) <= 128 and s not in out:
                out.append(s)
            if len(out) >= 50:
                break
        return out


class OutputSettings(BaseModel):
    default_format: Literal["rich", "json", "sarif", "csv"] = "rich"


class Settings(BaseModel):
    registries: dict[str, str] = Field(default_factory=lambda: dict(DEFAULT_REGISTRIES))
    scanner: ScannerSettings = Field(default_factory=ScannerSettings)
    output: OutputSettings = Field(default_factory=OutputSettings)

    @field_validator("registries")
    @classmethod
    def _registries(cls, v: dict[str, str]) -> dict[str, str]:
        merged = dict(DEFAULT_REGISTRIES)
        for eco, url in v.items():
            if eco not in DEFAULT_REGISTRIES:
                raise ValueError(f"unknown ecosystem '{eco}'")
            try:
                # http(s) only; no credentials/query/fragment; never link-local or cloud-metadata addresses
                merged[eco] = validate_registry_url(str(url))
            except ValueError as exc:
                raise ValueError(f"invalid registry URL for {eco}: {exc}") from None
        return merged

    def registry_overrides(self) -> dict[str, str]:
        """Registry URLs that differ from the public defaults (fed into ScanOptions)."""
        return {k: v for k, v in self.registries.items() if v != DEFAULT_REGISTRIES.get(k)}

    def to_public(self) -> dict:
        return self.model_dump(mode="json")


def default_settings() -> Settings:
    return Settings()


def _deep_merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_settings() -> Settings:
    """Load settings; a missing/corrupt file yields defaults (never raises)."""
    path = settings_path()
    defaults = default_settings().model_dump(mode="json")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("settings root must be an object")
        s = Settings.model_validate(_deep_merge(defaults, raw))
        s.scanner.thresholds.check_order()
        return s
    except FileNotFoundError:
        return default_settings()
    except Exception:
        return default_settings()


def save_settings(settings: Settings) -> Settings:
    """Validate and persist settings atomically. Raises ``ValueError`` on invalid input."""
    settings = Settings.model_validate(settings.model_dump())
    settings.scanner.thresholds.check_order()
    _private_mkdir(home_dir())
    fd, tmp = tempfile.mkstemp(prefix="settings.", suffix=".tmp", dir=str(home_dir()))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(settings.model_dump(mode="json"), fh, indent=2, sort_keys=True)
            fh.write("\n")
        os.replace(tmp, settings_path())
    finally:
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass
    return settings


def parse_settings(payload: dict) -> Settings:
    """Validate a client payload against the schema, merged over defaults."""
    merged = _deep_merge(default_settings().model_dump(mode="json"), payload)
    s = Settings.model_validate(merged)
    s.scanner.thresholds.check_order()
    return s
