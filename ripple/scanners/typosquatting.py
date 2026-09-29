"""Typosquatting analysis in two directions.

(a) *Look-alikes of the project's popular dependencies*: mutate each popular/high-usage dependency name and
    check (read-only, cached, capped) which variants are registered on the public registry.
(b) *The dependency itself resembles a popular package* but is not it.
"""
from __future__ import annotations

import asyncio
from typing import Callable

from ..models import (
    Category, Ecosystem, LookalikeCandidate, LookalikeGroup, Package, PublicStatus, Resolution, Severity,
    severity_for_score,
)
from ..parsers.normalize import comparison_key, split_npm_scope
from ..registries import RegistrySet
from ..registries.base import RegistryError, RegistryRecord
from .base import (
    ECOSYSTEM_LABEL, REGISTRY_LABEL, Detection, ScanContext, compact, days_since, drv, ev, human_downloads,
    record_key,
)
from .mutations import DEFAULT_LIMIT, generate_variants
from .popular import (
    PUBLIC_NPM_SCOPES, is_allowlisted, is_popular, popular_keys, popularity_rank,
)
from .similarity import affix_stripped, damerau_levenshtein, dehomoglyph, similarity, whole_token_swap

RULE_ID = "RIPPLE-TS-001"
LOOKALIKE_MAX_TARGETS = 8          # popular dependencies examined per ecosystem
LOOKALIKE_VARIANTS = DEFAULT_LIMIT
ESTABLISHED_DOWNLOADS = 100_000    # a dependency this widely used is not treated as a squat of another name
_HOOKS = ("preinstall", "install", "postinstall", "prepare")


# ------------------------------------------------------------------------------------------------------------
# (b) the dependency resembles a popular package
# ------------------------------------------------------------------------------------------------------------

def find_squat_target(eco: Ecosystem, name: str, max_distance: int = 2,
                      strict: bool = False) -> tuple[str, int, str] | None:
    """Return ``(popular_name, distance, kind)`` if ``name`` looks like a squat of a popular package.

    ``strict`` (no registry evidence for the name) ignores affixes that legitimate sub-packages use everywhere.
    """
    if eco is Ecosystem.NPM:
        scope, _ = split_npm_scope(name.lower())
        if scope in PUBLIC_NPM_SCOPES:
            return None
    key = comparison_key(eco, name)
    pops = popular_keys(eco)
    if key in pops or len(key) < 4:
        return None
    cands: list[tuple[int, int, str, str]] = []     # (priority, distance, popular, kind)
    edit: tuple[int, str] | None = None
    kset = set(key)
    for pk, canon in pops.items():
        if abs(len(pk) - len(key)) > max_distance or len(kset ^ set(pk)) > 2 * max_distance:
            continue
        d = damerau_levenshtein(key, pk)
        if d == 0 or d > max_distance:
            continue
        m = min(len(key), len(pk))
        if (d == 1 and m < 5) or (d == 2 and m < 8) or is_allowlisted(key, pk) or whole_token_swap(key, pk):
            continue
        if edit is None or d < edit[0]:
            edit = (d, canon)
    if edit:
        cands.append((1 if edit[0] == 1 else 3, edit[0], edit[1], "edit_distance"))
    dh = dehomoglyph(key)
    if dh != key and dh in pops and not is_allowlisted(key, dh):
        cands.append((0, 1, pops[dh], "homoglyph"))
    for stripped in affix_stripped(key, eco, strict):
        if stripped in pops and not is_allowlisted(key, stripped):
            cands.append((2, 1, pops[stripped], "affix"))
    if not cands:
        return None
    _, dist, canon, kind = min(cands, key=lambda c: c[:2])
    return canon, dist, kind


