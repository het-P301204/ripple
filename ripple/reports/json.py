"""Stable JSON export of a ``ScanResult``."""
from __future__ import annotations

import json as _json

from ripple.models import ScanResult


def to_dict(result: ScanResult) -> dict:
    return result.model_dump(mode="json")


def to_json(result: ScanResult, indent: int | None = 2) -> str:
    """Pretty, key-sorted JSON. Identical input always yields identical output."""
    return _json.dumps(to_dict(result), indent=indent, sort_keys=True, ensure_ascii=False) + "\n"
