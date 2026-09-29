"""Scan orchestrator: parse -> discover -> registry -> typosquat -> metadata -> score -> graph."""
from __future__ import annotations

import asyncio
import itertools
import os
import time
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from . import __version__
from .models import (
    ALL_CHECKS, AttackSurface, Category, CheckKind, Ecosystem, Edge, EcosystemSummary, Package, PackageMetadata,
    PublicStatus, Resolution, ScanOptions, ScanResult, ScanSource, ScanSummary, Severity, severity_for_score,
)
from .parsers import detect_file, parse_file
from .parsers.base import MAX_PACKAGES, LockfileParseError, ParsedLockfile, UnsupportedLockfile, too_many_packages
from .security import clean_label
from .parsers.golang import merge_go_sum
from .registries import RegistrySet
from .registries.base import RegistryError, RegistryRecord, RegistryUnavailable
from .scanners.base import Detection, ScanContext, days_since, record_key
from .scanners.confusion import assess_internal, detect_confusion
from .scanners.exposure import detect_exposure
from .scanners.metadata import detect_metadata, version_gap
from .scanners.typosquatting import build_lookalikes, detect_typosquats, lookalike_detections
from .scoring import build_findings, overall_score, rollup_packages, score_drivers, severity_counts

ProgressCallback = Callable[[str, str, str, Optional[float]], None]
REGISTRY_CONCURRENCY = 16
CIRCUIT_THRESHOLD = 5      # consecutive lookup failures (with no success) before a registry is skipped
_ECO_ORDER = {Ecosystem.NPM: 0, Ecosystem.PYPI: 1, Ecosystem.GO: 2, Ecosystem.RUST: 3}
_ECO_LABEL = {Ecosystem.NPM: "npm", Ecosystem.PYPI: "PyPI", Ecosystem.GO: "Go proxy", Ecosystem.RUST: "crates.io"}
_CAT_FIELD = {
    Category.DEPENDENCY_CONFUSION: "dependency_confusion", Category.TYPOSQUATTING: "typosquatting",
    Category.SUSPICIOUS_METADATA: "suspicious_metadata", Category.REGISTRY_EXPOSURE: "registry_exposure",
}


@dataclass
class ScanInput:
    filename: str
    content: bytes | str


def detect(filename: str, content: bytes | str, ecosystem: Ecosystem | str | None = None) -> dict[str, Any]:
    """`{filename, ecosystem, supported, kind, dependency_count, error}` for one uploaded file."""
    return detect_file(filename, content, ecosystem)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class _Progress:
    def __init__(self, cb: ProgressCallback | None):
        self.cb = cb

    def __call__(self, stage: str, state: str, detail: str = "", fraction: float | None = None) -> None:
        if self.cb is None:
            return
        try:
            self.cb(stage, state, detail, fraction)
        except Exception:  # noqa: BLE001 - a UI callback must never break a scan
            pass


def metadata_from_record(rec: RegistryRecord, pkg: Package, now: datetime) -> PackageMetadata:
    return PackageMetadata(
        registered_at=rec.registered_at, latest_version=rec.latest_version, latest_published_at=rec.latest_published_at,
        versions_count=len(rec.versions) or None, weekly_downloads=rec.weekly_downloads, maintainers=list(rec.maintainers),
        maintainer_changes=rec.maintainer_changes, install_scripts=rec.install_scripts.model_copy(),
        network_indicators=list(rec.network_indicators), repository_url=rec.repository_url, description=rec.description,
        deprecated=rec.deprecated, version_gap=version_gap(pkg.version, rec.latest_version) if pkg.version else None,
        age_days=days_since(rec.registered_at, now),
    )


def _merge_lockfiles(parsed: list[ParsedLockfile]) -> tuple[list[Package], dict[str, ParsedLockfile]]:
    seen: dict[str, Package] = {}
    lockmap: dict[str, ParsedLockfile] = {}
    for lf in parsed:
        lockmap[lf.filename] = lf
        for p in lf.packages:
            cur = seen.get(p.id)
            if cur is None:
                seen[p.id] = p
            else:
                cur.direct = cur.direct or p.direct
                cur.dev = cur.dev and p.dev
                seen_deps = set(cur.dependencies)          # set lookup: hostile files can list 100k+ dependencies
                for d in p.dependencies:
                    if d not in seen_deps:
                        seen_deps.add(d)
                        cur.dependencies.append(d)
    if len(seen) > MAX_PACKAGES:
        raise too_many_packages()
    pkgs = sorted(seen.values(), key=lambda p: (_ECO_ORDER[p.ecosystem], p.name, p.version, p.source_file))
    return pkgs, lockmap


