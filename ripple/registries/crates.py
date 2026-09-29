"""crates.io API. GET-only, descriptive User-Agent (required by crates.io), <= 1 request/second by default."""
from __future__ import annotations

from typing import Any
from urllib.parse import quote

from ..models import Ecosystem
from ..parsers.normalize import normalize_crate
from .base import ReadOnlyClient, Registry, RegistryError, RegistryRecord, truncate, valid_lookup_name


def record_from_crates(name: str, doc: dict[str, Any], owners: list[str]) -> RegistryRecord:
    crate = doc.get("crate") or {}
    versions = doc.get("versions") or []
    nums = [v.get("num") for v in versions if isinstance(v, dict) and v.get("num")]
    latest = crate.get("max_stable_version") or crate.get("max_version") or crate.get("newest_version")
    latest_time = next((v.get("created_at") for v in versions if isinstance(v, dict) and v.get("num") == latest), None)
    recent = crate.get("recent_downloads")
    weekly = int(recent / 13) if isinstance(recent, (int, float)) else None   # recent_downloads covers ~90 days
    yanked_all = bool(versions) and all(v.get("yanked") for v in versions if isinstance(v, dict))
    return RegistryRecord(
        ecosystem=Ecosystem.RUST, name=name, exists=True, registered_at=crate.get("created_at"),
        latest_version=latest, latest_published_at=latest_time, versions=nums, weekly_downloads=weekly,
        maintainers=owners, repository_url=crate.get("repository") or crate.get("homepage"),
        description=truncate(crate.get("description"), 300), deprecated=yanked_all,
    )


class CratesRegistry(Registry):
    ecosystem = Ecosystem.RUST

    def __init__(self, client: ReadOnlyClient, base_url: str = "https://crates.io"):
        self.client = client
        self.base_url = base_url.rstrip("/")

    async def get_package(self, name: str) -> RegistryRecord | None:
        name = normalize_crate(name)
        if not valid_lookup_name(name):
            return None                         # cannot be a crate name: never placed in a URL
        doc = await self.client.fetch_json(f"{self.base_url}/api/v1/crates/{quote(name, safe='')}")
        if doc is None:
            return None
        if not isinstance(doc, dict):
            raise RegistryError("Unexpected crates.io response.")
        owners: list[str] = []
        try:
            o = await self.client.fetch_json(f"{self.base_url}/api/v1/crates/{quote(name, safe='')}/owners")
            if isinstance(o, dict):
                owners = [u.get("login") for u in o.get("users", []) if isinstance(u, dict) and u.get("login")]
        except RegistryError:
            pass
        try:
            return record_from_crates(name, doc, owners)
        except Exception:   # malformed registry data (incl. pydantic.ValidationError, OverflowError)
            raise RegistryError("Malformed crates.io response.") from None

    async def aclose(self) -> None:
        await self.client.aclose()

    @property
    def request_count(self) -> int:
        return self.client.request_count
