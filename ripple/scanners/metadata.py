"""Suspicious-metadata risk drivers from public-registry data (explainable, additive)."""
from __future__ import annotations

from ..models import Category, Ecosystem, Package, Resolution
from .base import (
    Detection, ScanContext, compact, days_since, drv, ev, human_downloads,
)
from ..registries.base import RegistryRecord

MIN_EMIT_SCORE = 15

RULES = {
    "maintainer": ("RIPPLE-MD-001", "Maintainer Change Detected"),
    "recent": ("RIPPLE-MD-002", "Recently Registered Package"),
    "install": ("RIPPLE-MD-003", "Install-Time Script"),
    "network": ("RIPPLE-MD-004", "Network Behaviour in Install Script"),
    "downloads": ("RIPPLE-MD-005", "Very Low Adoption"),
    "deprecated": ("RIPPLE-MD-006", "Deprecated or Outdated Package"),
}

VECTORS = {
    "maintainer": ("Package takeover is a common route for turning a trusted dependency malicious: when the set of people who can "
                   "publish changes, the next release may not come from the original authors. Reviewing what changed between the "
                   "pinned version and newer ones - and pinning with integrity hashes - limits the blast radius."),
    "recent": ("Newly registered packages have no track record. Typosquats and confusion packages are usually registered shortly before "
               "they are pulled in, so a very young package that a project already depends on deserves a provenance check."),
    "install": ("Lifecycle scripts run automatically at install time, before anyone reviews the installed code, and with the "
                "privileges of the developer or CI runner. They are legitimate for native builds but are also the usual payload "
                "delivery point for hostile packages."),
    "network": ("An install script that downloads or decodes content executes code that is not in the published tarball, so what is "
                "reviewed in the registry is not what runs. Fetch-and-execute patterns in lifecycle hooks are a strong hostile-package signal."),
    "downloads": ("A dependency almost nobody else uses has had little public scrutiny; a malicious or hijacked release would go "
                  "unnoticed by the wider community for longer."),
    "deprecated": ("Deprecated or far-behind packages receive no security fixes, and abandoned names can later be re-registered or "
                   "transferred to new owners."),
}


def _major(v: str | None) -> int | None:
    if not v:
        return None
    s = v.lstrip("vV=^~ ")
    head = s.split(".", 1)[0]
    return int(head) if head.isdigit() else None


def version_gap(resolved: str, latest: str | None) -> int | None:
    a, b = _major(resolved), _major(latest)
    if a is None or b is None or b < a:
        return None
    return b - a


