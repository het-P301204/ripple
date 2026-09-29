"""Two-level (memory + disk) TTL cache for registry responses."""
from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Callable


def default_cache_dir() -> Path:
    """``~/.ripple/cache`` unless overridden with ``RIPPLE_CACHE_DIR``."""
    env = os.environ.get("RIPPLE_CACHE_DIR")
    return Path(env) if env else Path.home() / ".ripple" / "cache"


class ResponseCache:
    """Caches ``(status, body)`` per URL. ``ttl <= 0`` disables caching entirely.

    Only successful (200) and definitive-absent (404) responses are cached - never errors.
    """

    def __init__(self, directory: Path | str | None = None, ttl: float = 3600, *,
                 clock: Callable[[], float] = time.time):
        self.ttl = ttl
        self.directory = Path(directory) if directory else None
        self._clock = clock
        self._mem: dict[str, tuple[float, int, str]] = {}
        self.hits = 0
        self.misses = 0

    @staticmethod
    def _key(url: str) -> str:
        return hashlib.sha256(url.encode("utf-8")).hexdigest()

    def _path(self, key: str) -> Path | None:
        return self.directory / key[:2] / f"{key}.json" if self.directory else None

    def get(self, url: str) -> tuple[int, str] | None:
        if self.ttl <= 0:
            return None
        key = self._key(url)
        now = self._clock()
        item = self._mem.get(key)
        if item and 0 <= now - item[0] <= self.ttl:
            self.hits += 1
            return item[1], item[2]
        path = self._path(key)
        if path is not None:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if 0 <= now - float(data["ts"]) <= self.ttl and int(data["status"]) in (200, 404)                         and isinstance(data["body"], str):   # future timestamps / tampered entries never hit
                    self._mem[key] = (float(data["ts"]), int(data["status"]), data["body"])
                    self.hits += 1
                    return int(data["status"]), data["body"]
            except (OSError, ValueError, KeyError, TypeError):
                pass
        self.misses += 1
        return None

    def put(self, url: str, status: int, body: str) -> None:
        if self.ttl <= 0 or status not in (200, 404):
            return
        key = self._key(url)
        ts = self._clock()
        self._mem[key] = (ts, status, body)
        path = self._path(key)
        if path is not None:
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_suffix(".tmp")
                tmp.write_text(json.dumps({"ts": ts, "status": status, "url": url, "body": body}), encoding="utf-8")
                tmp.replace(path)
            except OSError:
                pass  # cache is best-effort

    def clear(self) -> None:
        self._mem.clear()
        if self.directory and self.directory.exists():
            for p in self.directory.glob("*/*.json"):
                try:
                    p.unlink()
                except OSError:
                    pass
