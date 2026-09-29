"""Persistent scan history: ``ScanResult`` JSON files under ``~/.ripple/scans``.

For each scan ``<id>.json`` holds the full result; ``<id>.meta.json`` holds the small
``ScanHistoryEntry`` so listing history never has to parse large results.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Optional

from ripple.config import scans_dir
from ripple.models import ScanHistoryEntry, ScanResult
from ripple.security import is_reserved_device_name

_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,80}")
_lock = threading.RLock()


class ScanNotFound(KeyError):
    pass


def sanitize_id(scan_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "-", scan_id)[:80] or "scan"


def valid_id(scan_id: str) -> bool:
    """Ids become file names: letters/digits/``_``/``-`` only (fullmatch: ``$`` would tolerate a trailing newline),
    and never a Windows device name such as ``CON`` or ``NUL``."""
    return isinstance(scan_id, str) and bool(_ID_RE.fullmatch(scan_id)) and not is_reserved_device_name(scan_id)


def _path(scan_id: str) -> Path:
    if not valid_id(scan_id):
        raise ScanNotFound(scan_id)
    return scans_dir() / f"{scan_id}.json"


def _meta_path(scan_id: str) -> Path:
    return scans_dir() / f"{scan_id}.meta.json"


def _atomic_write(path: Path, text: str) -> None:
    fd, tmp = tempfile.mkstemp(prefix=path.stem + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


def entry_for(result: ScanResult) -> ScanHistoryEntry:
    ecos = sorted({e.ecosystem.value if hasattr(e.ecosystem, "value") else str(e.ecosystem) for e in result.ecosystems})
    if not ecos:
        ecos = sorted({p.ecosystem.value for p in result.packages})
    return ScanHistoryEntry(
        id=result.id,
        project=result.project,
        created_at=result.created_at,
        mode=result.mode,
        dependencies=result.summary.total_dependencies,
        findings=result.summary.total_findings,
        risk_score=result.summary.risk_score,
        risk_label=result.summary.risk_label,
        ecosystems=ecos,
    )


def save(result: ScanResult, keep: Optional[int] = None) -> ScanResult:
    """Persist a scan (ids are sanitised to a filesystem-safe form).

    ``keep`` bounds disk growth for long-running servers: after saving, all but the newest ``keep`` scans
    are removed (the scan just saved is never removed). The CLI passes nothing and never prunes.
    """
    if not valid_id(result.id):
        result = result.model_copy(update={"id": sanitize_id(result.id)})
        if not valid_id(result.id):
            result = result.model_copy(update={"id": "scan-" + result.id})
    with _lock:
        _atomic_write(_path(result.id), json.dumps(result.model_dump(mode="json"), ensure_ascii=False))
        _atomic_write(_meta_path(result.id), json.dumps(entry_for(result).model_dump(mode="json")))
        if keep is not None and keep > 0:
            for old in history()[keep:]:
                if old.id != result.id:
                    try:
                        delete(old.id)
                    except (OSError, ScanNotFound):
                        pass
    return result


def load(scan_id: str) -> ScanResult:
    path = _path(scan_id)
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ScanNotFound(scan_id) from exc
    try:
        return ScanResult.model_validate_json(raw)
    except Exception as exc:
        raise ScanNotFound(scan_id) from exc


def exists(scan_id: str) -> bool:
    try:
        return _path(scan_id).is_file()
    except ScanNotFound:
        return False


def delete(scan_id: str) -> bool:
    path = _path(scan_id)
    with _lock:
        if not path.is_file():
            return False
        path.unlink()
        try:
            _meta_path(scan_id).unlink()
        except FileNotFoundError:
            pass
    return True


def history() -> list[ScanHistoryEntry]:
    """Saved scans, newest first."""
    d = scans_dir()
    entries: list[ScanHistoryEntry] = []
    with _lock:
        for p in d.glob("*.json"):
            if p.name.endswith(".meta.json"):
                continue
            sid = p.stem
            meta = _meta_path(sid)
            entry: Optional[ScanHistoryEntry] = None
            try:
                entry = ScanHistoryEntry.model_validate_json(meta.read_text(encoding="utf-8"))
            except Exception:
                try:
                    entry = entry_for(ScanResult.model_validate_json(p.read_text(encoding="utf-8")))
                    _atomic_write(meta, json.dumps(entry.model_dump(mode="json")))
                except Exception:
                    entry = None  # corrupt file: ignore
            if entry is not None:
                entries.append(entry)
    entries.sort(key=lambda e: (e.created_at, e.id), reverse=True)
    return entries


def latest_id() -> Optional[str]:
    h = history()
    return h[0].id if h else None


def resolve(ref: str) -> ScanResult:
    """Resolve ``latest``, a scan id, or a unique id prefix to a stored scan."""
    if ref == "latest":
        sid = latest_id()
        if not sid:
            raise ScanNotFound("latest")
        return load(sid)
    if exists(ref):
        return load(ref)
    matches = [e.id for e in history() if e.id.startswith(ref)] if valid_id(ref) else []
    if len(matches) == 1:
        return load(matches[0])
    raise ScanNotFound(ref)


def ensure_demo() -> ScanResult:
    """Return the stored demo scan, building + saving it once (idempotent)."""
    with _lock:
        for e in history():
            if e.mode == "demo":
                try:
                    return load(e.id)
                except ScanNotFound:
                    continue
        from ripple.demo import build_demo_scan  # engine-owned

        return save(build_demo_scan())