def detect_typosquats(ctx: ScanContext) -> list[Detection]:
    out: list[Detection] = []
    max_d = max(1, ctx.options.max_edit_distance)
    for pkg in ctx.packages:
        if pkg.resolution in (Resolution.LOCAL, Resolution.VCS):
            continue
        rec = ctx.record(pkg)
        if rec and rec.weekly_downloads is not None and rec.weekly_downloads >= ESTABLISHED_DOWNLOADS:
            continue
        hit = find_squat_target(pkg.ecosystem, pkg.name, max_d, strict=rec is None)
        if hit is None:
            continue
        popular, dist, kind = hit
        if rec is None and not pkg.direct and kind != "homoglyph":
            # Squats work through a mistyped *direct* install. A transitive package with no registry evidence that merely
            # sits one edit from a popular name (safer-buffer, leven, commondir...) is far more often a real neighbour.
            continue
        d = _squat_detection(pkg, rec, popular, dist, kind, ctx)
        if d is not None:
            out.append(d)
    return out


def _squat_detection(pkg: Package, rec: RegistryRecord | None, popular: str, dist: int, kind: str,
                     ctx: ScanContext) -> Detection | None:
    eco = pkg.ecosystem
    sim = similarity(comparison_key(eco, pkg.name), comparison_key(eco, popular))
    drivers = []
    adj: list[tuple[str, float]] = []
    tags = {"lookalike_of_popular"}
    if kind == "homoglyph":
        drivers.append(drv("Homoglyph of popular package", 35, f"`{pkg.name}` reads as `{popular}` when look-alike characters are normalised"))
        adj.append(("homoglyph substitution is rarely accidental", 0.2))
    elif kind == "affix":
        drivers.append(drv("Popular name with added affix", 30, f"`{pkg.name}` is `{popular}` plus a common prefix/suffix"))
        adj.append(("well-known squatting affix", 0.1))
    elif dist == 1:
        drivers.append(drv("One edit from popular package", 35, f"Damerau-Levenshtein distance 1 from `{popular}`"))
        adj.append(("single-character difference", 0.15))
    else:
        drivers.append(drv("Near-identical to popular package", 25, f"Damerau-Levenshtein distance {dist} from `{popular}`"))
    if sim >= 0.88:
        drivers.append(drv("High similarity", 10, f"Normalized similarity {sim:.2f}"))
    elif sim >= 0.8:
        drivers.append(drv("High similarity", 5, f"Normalized similarity {sim:.2f}"))

    if rec is not None:
        age = days_since(rec.registered_at, ctx.now)
        if age is not None and age < 90:
            drivers.append(drv("Recent registration", 15, f"Registered {age} days ago"))
            tags.add("recent")
        elif age is not None and age < 365:
            drivers.append(drv("Recent registration", 8, f"Registered {age} days ago"))
        if rec.weekly_downloads is not None and rec.weekly_downloads < 1000:
            drivers.append(drv("Low downloads", 10, f"{human_downloads(rec.weekly_downloads)} vs a widely-used look-alike target"))
        if rec.install_scripts.any():
            drivers.append(drv("Install script", 12, "Runs code at install time"))
            tags.add("install_script")
        if rec.network_indicators:
            drivers.append(drv("Network behaviour in script", 10, compact(rec.network_indicators, 2)))
            tags.add("network")
        adj.append(("registry metadata available", 0.1))
    else:
        adj.append(("no registry data (name analysis only)", -0.1))
    if pkg.dependents_count >= 3:
        drivers.append(drv("High downstream usage", 10, f"{pkg.dependents_count} packages depend on it"))

    evidence = [
        ev("Package", pkg.name), ev("Resembles", popular),
        ev("Edit distance", dist, mono=False), ev("Similarity", f"{sim:.2f}", mono=False),
        ev("Detection", {"homoglyph": "homoglyph normalisation", "affix": "known prefix/suffix",
                         "edit_distance": "Damerau-Levenshtein"}[kind], mono=False),
    ]
    if rec:
        evidence += [ev("Registered", rec.registered_at or "unknown"),
                     ev("Weekly downloads", human_downloads(rec.weekly_downloads), mono=False)]
        if rec.maintainers:
            evidence.append(ev("Maintainers", compact(rec.maintainers, 4)))
        if rec.install_scripts.any():
            evidence.append(ev("Install hooks", compact([h for h in _HOOKS if getattr(rec.install_scripts, h)] +
                                                       (["build script"] if rec.install_scripts.build_script else []), 4)))
        if rec.network_indicators:
            evidence.append(ev("Script indicators", compact(rec.network_indicators, 3)))
    evidence.append(ev("Lockfile", pkg.source_file))
    label = REGISTRY_LABEL[eco]
    return Detection(
        package_id=pkg.id, category=Category.TYPOSQUATTING, rule_id=RULE_ID,
        title=f"Possible Typosquat of `{popular}`",
        drivers=drivers,
        summary=f"`{pkg.name}` is {'one edit' if dist == 1 else f'{dist} edits'} from the popular {ECOSYSTEM_LABEL[eco]} package `{popular}`.",
        why_flagged=(f"The name is within edit distance {dist} of `{popular}` (similarity {sim:.2f}) but is not that package"
                     f"{' - ' + kind.replace('_', ' ') + ' pattern' if kind != 'edit_distance' else ''}. "
                     f"Legitimate near-names are allow-listed; this pair is not."),
        attack_vector=(f"Typosquatting relies on a mistyped install command, a copy-pasted name or an autocomplete slip. A package "
                       f"named like a popular library can ship altered code or install-time scripts; once it is in the lockfile, "
                       f"every build pulls it from {label} with the same privileges as the genuine dependency."),
        evidence=evidence, tags=tags, confidence_base=0.5, confidence_adjustments=adj, related_package=popular,
    )