def _apply_go_sums(parsed: list[ParsedLockfile]) -> list[ParsedLockfile]:
    mods = [p for p in parsed if p.kind == "go.mod"]
    sums = [p for p in parsed if p.kind == "go.sum"]
    if not sums:
        return parsed
    if not mods:
        return parsed                                   # go.sum stands alone as a (hash-only) inventory
    for s in sums:
        sdir = os.path.dirname(s.filename.replace("\\", "/"))
        target = next((m for m in mods if os.path.dirname(m.filename.replace("\\", "/")) == sdir), mods[0])
        merge_go_sum(target, s)
    return [p for p in parsed if p.kind != "go.sum"]


async def run_scan(
    inputs: list[ScanInput], options: ScanOptions, *, project: str | None = None,
    registries: RegistrySet | None = None, progress: ProgressCallback | None = None,
    source: ScanSource | None = None, now: datetime | None = None, scan_id: str | None = None,
    cache_dir: Path | str | None = None,
) -> ScanResult:
    t0 = time.perf_counter()
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    emit = _Progress(progress)
    checks = {c for c in options.checks if c in ALL_CHECKS}
    warnings: list[str] = []

    # ---------------------------------------------------------------- parse
    emit("parse", "active", f"Parsing {len(inputs)} file(s)", 0.0)
    if not inputs:
        emit("parse", "error", "No files supplied", None)
        raise UnsupportedLockfile("No files were supplied to scan.")
    parsed: list[ParsedLockfile] = []
    failures: list[LockfileParseError] = []
    for i, inp in enumerate(inputs):
        try:
            parsed.append(parse_file(inp.filename, inp.content, options.ecosystem))
        except LockfileParseError as e:
            failures.append(e)
            warnings.append(f"Skipped {inp.filename}: {e.message}")
        emit("parse", "active", f"Parsed {i + 1}/{len(inputs)} file(s)", (i + 1) / len(inputs))
    if not parsed:
        emit("parse", "error", failures[0].message, None)
        raise failures[0]
    for lf in parsed:
        warnings += [f"{lf.filename}: {w}" for w in lf.warnings]
        if not lf.packages:
            warnings.append(f"{lf.filename}: no dependencies were found in this file.")
    parsed = _apply_go_sums(parsed)
    emit("parse", "done", f"{len(parsed)} lockfile(s) parsed", 1.0)

    # ---------------------------------------------------------------- discover
    emit("discover", "active", "Resolving dependency graph", 0.0)
    packages, lockmap = _merge_lockfiles(parsed)
    by_id = {p.id: p for p in packages}
    for p in packages:
        p.dependencies = [d for d in p.dependencies if d in by_id]
    for p in packages:
        for d in set(p.dependencies):
            by_id[d].dependents_count += 1
    for p in packages:
        src = p.registry_source if p.resolution not in (Resolution.VCS, Resolution.LOCAL) else None
        a = assess_internal(p.ecosystem, p.name, options.internal_scopes, src)
        # local/VCS packages are not resolved by registry name, so name heuristics do not apply
        internal = a.internal_looking and p.resolution not in (Resolution.VCS, Resolution.LOCAL)
        p.internal_looking = internal
        p.internal_reasons = a.reasons if internal else []
    emit("discover", "done", f"{len(packages)} dependencies discovered", 1.0)

    ctx = ScanContext(options=options, now=now, packages=packages, lockfiles=lockmap)

    # ---------------------------------------------------------------- registry
    need_registry = bool(checks & {CheckKind.CONFUSION.value, CheckKind.METADATA.value, CheckKind.TYPOSQUAT.value})
    use_live = registries is not None or options.live
    own_registries = False
    try:
        if need_registry and use_live and packages:
            if registries is None:
                registries = RegistrySet.live(options, cache_dir=cache_dir)
                own_registries = True
            await _registry_stage(ctx, registries, emit, warnings)
        else:
            if need_registry and packages:
                warnings.append("Offline mode: public registries were not queried. Public status is 'unknown' and "
                                "findings rely on name, pinning and lockfile heuristics only.")
                emit("registry", "skipped", "Offline mode - registry lookups skipped", None)
            else:
                emit("registry", "skipped", "Not required for the selected checks", None)

        detections: list[Detection] = []
        groups = []
        # ------------------------------------------------------------ typosquat
        if CheckKind.TYPOSQUAT.value in checks:
            emit("typosquat", "active", "Comparing names with popular packages", 0.0)
            detections += await asyncio.to_thread(detect_typosquats, ctx)
            if ctx.registry_checked and registries is not None:
                def on_prog(done: int, total: int) -> None:
                    emit("typosquat", "active", f"Checked {done}/{total} look-alike names", done / max(total, 1))
                groups, lw = await build_lookalikes(ctx, registries, on_progress=on_prog)
                warnings += lw
                detections += lookalike_detections(groups, ctx)
            else:
                warnings.append("Look-alike registration checks need registry access and were skipped.")
            emit("typosquat", "done", f"{sum(1 for d in detections if d.category is Category.TYPOSQUATTING)} typosquat signal(s)", 1.0)
        else:
            emit("typosquat", "skipped", "Check disabled", None)

        # ------------------------------------------------------------ metadata (+ confusion + exposure)
        if checks & {CheckKind.METADATA.value, CheckKind.CONFUSION.value, CheckKind.EXPOSURE.value}:
            emit("metadata", "active", "Profiling namespace, metadata and source risk", 0.0)
            if CheckKind.CONFUSION.value in checks:
                detections += detect_confusion(ctx)
            emit("metadata", "active", "Namespace analysis complete", 0.4)
            if CheckKind.METADATA.value in checks:
                covered = {d.package_id for d in detections
                           if d.category in (Category.DEPENDENCY_CONFUSION, Category.TYPOSQUATTING)
                           and "lookalike_group" not in d.tags}
                detections += detect_metadata(ctx, skip=covered)
            emit("metadata", "active", "Metadata analysis complete", 0.7)
            if CheckKind.EXPOSURE.value in checks:
                detections += detect_exposure(ctx)
            emit("metadata", "done", f"{len(detections)} risk signal(s) profiled", 1.0)
        else:
            emit("metadata", "skipped", "No metadata checks selected", None)
    finally:
        if own_registries and registries is not None:
            await registries.aclose()

    # ---------------------------------------------------------------- score
    emit("score", "active", "Scoring findings", 0.0)
    findings = build_findings(detections, packages, iso(now))
    registry_expected = ctx.registry_checked
    rollup_packages(packages, findings, registry_expected)
    for g in groups:
        p = by_id.get(g.original_package_id)
        if p and any(c.registered for c in g.candidates):
            p.typosquat = True
    scores = [f.risk_score for f in findings]
    overall = overall_score(scores)
    mode_note = None
    if not ctx.registry_checked and need_registry:
        mode_note = "Offline heuristics only: registry-derived signals (registration, downloads, scripts) are not part of the score."
    emit("score", "done", f"{len(findings)} finding(s), overall risk {overall}/100", 1.0)

    # ---------------------------------------------------------------- graph
    emit("graph", "active", "Building attack surface", 0.0)
    edges: list[Edge] = []
    for p in packages:
        for d in p.dependencies:
            edges.append(Edge(source=p.id, target=d, kind="dev" if by_id[d].dev else "depends"))
    ecosystems = _ecosystem_summaries(packages, findings)
    cat_counts = Counter(f.category for f in findings if f.severity is not Severity.INFO)
    surface = AttackSurface(**{_CAT_FIELD[c]: cat_counts.get(c, 0) for c in Category})
    summary = ScanSummary(
        total_dependencies=len(packages), direct_dependencies=sum(1 for p in packages if p.direct),
        public_packages=sum(1 for p in packages if p.public_status is PublicStatus.REGISTERED),
        internal_looking=sum(1 for p in packages if p.internal_looking),
        confusion_candidates=surface.dependency_confusion, typosquat_candidates=surface.typosquatting,
        suspicious_metadata=surface.suspicious_metadata, registry_exposure=surface.registry_exposure,
        ecosystems=len({p.ecosystem for p in packages}), total_findings=len(findings), risk_score=overall,
        risk_label=severity_for_score(overall).value, severity_counts=severity_counts(scores), attack_surface=surface,
        score_drivers=score_drivers(findings, overall, packages, mode_note),
    )
    src = source or ScanSource(kind="file", files=[i.filename for i in inputs])
    mode = "demo" if src.kind == "demo" else ("live" if ctx.registry_checked else "offline")
    emit("graph", "done", f"{len(edges)} dependency edge(s) mapped", 1.0)

    return ScanResult(
        id=scan_id or uuid.uuid4().hex[:12], project=(clean_label(project, 120) if project else None) or _guess_project(parsed, inputs), created_at=iso(now),
        duration_ms=int((time.perf_counter() - t0) * 1000), mode=mode, version=__version__, source=src,
        options=options, summary=summary, ecosystems=ecosystems, packages=packages, findings=findings, edges=edges,
        lookalikes=groups, warnings=list(dict.fromkeys(warnings)),
    )


