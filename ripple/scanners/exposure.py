"""Registry-exposure checks that need only the lockfile (no registry lookups)."""
from __future__ import annotations

import re
from collections import defaultdict

from ..models import Category, Ecosystem, Package, Resolution
from ..parsers.base import ParsedLockfile, host_of, is_insecure_url, is_public_source, looks_like_commit
from .base import Detection, ScanContext, compact, drv, ev
from .confusion import assess_internal

AGGREGATE_ABOVE = 3      # more affected packages than this in one lockfile => a single aggregated finding
FLOATING = {"*", "latest", "x", "", "next"}

R = {
    "http": "RIPPLE-RE-001",
    "integrity": "RIPPLE-RE-002",
    "vcs": "RIPPLE-RE-003",
    "vcs_unpinned": "RIPPLE-RE-004",
    "mixed": "RIPPLE-RE-005",
    "floating": "RIPPLE-RE-006",
}

_INTEGRITY_ELIGIBLE = {"package-lock.json", "yarn.lock", "Pipfile.lock", "Cargo.lock", "requirements.txt", "go.mod"}


def _rep_key(p: Package) -> tuple:
    return (not p.direct, -p.dependents_count, p.name)


def _vcs_pinned(pkg: Package) -> bool:
    src = pkg.registry_source or pkg.spec or ""
    if pkg.ecosystem is Ecosystem.RUST:
        return bool(re.search(r"[?&](rev|tag)=", src))
    if pkg.ecosystem is Ecosystem.GO:
        return "@" in src
    frag = src.rsplit("#", 1)[1] if "#" in src else ""
    if looks_like_commit(frag) or looks_like_commit(frag.replace("commit=", "")):
        return True
    m = re.search(r"@([0-9a-fA-F]{7,64})(?:[#?]|$)", src)
    return bool(m)


def _is_git(src: str) -> bool:
    return bool(re.match(r"^(git\+|git://|ssh://|github:|gitlab:|bitbucket:)", src)) or src.endswith(".git") or ".git#" in src or ".git@" in src


def detect_exposure(ctx: ScanContext) -> list[Detection]:
    out: list[Detection] = []
    by_lock: dict[str, list[Package]] = defaultdict(list)
    for p in ctx.packages:
        by_lock[p.source_file].append(p)
    for fname, pkgs in by_lock.items():
        lf = ctx.lockfiles.get(fname)
        out += _insecure(pkgs, lf, ctx)
        out += _vcs(pkgs, ctx)
        out += _missing_integrity(pkgs, lf, ctx)
        out += _mixed_index(pkgs, lf, ctx)
        out += _floating(pkgs, ctx)
    return out


def _group_or_single(pkgs: list[Package], make_single, make_group) -> list[Detection]:
    if not pkgs:
        return []
    pkgs = sorted(pkgs, key=_rep_key)
    if len(pkgs) <= AGGREGATE_ABOVE:
        return [make_single(p) for p in pkgs]
    return [make_group(pkgs)]