# ------------------------------------------------------------------------------------------------------------
# (a) registered look-alikes of the project's popular dependencies
# ------------------------------------------------------------------------------------------------------------

_MUTATION_POINTS = {"homoglyph": 10, "transposition": 8, "insertion": 8, "deletion": 8,
                    "substitution": 6, "separator": 6, "prefix_suffix": 6}


def _hooks(rec: RegistryRecord) -> list[str]:
    hs = [h for h in _HOOKS if getattr(rec.install_scripts, h)]
    if rec.install_scripts.build_script:
        hs.append("build_script")
    return hs


def score_candidate(mutation: str, sim: float, rec: RegistryRecord | None, orig: RegistryRecord | None,
                    now, in_project: bool = False) -> tuple[int, list[str]]:
    """Return ``(suspicion_score, driver strings like 'Recent registration +20')``."""
    if rec is None:
        return 0, ["Not registered - claimable by anyone"]
    parts: list[tuple[str, int]] = [("Registered on public registry", 15)]
    if sim >= 0.88:
        parts.append(("High similarity", 10))
    elif sim >= 0.8:
        parts.append(("High similarity", 5))
    parts.append((f"{mutation.replace('_', '/').capitalize()} mutation", _MUTATION_POINTS.get(mutation, 6)))
    age = days_since(rec.registered_at, now)
    if age is not None and age < 90:
        parts.append(("Recent registration", 20))
    elif age is not None and age < 365:
        parts.append(("Recent registration", 10))
    if rec.weekly_downloads is not None:
        ref = orig.weekly_downloads if orig and orig.weekly_downloads else None
        if rec.weekly_downloads < 1000 or (ref and rec.weekly_downloads < ref * 0.001):
            parts.append(("Very low downloads", 10))
    if rec.install_scripts.any():
        parts.append(("Install script", 15))
    if rec.network_indicators:
        parts.append(("Network behaviour in script", 12))
    if orig and orig.maintainers and rec.maintainers and not set(rec.maintainers) & set(orig.maintainers):
        parts.append(("Unrelated maintainers", 8))
    if in_project:
        parts.append(("Declared in this project's lockfile", 15))
    if rec.deprecated:
        parts.append(("Deprecated / yanked", -5))
    score = max(0, min(100, sum(p for _, p in parts)))
    return score, [f"{lbl} {'+' if p >= 0 else ''}{p}" for lbl, p in parts]


