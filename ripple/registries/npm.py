"""npm registry (registry.npmjs.org + api.npmjs.org downloads). GET-only."""
from __future__ import annotations

from typing import Any
from urllib.parse import quote

from ..models import Ecosystem, InstallScripts
from ..parsers.normalize import npm_name
from .base import (
    ReadOnlyClient, Registry, RegistryError, RegistryRecord, script_indicators, truncate, valid_lookup_name,
)

HOOKS = ("preinstall", "install", "postinstall", "prepare")
RECENT_RELEASES = 10          # window (in releases) for "a new account started publishing"


def _repo_url(repo: Any) -> str | None:
    if isinstance(repo, dict):
        repo = repo.get("url")
    return repo if isinstance(repo, str) else None


def record_from_npm(name: str, doc: dict[str, Any], downloads: int | None) -> RegistryRecord:
    times: dict[str, str] = doc.get("time") or {}
    versions: dict[str, Any] = doc.get("versions") or {}
    latest = (doc.get("dist-tags") or {}).get("latest")
    ordered = sorted((v for v in versions if v in times), key=lambda v: times[v])
    if not latest and ordered:
        latest = ordered[-1]
    vobj = versions.get(latest or "", {}) if latest else {}
    if not isinstance(vobj, dict):
        vobj = {}
    scripts = vobj.get("scripts")
    scripts = {k: v for k, v in scripts.items() if isinstance(k, str) and isinstance(v, str)} \
        if isinstance(scripts, dict) else {}
    hooks = {k: truncate(scripts.get(k)) for k in HOOKS}
    # Publishing-account changes (proxy for a maintainer/ownership change): accounts that publish for the *first time*
    # within the most recent releases. Counting every switch between accounts (A,B,A,B...) would flag any healthy
    # multi-maintainer project - express alternates between its maintainers 15 times.
    users = [((versions[v].get("_npmUser") or {}).get("name")) if isinstance(versions[v], dict) else None for v in ordered]
    seen: set[str] = set()
    first_at: list[int] = []
    for i, user in enumerate(users):
        if isinstance(user, str) and user and user not in seen:
            seen.add(user)
            first_at.append(i)
    recent_from = max(1, len(users) - RECENT_RELEASES)
    changes = sum(1 for i in first_at[1:] if i >= recent_from)
    maintainers = [m.get("name") for m in (doc.get("maintainers") or []) if isinstance(m, dict) and m.get("name")]
    return RegistryRecord(
        ecosystem=Ecosystem.NPM, name=name, exists=True,
        registered_at=times.get("created") or (times.get(ordered[0]) if ordered else None),
        latest_version=latest, latest_published_at=times.get(latest or ""),
        versions=list(ordered) or list(versions),
        weekly_downloads=downloads, maintainers=maintainers, maintainer_changes=changes,
        install_scripts=InstallScripts(**hooks),
        network_indicators=script_indicators({k: v for k, v in scripts.items() if k in HOOKS}),
        repository_url=_repo_url(doc.get("repository")), description=truncate(doc.get("description"), 300),
        deprecated=bool(vobj.get("deprecated")),
    )


class NpmRegistry(Registry):
    ecosystem = Ecosystem.NPM

    def __init__(self, client: ReadOnlyClient, base_url: str = "https://registry.npmjs.org",
                 downloads_url: str = "https://api.npmjs.org"):
        self.client = client
        self.base_url = base_url.rstrip("/")
        self.downloads_url = downloads_url.rstrip("/")

    @staticmethod
    def _path(name: str) -> str:
        return quote(name, safe="@").replace("/", "%2F")

    async def get_package(self, name: str) -> RegistryRecord | None:
        name = npm_name(name)
        if not valid_lookup_name(name, max_slashes=1) or ("/" in name and not name.startswith("@")):
            return None                         # cannot be an npm package name: never placed in a URL
        doc = await self.client.fetch_json(f"{self.base_url}/{self._path(name)}")
        if doc is None:
            return None
        if not isinstance(doc, dict):
            raise RegistryError("Unexpected npm registry response.")
        downloads: int | None = None
        try:
            d = await self.client.fetch_json(f"{self.downloads_url}/downloads/point/last-week/{quote(name, safe='@/')}")
            if isinstance(d, dict) and isinstance(d.get("downloads"), int):
                downloads = d["downloads"]
        except RegistryError:
            downloads = None
        try:
            return record_from_npm(name, doc, downloads)
        except Exception:   # malformed registry data (incl. pydantic.ValidationError, OverflowError)
            raise RegistryError("Malformed npm registry response.") from None

    async def aclose(self) -> None:
        await self.client.aclose()

    @property
    def request_count(self) -> int:
        return self.client.request_count
