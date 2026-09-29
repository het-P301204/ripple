"""Deterministic, network-free registry backed by in-memory records (demo + tests)."""
from __future__ import annotations

from typing import Iterable

from ..models import Ecosystem
from ..parsers.normalize import comparison_key
from .base import Registry, RegistryError, RegistryRecord


class FixtureRegistry(Registry):
    def __init__(self, ecosystem: Ecosystem | str, records: Iterable[RegistryRecord] = (), *,
                 fail: Iterable[str] = (), fail_all: bool = False):
        self.ecosystem = Ecosystem(ecosystem)
        self._records: dict[str, RegistryRecord] = {}
        self._exact: dict[str, RegistryRecord] = {}
        for r in records:
            self.add(r)
        self._fail = {comparison_key(self.ecosystem, n) for n in fail}
        self.fail_all = fail_all
        self.lookups: list[str] = []

    def add(self, record: RegistryRecord) -> None:
        """Index by the exact (lowercased) spelling and, if free, by the registry-normalised key."""
        self._exact[record.name.lower()] = record
        self._records.setdefault(comparison_key(self.ecosystem, record.name), record)

    async def get_package(self, name: str) -> RegistryRecord | None:
        key = comparison_key(self.ecosystem, name)
        self.lookups.append(name)
        if self.fail_all or key in self._fail:
            raise RegistryError(f"Simulated {self.ecosystem.value} registry outage.")
        return self._exact.get(name.lower()) or self._records.get(key)

    @property
    def request_count(self) -> int:
        return len(self.lookups)

    def __len__(self) -> int:
        return len(self._records)