def _guess_project(parsed: list[ParsedLockfile], inputs: list[ScanInput]) -> str:
    for lf in parsed:
        if lf.project_name and isinstance(lf.project_name, str):       # untrusted: may be any JSON type
            name = lf.project_name.rsplit("/", 1)[-1] if lf.ecosystem is Ecosystem.GO else lf.project_name
            return clean_label(name, 120, "untitled-project")
    first = inputs[0].filename.replace("\\", "/").rsplit("/", 1)
    return first[0].rsplit("/", 1)[-1] if len(first) > 1 and first[0] else "untitled-project"


async def _registry_stage(ctx: ScanContext, registries: RegistrySet, emit: _Progress, warnings: list[str]) -> None:
    ctx.registry_checked = True
    targets: dict[str, list[Package]] = {}
    for p in ctx.packages:
        if p.resolution in (Resolution.LOCAL, Resolution.VCS):
            continue
        targets.setdefault(record_key(p), []).append(p)
    per_eco: dict[Ecosystem, list[str]] = {}
    for k in sorted(targets, key=lambda k: (_ECO_ORDER[targets[k][0].ecosystem], k)):
        per_eco.setdefault(targets[k][0].ecosystem, []).append(k)
    # interleave ecosystems so every registry is probed concurrently (a dead one is detected in parallel, not in series)
    keys = [k for group in itertools.zip_longest(*per_eco.values()) for k in group if k is not None]
    total = len(keys)
    emit("registry", "active", f"Querying registries for {total} package(s)", 0.0)
    sem = asyncio.Semaphore(REGISTRY_CONCURRENCY)
    failed: dict[Ecosystem, int] = {}
    ok_count: dict[Ecosystem, int] = {}
    done = 0
    errors: set[str] = set()

    consecutive: dict[Ecosystem, int] = {}

    async def one(k: str) -> None:
        nonlocal done
        p = targets[k][0]
        eco = p.ecosystem
        try:
            if eco in ctx.unavailable_ecosystems:
                raise RegistryUnavailable("skipped: registry marked unavailable")
            async with sem:
                if eco in ctx.unavailable_ecosystems:       # breaker may have opened while we waited
                    raise RegistryUnavailable("skipped: registry marked unavailable")
                rec = await registries.get(eco).get_package(p.name)
            ctx.records[k] = rec
            ok_count[eco] = ok_count.get(eco, 0) + 1
            consecutive[eco] = 0
        except RegistryError as e:
            errors.add(k)
            failed[eco] = failed.get(eco, 0) + 1
            consecutive[eco] = consecutive.get(eco, 0) + 1
            if isinstance(e, RegistryUnavailable) or (consecutive[eco] >= CIRCUIT_THRESHOLD and not ok_count.get(eco)):
                ctx.unavailable_ecosystems.add(eco)
        finally:
            done += 1
            emit("registry", "active", f"{done}/{total} packages checked", done / max(total, 1))

    await asyncio.gather(*(one(k) for k in keys))
    for k in keys:
        for p in targets[k]:
            if k in errors:
                p.public_status = PublicStatus.ERROR
                continue
            rec = ctx.records.get(k)
            if rec is None:
                p.public_status = PublicStatus.NOT_FOUND
            else:
                p.public_status = PublicStatus.REGISTERED
                p.metadata = metadata_from_record(rec, p, ctx.now)
    for eco, n in sorted(failed.items(), key=lambda kv: _ECO_ORDER[kv[0]]):
        affected = sum(len(targets[k]) for k in errors if targets[k][0].ecosystem is eco)
        state = "unavailable" if not ok_count.get(eco) else "partially unavailable"
        warnings.append(f"{_ECO_LABEL[eco]} registry {state} — {affected} package{'s' if affected != 1 else ''} unverified. "
                        "Local lockfile analysis still ran.")
    emit("registry", "done" if not failed else "done",
         f"{total - len(errors)}/{total} packages verified" + (f", {len(errors)} unavailable" if errors else ""), 1.0)


