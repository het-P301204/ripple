"""Go module proxy (proxy.golang.org). GET-only. The proxy exposes versions and timestamps only."""
from __future__ import annotations

import re
from urllib.parse import quote

from ..models import Ecosystem
from ..parsers.normalize import go_escape, normalize_go
from .base import ReadOnlyClient, Registry, RegistryError, RegistryRecord, valid_lookup_name


class GoRegistry(Registry):
    ecosystem = Ecosystem.GO

    def __init__(self, client: ReadOnlyClient, base_url: str = "https://proxy.golang.org"):
        self.client = client
        self.base_url = base_url.rstrip("/")

    def _mod(self, name: str) -> str:
        return quote(go_escape(normalize_go(name)), safe="/!.-_~")

    async def get_package(self, name: str) -> RegistryRecord | None:
        name = normalize_go(name)
        if not valid_lookup_name(name, max_slashes=32):
            return None                         # cannot be a Go module path: never placed in a URL
        mod = self._mod(name)
        latest = await self.client.fetch_json(f"{self.base_url}/{mod}/@latest")
        if latest is None:
            return None
        if not isinstance(latest, dict):
            raise RegistryError("Unexpected Go proxy response.")
        versions: list[str] = []
        try:
            text = await self.client.fetch_text(f"{self.base_url}/{mod}/@v/list")
            versions = [v.strip() for v in (text or "").splitlines() if v.strip()]
        except RegistryError:
            pass
        first_time: str | None = None
        versions = [v for v in versions if _SAFE_VERSION.fullmatch(v)][:20000]
        first = _lowest(versions)
        if first:
            try:
                info = await self.client.fetch_json(f"{self.base_url}/{mod}/@v/{quote(go_escape(first), safe='')}.info")
                if isinstance(info, dict):
                    first_time = info.get("Time")
            except RegistryError:
                pass
        try:
            return RegistryRecord(
                ecosystem=Ecosystem.GO, name=name, exists=True, registered_at=first_time or latest.get("Time"),
                latest_version=latest.get("Version"), latest_published_at=latest.get("Time"),
                versions=versions or ([latest["Version"]] if latest.get("Version") else []),
                repository_url=f"https://{name}" if name.startswith(("github.com/", "gitlab.com/")) else None,
            )
        except Exception:   # malformed registry data (incl. pydantic.ValidationError, OverflowError)
            raise RegistryError("Malformed Go proxy response.") from None

    async def aclose(self) -> None:
        await self.client.aclose()

    @property
    def request_count(self) -> int:
        return self.client.request_count


_SAFE_VERSION = re.compile(r"[A-Za-z0-9._+~!-]{1,128}")


def _semver_key(v: str) -> tuple:
    core = v.lstrip("v").split("+", 1)[0].split("-", 1)
    nums = []
    for p in core[0].split("."):
        nums.append(int(p) if p.isdigit() else 0)
    return (tuple(nums + [0] * (3 - len(nums))), 0 if len(core) > 1 else 1, core[1] if len(core) > 1 else "")


def _lowest(versions: list[str]) -> str | None:
    return min(versions, key=_semver_key) if versions else None
