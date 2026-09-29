"""PyPI JSON API (pypi.org/pypi/<name>/json). GET-only. Download counts are not part of this API => None."""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote

from ..models import Ecosystem, InstallScripts
from ..parsers.normalize import normalize_pypi
from .base import ReadOnlyClient, Registry, RegistryError, RegistryRecord, truncate, valid_lookup_name


def _repo(info: dict[str, Any]) -> str | None:
    urls = info.get("project_urls") or {}
    for key in ("Source", "Source Code", "Repository", "Homepage", "GitHub"):
        if isinstance(urls, dict) and urls.get(key):
            return urls[key]
    return info.get("home_page") or None


def _people(doc: dict[str, Any], info: dict[str, Any]) -> list[str]:
    """Owners/maintainers. The live API leaves ``author``/``maintainer`` empty for most projects and puts the people in
    ``author_email`` / ``maintainer_email`` (``Name <mail>, Name <mail>``); account names are in ``ownership.roles``."""
    people: list[str] = []

    def add(v: Any) -> None:
        if isinstance(v, str) and v.strip() and v.strip().lower() not in {x.lower() for x in people}:
            people.append(v.strip())

    own = doc.get("ownership")
    if isinstance(own, dict):
        for role in own.get("roles") or []:
            if isinstance(role, dict):
                add(role.get("user"))
        org = own.get("organization")
        add(org if isinstance(org, str) else (org.get("name") if isinstance(org, dict) else None))
    for key in ("author", "maintainer"):
        add(info.get(key))
        mail = info.get(key + "_email")
        if isinstance(mail, str):
            for part in re.split(r",(?![^<]*>)", mail):
                m = re.match(r"^\s*\"?([^<\"]*?)\"?\s*<[^>]*>\s*$", part)
                add(m.group(1) if m and m.group(1).strip() else part.split("@")[0] if "@" in part else part)
    return people[:20]


def record_from_pypi(name: str, doc: dict[str, Any]) -> RegistryRecord:
    info = doc.get("info") or {}
    releases: dict[str, list[dict[str, Any]]] = doc.get("releases") or {}
    first: str | None = None
    latest_time: str | None = None
    latest = info.get("version")
    for ver, files in releases.items():
        for f in files or []:
            t = f.get("upload_time_iso_8601") or f.get("upload_time")
            if t and (first is None or t < first):
                first = t
            if ver == latest and t and (latest_time is None or t > latest_time):
                latest_time = t
    latest_files = releases.get(latest or "") or doc.get("urls") or []
    types = {f.get("packagetype") for f in latest_files}
    sdist_only = "sdist" in types and "bdist_wheel" not in types
    people = _people(doc, info)
    classifiers = info.get("classifiers") or []
    deprecated = any("Inactive" in c for c in classifiers if isinstance(c, str)) or (
        bool(latest_files) and all(f.get("yanked") for f in latest_files))
    return RegistryRecord(
        ecosystem=Ecosystem.PYPI, name=name, exists=True, registered_at=first, latest_version=latest,
        latest_published_at=latest_time, versions=sorted(releases, key=lambda v: v), weekly_downloads=None,
        maintainers=people, install_scripts=InstallScripts(build_script=sdist_only), network_indicators=[],
        repository_url=_repo(info), description=truncate(info.get("summary"), 300), deprecated=deprecated,
    )


class PyPIRegistry(Registry):
    ecosystem = Ecosystem.PYPI

    def __init__(self, client: ReadOnlyClient, base_url: str = "https://pypi.org"):
        self.client = client
        self.base_url = base_url.rstrip("/")

    async def get_package(self, name: str) -> RegistryRecord | None:
        norm = normalize_pypi(name)
        if not valid_lookup_name(norm):
            return None                         # cannot be a PyPI project name: never placed in a URL
        doc = await self.client.fetch_json(f"{self.base_url}/pypi/{quote(norm, safe='')}/json")
        if doc is None:
            return None
        if not isinstance(doc, dict):
            raise RegistryError("Unexpected PyPI response.")
        try:
            return record_from_pypi(norm, doc)
        except Exception:   # malformed registry data (incl. pydantic.ValidationError, OverflowError)
            raise RegistryError("Malformed PyPI response.") from None

    async def aclose(self) -> None:
        await self.client.aclose()

    @property
    def request_count(self) -> int:
        return self.client.request_count