# ---------------------------------------------------------------------------------------------------------
def _insecure(pkgs: list[Package], lf: ParsedLockfile | None, ctx: ScanContext) -> list[Detection]:
    bad = []
    for p in pkgs:
        src = p.registry_source or ""
        if is_insecure_url(src) and p.resolution is not Resolution.LOCAL:
            bad.append(p)
    tls_off = bool(lf and any("TLS verification" in s for s in lf.insecure_sources))

    def single(p: Package) -> Detection:
        hashed = p.resolution is Resolution.HASHED
        drivers = [drv("Plaintext HTTP source", 45, f"{p.registry_source} is fetched without transport security")]
        if hashed:
            drivers.append(drv("Integrity hash present", -15, "A verified hash limits tampering to hash-preserving attacks"))
        else:
            drivers.append(drv("No integrity hash", 10, "Nothing verifies the downloaded artifact"))
        if p.resolution is Resolution.RANGE:
            drivers.append(drv("Version range", 5, "Unpinned resolution over an insecure channel"))
        if p.direct:
            drivers.append(drv("Direct dependency", 3, "Declared by the project itself"))
        return _det(p, "http", "Insecure Registry Transport",
                    f"`{p.name}` is resolved over plaintext HTTP ({host_of(p.registry_source)}).",
                    "The lockfile records an http:// registry or artifact URL. Anything on the network path can read or alter the "
                    "download unless an integrity hash is verified.",
                    "Traffic over HTTP can be intercepted and modified by a network intermediary (on-path attacker), substituting "
                    "the package tarball with one containing altered or hostile code. Integrity hashes turn silent substitution into "
                    "a hard failure.", drivers, {"insecure_transport"},
                    [ev("Package", p.name), ev("Source", p.registry_source or ""), ev("Integrity hash", "present" if hashed else "missing", mono=False),
                     ev("Lockfile", p.source_file)])

    def group(ps: list[Package]) -> Detection:
        rep = ps[0]
        srcs = sorted({host_of(p.registry_source) for p in ps})
        drivers = [drv("Plaintext HTTP source", 45, f"{len(ps)} packages are fetched from {compact(srcs, 2)} over HTTP"),
                   drv("Widespread exposure", min(15, len(ps)), f"Affects {len(ps)} packages in {rep.source_file}")]
        return _det(rep, "http", "Insecure Registry Transport",
                    f"{len(ps)} packages in {rep.source_file} are resolved over plaintext HTTP.",
                    "The lockfile/index configuration uses http:// for its registry.",
                    "An on-path attacker can alter any download over HTTP; with dozens of packages affected, one intercepted build is "
                    "enough to introduce hostile code.", drivers, {"insecure_transport", "aggregated"},
                    [ev("Affected packages", len(ps), mono=False), ev("Examples", compact([p.name for p in ps], 6)),
                     ev("Hosts", compact(srcs, 3)), ev("Lockfile", rep.source_file)])

    out = _group_or_single(bad, single, group)
    if tls_off and not bad and pkgs:
        rep = sorted(pkgs, key=_rep_key)[0]
        out.append(_det(rep, "http", "TLS Verification Disabled",
                        f"{rep.source_file} disables TLS verification for a package source.",
                        "A package source is configured with verify_ssl=false (or an http:// index).",
                        "Without certificate verification any on-path attacker can impersonate the index and serve arbitrary packages.",
                        [drv("TLS verification disabled", 40, "Source certificate is not validated"),
                         drv("Affects whole lockfile", 5, f"{len(pkgs)} packages resolve through it")], {"insecure_transport"},
                        [ev("Sources", compact(lf.insecure_sources if lf else [], 3)), ev("Lockfile", rep.source_file)]))
    return out


def _vcs(pkgs: list[Package], ctx: ScanContext) -> list[Detection]:
    out: list[Detection] = []
    for p in sorted(pkgs, key=_rep_key):
        if p.resolution is not Resolution.VCS:
            continue
        src = p.registry_source or p.spec or ""
        pinned = _vcs_pinned(p)
        git = _is_git(src)
        replaced = p.ecosystem is Ecosystem.GO
        kind = "module replaced by another module" if replaced else ("git repository" if git else "URL / tarball")
        host = host_of(src) if not replaced else src.split("/")[0]
        drivers = []
        if replaced:
            drivers.append(drv("Module replaced via replace directive", 20, f"go.mod redirects `{p.name}` to {src}"))
            rule, title = "vcs", "Dependency Redirected by replace Directive"
        elif not pinned:
            drivers.append(drv("Unpinned VCS reference", 30, "Branch, tag or default HEAD can move under the lockfile"))
            rule, title = "vcs_unpinned", "Unpinned Git/URL Dependency"
            drivers.append(drv("Bypasses registry controls", 10, "No registry-side yank, malware scanning or immutability guarantees"))
        else:
            drivers.append(drv("Git/URL dependency", 25, f"Fetched from {host or 'a URL'} rather than the package registry"))
            drivers.append(drv("Pinned to a commit", -8, "Exact commit reference limits drift"))
            rule, title = "vcs", "Git/URL Dependency"
            drivers.append(drv("Bypasses registry controls", 8, "No registry-side yank, malware scanning or immutability guarantees"))
        if is_insecure_url(src):
            drivers.append(drv("Plaintext transport", 15, "Fetched over an unencrypted protocol"))
        if p.direct:
            drivers.append(drv("Direct dependency", 3, "Declared by the project itself"))
        out.append(_det(
            p, rule, title, f"`{p.name}` comes from a {kind} ({host or 'unknown host'}){'' if pinned or replaced else ' without a pinned commit'}.",
            "The dependency is not resolved from the package registry" + (" and its reference is not an immutable commit." if not pinned else "."),
            "Sources outside the registry are only as trustworthy as the account and repository behind them: a moved branch, "
            "force-pushed tag or hijacked repository changes what the next install fetches, and none of the registry's "
            "takedown or scanning mechanisms apply.", drivers, {"vcs_dependency"} | ({"unpinned"} if not pinned else set()),
            [ev("Package", p.name), ev("Source", src), ev("Pinned commit", "yes" if pinned else "no", mono=False),
             ev("Lockfile", p.source_file)]))
    return out