def analyse(pkg: Package, rec: RegistryRecord, ctx: ScanContext) -> Detection | None:
    drivers = []
    keys: list[tuple[int, str]] = []          # (points, rule key) for picking the primary
    tags: set[str] = set()
    age = days_since(rec.registered_at, ctx.now)

    def add(key: str, label: str, pts: int, detail: str) -> None:
        drivers.append(drv(label, pts, detail))
        if pts > 0:
            keys.append((pts, key))

    if rec.maintainer_changes >= 2:
        add("maintainer", "Maintainer changes", 22, f"{rec.maintainer_changes} changes in the set of publishers")
    elif rec.maintainer_changes == 1:
        add("maintainer", "Maintainer change", 15, "The publishing account changed between releases")
    if rec.maintainer_changes:
        tags.add("maintainer_change")

    if age is not None:
        if age < 30:
            add("recent", "Recent registration", 22, f"Registered {age} days ago")
        elif age < 90:
            add("recent", "Recent registration", 15, f"Registered {age} days ago")
        elif age < 180:
            add("recent", "Recent registration", 8, f"Registered {age} days ago")
        if age < 180:
            tags.add("recent")
            if len(rec.maintainers) == 1:
                add("recent", "Single new maintainer", 6, f"Only maintainer: {rec.maintainers[0]}")

    dl = rec.weekly_downloads
    if dl is not None:
        if dl < 100:
            add("downloads", "Very low downloads", 14, f"{human_downloads(dl)} for a package this project depends on")
        elif dl < 1000:
            add("downloads", "Low downloads", 8, f"{human_downloads(dl)} for a package this project depends on")
        if dl < 1000:
            tags.add("low_downloads")

    s = rec.install_scripts
    hooks = [h for h in ("preinstall", "install", "postinstall") if getattr(s, h)]
    if hooks:
        add("install", "Install script", 12, f"Runs {compact(hooks)} at install time")
        tags.add("install_script")
    elif s.prepare:
        add("install", "Prepare script", 4, "prepare runs on install from git and on publish")
        tags.add("install_script")
    if s.build_script:
        if pkg.ecosystem is Ecosystem.RUST:
            add("install", "Build script (build.rs)", 5, "Executes arbitrary code during compilation")
        elif pkg.ecosystem is Ecosystem.PYPI:
            add("install", "Source-only distribution", 4, "setup.py executes during installation (no wheel published)")
        tags.add("build_script")
    if rec.network_indicators:
        add("network", "Network behaviour in script", 15, compact(rec.network_indicators, 3))
        tags.add("network")

    if rec.deprecated:
        add("deprecated", "Deprecated", 10, "Marked deprecated / yanked by the registry")
        tags.add("deprecated")
    gap = pkg.metadata.version_gap if pkg.metadata else None
    if gap is not None and gap >= 2:
        add("deprecated", "Version gap", 8, f"Resolved version is {gap} major versions behind {rec.latest_version}")
    elif gap == 1:
        add("deprecated", "Version gap", 4, f"Resolved version is one major behind {rec.latest_version}")

    positives = sum(d.points for d in drivers if d.points > 0)
    if positives <= 0:
        return None
    if dl is not None and dl >= 1_000_000:
        drivers.append(drv("Established package", -15, f"{human_downloads(dl)} - widely used and scrutinised"))
    elif dl is not None and dl >= 100_000:
        drivers.append(drv("Established package", -8, f"{human_downloads(dl)} - widely used"))
    total = sum(d.points for d in drivers)
    if total < MIN_EMIT_SCORE:
        return None

    # a strong single signal wins the title; otherwise the largest contributor
    primary = max(keys, key=lambda k: (k[0], k[1] == "network"))[1]
    if "network" in {k for _, k in keys}:
        primary = "network"
    rule, title = RULES[primary]
    if len({k for _, k in keys}) >= 3 and primary not in ("network", "maintainer"):
        title = "Suspicious Package Metadata"
    labels = [d.label.lower() for d in drivers if d.points > 0]
    evidence = [
        ev("Package", f"{pkg.name}@{pkg.version}" if pkg.version else pkg.name),
        ev("Registered", rec.registered_at or "unknown"), ev("Package age", f"{age} days" if age is not None else "unknown", mono=False),
        ev("Weekly downloads", human_downloads(dl), mono=False),
        ev("Latest version", rec.latest_version or "unknown"),
    ]
    if rec.maintainers:
        evidence.append(ev("Maintainers", compact(rec.maintainers, 5)))
    if rec.maintainer_changes:
        evidence.append(ev("Maintainer changes", rec.maintainer_changes, mono=False))
    for hook in ("preinstall", "install", "postinstall", "prepare"):
        val = getattr(s, hook)
        if val:
            evidence.append(ev(f"{hook} script", val[:160]))
    if s.build_script:
        evidence.append(ev("Build script", "build.rs / sdist-only setup.py", mono=False))
    if rec.network_indicators:
        evidence.append(ev("Script indicators", compact(rec.network_indicators, 4)))
    if rec.repository_url:
        evidence.append(ev("Repository", rec.repository_url))
    evidence.append(ev("Lockfile", pkg.source_file))

    return Detection(
        package_id=pkg.id, category=Category.SUSPICIOUS_METADATA, rule_id=rule, title=title, drivers=drivers,
        summary=f"`{pkg.name}` shows {compact(labels, 3)}.",
        why_flagged=("Registry metadata for this dependency matched risk signals: "
                     + "; ".join(f"{d.label} ({d.points:+d})" for d in drivers) + ". No single signal proves malice; together they raise review priority."),
        attack_vector=VECTORS[primary], evidence=evidence, tags=tags,
        confidence_base=0.45, confidence_adjustments=[("registry metadata directly observed", 0.15)] + (
            [("network indicator in a lifecycle script", 0.15)] if "network" in tags else []) + (
            [("multiple independent signals", 0.1)] if len(keys) >= 3 else []),
    )


def detect_metadata(ctx: ScanContext, skip: set[str] | None = None) -> list[Detection]:
    """Metadata findings. ``skip`` = package ids whose registry signals are already scored by another finding."""
    out: list[Detection] = []
    for pkg in ctx.packages:
        if pkg.resolution in (Resolution.LOCAL, Resolution.VCS) or (skip and pkg.id in skip):
            continue
        rec = ctx.record(pkg)
        if rec is None:
            continue
        d = analyse(pkg, rec, ctx)
        if d:
            out.append(d)
    return out