def _ecosystem_summaries(packages: list[Package], findings: list) -> list[EcosystemSummary]:
    out: list[EcosystemSummary] = []
    for eco in sorted({p.ecosystem for p in packages}, key=lambda e: _ECO_ORDER[e]):
        ps = [p for p in packages if p.ecosystem is eco]
        fs = [f for f in findings if f.ecosystem is eco]
        by_cat = Counter(f.category for f in fs if f.severity is not Severity.INFO)
        known = sum(1 for p in ps if p.public_status in (PublicStatus.REGISTERED, PublicStatus.NOT_FOUND))
        out.append(EcosystemSummary(
            ecosystem=eco, lockfiles=sorted({p.source_file for p in ps}), registry=ps[0].registry, total=len(ps),
            direct=sum(1 for p in ps if p.direct), public=sum(1 for p in ps if p.public_status is PublicStatus.REGISTERED),
            internal_looking=sum(1 for p in ps if p.internal_looking),
            confusion=by_cat.get(Category.DEPENDENCY_CONFUSION, 0), typosquat=by_cat.get(Category.TYPOSQUATTING, 0),
            suspicious=by_cat.get(Category.SUSPICIOUS_METADATA, 0), exposure=by_cat.get(Category.REGISTRY_EXPOSURE, 0),
            registry_coverage=round(known / len(ps), 3) if ps else 0.0,
            risk_score=overall_score([f.risk_score for f in fs]), severity_counts=severity_counts([f.risk_score for f in fs]),
        ))
    return out