def pick_lookalike_targets(ctx: ScanContext, per_ecosystem: int = LOOKALIKE_MAX_TARGETS) -> list[Package]:
    seen: set[str] = set()
    pool: list[tuple[tuple, Package]] = []
    for p in ctx.packages:
        if p.ecosystem is Ecosystem.GO or p.resolution in (Resolution.LOCAL, Resolution.VCS):
            continue
        rec = ctx.record(p)
        popular = is_popular(p.ecosystem, p.name)
        heavy = bool(p.direct and rec and rec.weekly_downloads and rec.weekly_downloads >= ESTABLISHED_DOWNLOADS)
        if not (popular or heavy):
            continue
        if p.public_status in (PublicStatus.NOT_FOUND, PublicStatus.ERROR) or p.ecosystem in ctx.unavailable_ecosystems:
            continue
        k = record_key(p)
        if k in seen:
            continue
        seen.add(k)
        rank = popularity_rank(p.ecosystem, p.name)
        pool.append(((p.ecosystem.value, not p.direct, rank if rank is not None else 9999, p.name), p))
    pool.sort(key=lambda t: t[0])
    counts: dict[Ecosystem, int] = {}
    out: list[Package] = []
    for _, p in pool:
        if counts.get(p.ecosystem, 0) >= per_ecosystem:
            continue
        counts[p.ecosystem] = counts.get(p.ecosystem, 0) + 1
        out.append(p)
    return out


async def build_lookalikes(
    ctx: ScanContext, registries: RegistrySet, *, max_targets: int = LOOKALIKE_MAX_TARGETS,
    variants: int = LOOKALIKE_VARIANTS, unregistered_shown: int = 3, concurrency: int = 16,
    on_progress: Callable[[int, int], None] | None = None,
) -> tuple[list[LookalikeGroup], list[str]]:
    targets = pick_lookalike_targets(ctx, max_targets)
    sem = asyncio.Semaphore(concurrency)
    project_keys = {record_key(p) for p in ctx.packages}
    total = sum(len(generate_variants(t.name, t.ecosystem, variants)) for t in targets)
    done = 0
    failures: dict[Ecosystem, int] = {}
    groups: list[LookalikeGroup] = []

    async def lookup(reg, eco: Ecosystem, name: str) -> tuple[bool, RegistryRecord | None]:
        nonlocal done
        try:
            async with sem:
                return True, await reg.get_package(name)
        except RegistryError:
            failures[eco] = failures.get(eco, 0) + 1
            return False, None
        finally:
            done += 1
            if on_progress:
                on_progress(done, total)

    dead: set[Ecosystem] = set(ctx.unavailable_ecosystems)
    for t in targets:
        eco = t.ecosystem
        if eco in dead:
            continue
        reg = registries.get(eco)
        vs = generate_variants(t.name, eco, variants)
        results = await asyncio.gather(*(lookup(reg, eco, v.name) for v in vs))
        if results and not any(ok for ok, _ in results):
            dead.add(eco)                       # every probe failed: stop hammering this registry
            continue
        orig = ctx.record(t)
        cands: list[LookalikeCandidate] = []
        unreg: list[LookalikeCandidate] = []
        seen_records: set[str] = set()
        for v, (ok, rec) in zip(vs, results):
            if not ok:
                continue
            sim = similarity(comparison_key(eco, v.name), comparison_key(eco, t.name))
            dist = damerau_levenshtein(comparison_key(eco, v.name), comparison_key(eco, t.name))
            if rec is None:
                sc, drivers = score_candidate(v.mutation, sim, None, orig, ctx.now)
                unreg.append(LookalikeCandidate(name=v.name, mutation=v.mutation, similarity=sim, distance=dist,
                                                registered=False, suspicion_score=0, severity=Severity.INFO, drivers=drivers))
                continue
            if rec.name in seen_records:
                continue
            seen_records.add(rec.name)
            in_project = f"{eco.value}:{comparison_key(eco, v.name)}" in project_keys
            sc, drivers = score_candidate(v.mutation, sim, rec, orig, ctx.now, in_project)
            cands.append(LookalikeCandidate(
                name=v.name, mutation=v.mutation, similarity=sim, distance=dist, registered=True,
                registered_at=rec.registered_at, weekly_downloads=rec.weekly_downloads, maintainers=list(rec.maintainers),
                install_scripts=_hooks(rec), suspicion_score=sc, severity=severity_for_score(sc), drivers=drivers))
        if not cands:
            continue
        cands.sort(key=lambda c: (-c.suspicion_score, -c.similarity, c.name))
        groups.append(LookalikeGroup(
            original=t.name, original_package_id=t.id, ecosystem=eco,
            original_weekly_downloads=orig.weekly_downloads if orig else None,
            candidates=cands + unreg[:unregistered_shown]))
    warnings = [f"{ECOSYSTEM_LABEL[e]}: {n} look-alike lookup(s) failed and were skipped." for e, n in failures.items()]
    return groups, warnings