def _missing_integrity(pkgs: list[Package], lf: ParsedLockfile | None, ctx: ScanContext) -> list[Detection]:
    if lf is None or lf.kind not in _INTEGRITY_ELIGIBLE:
        return []
    if lf.kind == "go.mod" and not lf.meta.get("go_sum"):
        return []
    bad = [p for p in pkgs if p.resolution is Resolution.EXACT and not p.integrity]
    force_group = (lf.kind == "requirements.txt" and len(bad) > 1
                   and not any(p.resolution is Resolution.HASHED for p in pkgs))

    def single(p: Package) -> Detection:
        drivers = [drv("No integrity hash", 15, f"{lf.kind} has no hash for {p.name}@{p.version}")]
        if p.direct:
            drivers.append(drv("Direct dependency", 3, "Declared by the project itself"))
        if p.dependents_count >= 3:
            drivers.append(drv("High downstream usage", 5, f"{p.dependents_count} packages depend on it"))
        if p.registry_source and is_insecure_url(p.registry_source):
            drivers.append(drv("Plaintext transport", 10, "Unverified artifact over HTTP"))
        return _det(p, "integrity", "Missing Integrity Hash",
                    f"`{p.name}@{p.version}` is pinned but has no integrity hash in {lf.kind}.",
                    "The lockfile pins a version but records no cryptographic hash, so a different artifact under the same version "
                    "would be accepted.",
                    "Without a recorded hash, a compromised registry mirror, a re-published artifact or a proxy cache poisoning "
                    "can serve different bytes for the same version and the install will accept them.", drivers, {"no_integrity"},
                    [ev("Package", f"{p.name}@{p.version}"), ev("Resolution", p.resolution.value, mono=False),
                     ev("Lockfile", p.source_file)])

    def group(ps: list[Package]) -> Detection:
        rep = ps[0]
        share = f"{len(ps)} of {len(pkgs)}"
        drivers = [drv("No integrity hashes", 15, f"{share} packages in {lf.kind} have no hash"),
                   drv("Widespread exposure", min(15, len(ps) // 2 + 3), f"Affects {len(ps)} packages")]
        if rep.direct:
            drivers.append(drv("Includes direct dependencies", 3, ""))
        return _det(rep, "integrity", "Missing Integrity Hashes",
                    f"{share} pinned packages in {lf.kind} carry no integrity hash.",
                    "The lockfile pins versions but stores no hashes for these entries" +
                    (" (use pip-compile --generate-hashes / pip install --require-hashes)." if lf.kind == "requirements.txt" else "."),
                    "Without hashes, replaced or re-uploaded artifacts under an existing version number are installed silently.",
                    drivers, {"no_integrity", "aggregated"},
                    [ev("Affected packages", len(ps), mono=False), ev("Examples", compact([p.name for p in ps], 6)),
                     ev("Lockfile", lf.filename)])

    if force_group and bad:
        return [group(sorted(bad, key=_rep_key))]
    return _group_or_single(bad, single, group)


def _mixed_index(pkgs: list[Package], lf: ParsedLockfile | None, ctx: ScanContext) -> list[Detection]:
    if lf is None or not lf.extra_index_urls or not pkgs:
        return []
    internal = [p for p in pkgs if p.internal_looking or assess_internal(
        p.ecosystem, p.name, ctx.options.internal_scopes, p.registry_source).internal_looking]
    rep = sorted(internal or pkgs, key=_rep_key)[0]
    drivers = [drv("Mixed package index", 30, f"Extra index {compact(lf.extra_index_urls, 2)} is consulted alongside "
                                                f"{compact(lf.index_urls, 1) if lf.index_urls else 'the default index'}")]
    if internal:
        drivers.append(drv("Internal-looking packages affected", 10, f"{len(internal)} internal-looking name(s) can be satisfied by either index"))
    if any(is_insecure_url(u) for u in lf.extra_index_urls):
        drivers.append(drv("Plaintext extra index", 10, "Extra index is not HTTPS"))
    if lf.meta.get("require_hashes"):
        drivers.append(drv("--require-hashes enforced", -10, "Artifacts must match recorded hashes"))
    return [_det(
        rep, "mixed", "Mixed Package Index",
        f"{lf.filename} configures an extra index; resolution can pull from either index.",
        "pip (and similar tools) merge all configured indexes and choose the best candidate by version, not by index priority.",
        "With two indexes, a package name that exists on both is resolved by highest version, so whoever can publish a higher "
        "version to the public index can displace the private one - the classic dependency-confusion condition.",
        drivers, {"mixed_index"},
        [ev("Primary index", compact(lf.index_urls, 1) if lf.index_urls else "(default) https://pypi.org/simple"),
         ev("Extra indexes", compact(lf.extra_index_urls, 3)),
         ev("Internal-looking packages", compact([p.name for p in internal], 5) if internal else "none", mono=bool(internal)),
         ev("Lockfile", lf.filename)])]


def _floating(pkgs: list[Package], ctx: ScanContext) -> list[Detection]:
    bad = [p for p in pkgs if p.resolution in (Resolution.RANGE, Resolution.EXACT, Resolution.HASHED)
           and p.spec is not None and p.spec.strip().lower() in FLOATING and p.resolution is not Resolution.LOCAL]
    bad = [p for p in bad if (p.spec or "").strip().lower() in FLOATING]
    # A transitive package that the lockfile already pins (exact/hashed) is only "*" in its *dependent's* manifest
    # (e.g. DefinitelyTyped `@types/*` peers); installs do not float, so it is not exposure.
    bad = [p for p in bad if p.direct or p.resolution is Resolution.RANGE]
    # bare tool names in pyproject dev groups (`pytest`, `ruff`) are the norm for a manifest that has no lockfile
    bad = [p for p in bad if not (p.dev and (ctx.lockfile(p) and ctx.lockfile(p).kind == "pyproject.toml"))]
    # PEP 517 build-system requirements (`wheel`, `setuptools`) are conventionally unpinned
    bad = [p for p in bad if p.name not in ((ctx.lockfile(p) and ctx.lockfile(p).meta.get("build_requires")) or ())]

    def single(p: Package) -> Detection:
        drivers = [drv("Floating version", 15, f"Requested version is '{p.spec or '(any)'}' - every install may pick a new release")]
        if p.resolution is Resolution.RANGE:
            drivers.append(drv("Not pinned in lockfile", 8, "No exact resolved version is recorded"))
        if p.direct:
            drivers.append(drv("Direct dependency", 3, ""))
        return _det(p, "floating", "Floating Version Range",
                    f"`{p.name}` is requested as '{p.spec or '(any)'}'.",
                    "A wildcard/latest specifier accepts any published version.",
                    "Whoever publishes the next release - legitimately or after an account compromise - is picked up automatically "
                    "by the next resolve, without any change to the manifest.", drivers, {"floating"},
                    [ev("Package", p.name), ev("Requested", p.spec or "(any)"), ev("Resolved", p.version or "(unpinned)"),
                     ev("Lockfile", p.source_file)])

    def group(ps: list[Package]) -> Detection:
        rep = ps[0]
        drivers = [drv("Floating versions", 15, f"{len(ps)} dependencies accept any version"),
                   drv("Widespread exposure", min(10, len(ps)), "")]
        return _det(rep, "floating", "Floating Version Ranges", f"{len(ps)} dependencies use '*'/latest specifiers.",
                    "Wildcard/latest specifiers accept any published version.",
                    "Each resolve can silently adopt a newly published (possibly hijacked) release.", drivers,
                    {"floating", "aggregated"},
                    [ev("Affected packages", len(ps), mono=False), ev("Examples", compact([p.name for p in ps], 6)),
                     ev("Lockfile", rep.source_file)])

    return _group_or_single(bad, single, group)


def _det(p: Package, key: str, title: str, summary: str, why: str, vector: str, drivers, tags: set[str],
         evidence) -> Detection:
    return Detection(
        package_id=p.id, category=Category.REGISTRY_EXPOSURE, rule_id=R[key], title=title, drivers=drivers,
        summary=summary, why_flagged=why, attack_vector=vector, evidence=list(evidence), tags=tags,
        confidence_base=0.85, confidence_adjustments=[("observed directly in the lockfile", 0.1)],
    )