def lookalike_detections(groups: list[LookalikeGroup], ctx: ScanContext, min_top_score: int = 35) -> list[Detection]:
    by_id = ctx.by_id()
    out: list[Detection] = []
    for g in groups:
        pkg = by_id.get(g.original_package_id)
        registered = [c for c in g.candidates if c.registered]
        if pkg is None or not registered:
            continue
        top = registered[0]
        if top.suspicion_score < min_top_score:
            continue
        n = len(registered)
        risky = [c for c in registered if c.suspicion_score >= 35]
        drivers = [
            drv("Registered look-alikes", min(25, 8 + 3 * n), f"{n} look-alike name(s) of `{g.original}` are registered publicly"),
            drv("Highest-risk look-alike", min(30, round(top.suspicion_score * 0.3)),
                f"`{top.name}` scores {top.suspicion_score} ({top.severity.value})"),
        ]
        if len(risky) >= 3:
            drivers.append(drv("Multiple suspicious look-alikes", 6, f"{len(risky)} candidates score 35 or higher"))
        if pkg.direct:
            drivers.append(drv("Directly depended-upon package", 5, "Typos of direct dependencies are the likeliest install mistakes"))
        if any(c.install_scripts for c in registered):
            drivers.append(drv("Look-alike with install script", 6, "At least one look-alike executes code at install time"))
        evidence = [ev("Original", g.original), ev("Registered look-alikes", n, mono=False)]
        for c in registered[:6]:
            evidence.append(ev(c.name, f"{c.mutation}, score {c.suspicion_score}, {human_downloads(c.weekly_downloads)}"))
        evidence.append(ev("Lockfile", pkg.source_file))
        out.append(Detection(
            package_id=pkg.id, category=Category.TYPOSQUATTING, rule_id=RULE_ID,
            title=f"Registered Look-alikes of `{g.original}`",
            drivers=drivers,
            summary=f"{n} registered look-alike names of `{g.original}`; the riskiest is `{top.name}` (score {top.suspicion_score}).",
            why_flagged=(f"RIPPLE generated typo, homoglyph, separator and prefix/suffix variants of `{g.original}` and asked "
                         f"{REGISTRY_LABEL[g.ecosystem]} which exist. {n} do; the highest-scoring shows "
                         f"{'; '.join(d.rsplit(' ', 1)[0] for d in top.drivers[:4])}."),
            attack_vector=("Look-alike packages wait for a mistyped install command or a copy-pasted name. They do not affect the "
                           "genuine dependency already in the lockfile, but a future edit to a manifest or a new dependency added "
                           "by hand could pull one in, and any install-time script would run with the developer's or CI's privileges."),
            evidence=evidence, tags={"lookalike_group"}, confidence_base=0.6,
            confidence_adjustments=[("registry confirmed the look-alikes exist", 0.15)] if n >= 2 else [],
            related_package=top.name,
        ))
    return out
