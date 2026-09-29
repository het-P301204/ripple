"""Dependency-confusion classifier.

Gives a *reason* for every flag: is the name internal-looking, is it publicly registered, which registry would
the resolver use, how is the version resolved, and what mitigates the exposure. Not-found alone is never enough.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..models import (
    Category, Ecosystem, Package, PublicStatus, Resolution,
)
from ..parsers.base import host_of, is_public_source
from ..parsers.normalize import normalize_npm, split_npm_scope
from .base import (
    ECOSYSTEM_LABEL, REGISTRY_LABEL, Detection, ScanContext, compact, days_since, drv, ev, human_downloads,
)
from .popular import PUBLIC_GO_HOSTS, PUBLIC_NPM_SCOPES, is_popular

RULE_ID = "RIPPLE-DC-001"

STRONG_TOKENS = {"internal", "private", "corp", "corporate", "intranet", "inhouse", "proprietary", "confidential"}
GENERIC_TOKENS = {
    "core", "utils", "util", "utilities", "platform", "shared", "common", "svc", "service", "services", "infra",
    "commons", "toolkit", "framework", "foundation", "sdk", "internal",
}
PRIVATE_TLDS = (".corp", ".local", ".internal", ".lan", ".intra", ".intranet", ".private", ".home", ".localdomain")
SELF_HOSTED_LABELS = {"git", "gitlab", "bitbucket", "stash", "scm", "code", "gerrit", "gitea", "src", "vcs"}


@dataclass
class InternalAssessment:
    level: str = "none"                     # none | weak | medium | strong
    reasons: list[str] = field(default_factory=list)

    @property
    def internal_looking(self) -> bool:
        return self.level in ("medium", "strong")


# Substrings that make an organisation prefix / scope read like a private company namespace rather than an
# open-source project name (``@acme/utils``, ``mycorp-core``).
COMPANY_HINTS = ("acme", "corp", "company", "enterprise", "intranet", "contoso", "initech", "globex", "megacorp",
                 "mycompany", "myorg", "yourcompany", "example")
_COMPANY_TOKENS = {"inc", "ltd", "llc", "gmbh", "co", "org", "internal", "private", "dev-team"}


def _company_like(token: str) -> bool:
    t = token.lower()
    return t in _COMPANY_TOKENS or any(h in t for h in COMPANY_HINTS)


def _tokens(name: str) -> list[str]:
    return [t for t in re.split(r"[-_./@]+", name.lower()) if t]


def _norm_scopes(scopes: list[str]) -> list[str]:
    return [s.strip().lower().rstrip("/") for s in scopes if s and s.strip()]


def _matches_declared(eco: Ecosystem, name: str, scopes: list[str]) -> str | None:
    """Return the user-declared internal scope/prefix that ``name`` falls under, if any."""
    n = name.lower()
    for s in _norm_scopes(scopes):
        bare = s.lstrip("@")
        if not bare:
            continue
        if eco is Ecosystem.NPM:
            scope, core = split_npm_scope(n)
            if scope and scope == "@" + bare.rstrip("-_."):
                return s
            if not scope and not s.startswith("@") and core.startswith(bare) and (
                    s.endswith(("-", "_", ".")) or core[len(bare):len(bare) + 1] in ("-", "_", ".")):
                return s
        elif eco is Ecosystem.GO:
            if n == bare or n.startswith(bare.rstrip("/") + "/") or n.split("/", 1)[0] == bare:
                return s
        elif n.startswith(bare) and (s.endswith(("-", "_", ".")) or n[len(bare):len(bare) + 1] in ("-", "_", ".")):
            return s
    return None


def assess_internal(eco: Ecosystem, name: str, internal_scopes: list[str] | None = None,
                    registry_source: str | None = None) -> InternalAssessment:
    """Name-based (plus lockfile-source) internal-looking heuristics."""
    a = InternalAssessment()
    if is_popular(eco, name) and not _matches_declared(eco, name.lower(), internal_scopes or []):
        # well-known public projects are never "internal-looking" on name alone
        if registry_source and not is_public_source(eco, registry_source):
            a.level = "strong"
            a.reasons = [f"Resolved from non-public registry ({host_of(registry_source) or registry_source})"]
        return a
    strong: list[str] = []
    medium: list[str] = []
    weak: list[str] = []
    n = name.lower() if eco is not Ecosystem.GO else name
    if eco is Ecosystem.NPM and split_npm_scope(n)[0] in PUBLIC_NPM_SCOPES and not _matches_declared(eco, n, internal_scopes or []):
        # `@babel/plugin-syntax-private-property-in-object`: a well-known open-source scope is never an internal namespace
        if registry_source and not is_public_source(eco, registry_source):
            a.level = "strong"
            a.reasons = [f"Resolved from non-public registry ({host_of(registry_source) or registry_source})"]
        return a
    declared = _matches_declared(eco, n, internal_scopes or [])
    if declared:
        strong.append(f"Matches declared internal namespace '{declared}'")
    if registry_source and not is_public_source(eco, registry_source):
        strong.append(f"Resolved from non-public registry ({host_of(registry_source) or registry_source})")

    toks = _tokens(n)
    if eco is Ecosystem.GO:
        host = n.split("/", 1)[0]
        rest = n.split("/")[1:]
        if "." not in host:
            strong.append(f"Module path '{host}/...' has no public host name")
        elif host.endswith(PRIVATE_TLDS):
            strong.append(f"Module host '{host}' is a private/internal domain")
        elif host not in PUBLIC_GO_HOSTS:
            first = host.split(".")[0]
            if first in SELF_HOSTED_LABELS or "corp" in host or "internal" in host:
                medium.append(f"Module hosted on self-hosted VCS host '{host}'")
            else:
                weak.append(f"Module host '{host}' is not a well-known public host")
        if host in ("github.com", "gitlab.com", "bitbucket.org") and rest:
            if rest[0] in STRONG_TOKENS or any(t in STRONG_TOKENS for t in _tokens("/".join(rest))):
                strong.append("Module path contains an 'internal/private' token")
        if any(t in STRONG_TOKENS for t in toks) and not strong:
            strong.append("Module path contains an 'internal/private' token")
        if "/internal/" in n + "/" and host not in PUBLIC_GO_HOSTS and not strong:
            medium.append("Module path contains '/internal/'")
    else:
        scope, bare = split_npm_scope(n) if eco is Ecosystem.NPM else (None, n)
        btoks = _tokens(bare)
        if scope and scope not in PUBLIC_NPM_SCOPES:
            weak.append(f"Scoped under organisation namespace '{scope}'")
        hit = next((t for t in btoks if t in STRONG_TOKENS), None)
        if hit or n.endswith((".internal", "-internal", "_internal")):
            strong.append(f"Name contains '{hit or 'internal'}'")
        elif len(btoks) >= 2 and any(t in GENERIC_TOKENS for t in btoks[1:]) and btoks[0] not in GENERIC_TOKENS:
            # `<word>-core` / `<word>-utils` is how thousands of public packages are named (is-core-module, axum-core,
            # pydantic-core): a generic suffix is only a medium signal when the prefix reads like a company name.
            gen = next(t for t in btoks[1:] if t in GENERIC_TOKENS)
            reason = f"Organisation-prefixed generic module name ('{btoks[0]}' + '{gen}')"
            (medium if _company_like(btoks[0]) else weak).append(reason)
        elif scope and scope not in PUBLIC_NPM_SCOPES and any(t in GENERIC_TOKENS for t in btoks):
            reason = f"Org-scoped package with generic internal-style name ('{compact(btoks, 3)}')"
            (medium if _company_like(scope.lstrip("@")) else weak).append(reason)
        if eco is Ecosystem.RUST and btoks and btoks[0] in ("company", "corp", "acme") and len(btoks) > 1:
            medium.append(f"Company-prefixed crate name ('{btoks[0]}-')")
    if strong:
        a.level, a.reasons = "strong", strong + medium
    elif medium:
        a.level, a.reasons = "medium", medium + weak
    elif weak:
        a.level, a.reasons = "weak", weak
    return a


def _explicit_private(pkg: Package) -> bool:
    return bool(pkg.registry_source) and pkg.resolution not in (Resolution.VCS, Resolution.LOCAL) \
        and not is_public_source(pkg.ecosystem, pkg.registry_source)


def detect_confusion(ctx: ScanContext) -> list[Detection]:
    out: list[Detection] = []
    for pkg in ctx.packages:
        d = classify(pkg, ctx)
        if d is not None:
            out.append(d)
    return out


def classify(pkg: Package, ctx: ScanContext) -> Detection | None:
    eco = pkg.ecosystem
    if pkg.resolution in (Resolution.LOCAL, Resolution.VCS):
        return None                              # explicit source: not resolved by name
    assess = assess_internal(eco, pkg.name, ctx.options.internal_scopes, None)   # name-based only
    rec = ctx.record(pkg)
    status = pkg.public_status
    private_src = _explicit_private(pkg)
    lf = ctx.lockfile(pkg)
    mixed = bool(lf and lf.extra_index_urls)
    label = REGISTRY_LABEL[eco]

    drivers = []
    tags: set[str] = set()
    conf_adj: list[tuple[str, float]] = []
    conf_base = 0.5

    # --- gate: which packages get a finding at all ------------------------------------------------------
    if status is PublicStatus.NOT_FOUND:
        pass
    elif status is PublicStatus.REGISTERED:
        if not assess.internal_looking and not (private_src and not is_popular(eco, pkg.name)):
            return None
        # established public projects that merely resemble internal naming are not squats
        if is_popular(eco, pkg.name) or (rec and rec.weekly_downloads and rec.weekly_downloads >= 50_000
                                         and assess.level != "strong"):
            return None
        if rec and rec.weekly_downloads and rec.weekly_downloads >= 500_000:
            return None
    else:  # unknown / error: heuristics only
        if not assess.internal_looking:
            return None

    # --- name signal --------------------------------------------------------------------------------------
    if assess.level == "strong":
        drivers.append(drv("Internal-looking name", 30, "; ".join(assess.reasons[:2])))
        conf_adj.append(("strong internal-name signal", 0.15))
    elif assess.level == "medium":
        drivers.append(drv("Internal-looking name", 18, "; ".join(assess.reasons[:2])))
        conf_adj.append(("moderate internal-name signal", 0.05))
    elif assess.level == "weak":
        drivers.append(drv("Organisation-style namespace", 8, "; ".join(assess.reasons[:1])))
    if not assess.internal_looking and private_src and status is PublicStatus.REGISTERED:
        drivers.append(drv("Private-registry package", 20,
                           f"Resolved from {host_of(pkg.registry_source)} yet the same name is public"))
        assess.reasons.append("Resolved from a private registry but registered publicly")
    if any(r.startswith("Matches declared") for r in assess.reasons):
        conf_adj.append(("matches user-declared internal scope", 0.1))

    # --- public registry status ---------------------------------------------------------------------------
    evidence_extra = []
    if status is PublicStatus.NOT_FOUND:
        tags.add("not_found")
        if assess.internal_looking:
            drivers.append(drv("Not publicly registered", 30,
                               f"No package of this name exists on {label}, so the name is unclaimed there"))
        else:
            drivers.append(drv("Not found on public registry", 10,
                               f"{label[0].upper() + label[1:]} has no such package and the name does not look internal"))
        conf_adj.append(("registry confirmed the name is unregistered", 0.2))
    elif status is PublicStatus.REGISTERED:
        tags.add("registered")
        drivers.append(drv("Already registered publicly", 25,
                           f"An internal-looking name exists on {label} - possible pre-emptive registration"))
        conf_adj.append(("registry confirmed a public package exists", 0.1))
        if rec:
            age = days_since(rec.registered_at, ctx.now)
            if age is not None and age < 90:
                drivers.append(drv("Recent registration", 15, f"Registered {age} days ago"))
                tags.add("recent")
            elif age is not None and age < 365:
                drivers.append(drv("Recent registration", 8, f"Registered {age} days ago"))
                tags.add("recent")
            if rec.weekly_downloads is not None and rec.weekly_downloads < 1000:
                drivers.append(drv("Low downloads", 10, f"Only {human_downloads(rec.weekly_downloads)} on the public registry"))
            if rec.install_scripts.any():
                drivers.append(drv("Install script", 12, "The public package runs code at install time"))
                tags.add("install_script")
    else:
        tags.add("unverified")
        drivers.append(drv("Public status unverified", 10,
                           "Registry was not queried (offline mode) or the lookup failed; result is heuristic only"))
        conf_adj.append(("public registry status not verified", -0.15))

    # --- version resolution -------------------------------------------------------------------------------
    if pkg.resolution is Resolution.RANGE:
        tags.add("range")
        drivers.append(drv("Version range", 15, f"'{pkg.spec or '*'}' is not pinned - a higher public version would win"))
    elif pkg.resolution is Resolution.HASHED:
        tags.add("hashed")
        drivers.append(drv("Pinned with integrity hash", -10, "Exact version with a lockfile hash limits substitution"))
    elif pkg.resolution is Resolution.EXACT and eco is not Ecosystem.GO:
        tags.add("exact")
        drivers.append(drv("Exact pin without hash", 5, "Pinned, but no integrity hash to detect substitution"))
    elif pkg.resolution is Resolution.EXACT:
        tags.add("exact")
        drivers.append(drv("Exact pin without go.sum hash", 5, "Pinned by go.mod but not covered by a go.sum entry"))

    # --- source / index ----------------------------------------------------------------------------------
    if private_src:
        tags.add("private_source")
        drivers.append(drv("Explicit private registry source", -20,
                           f"Lockfile records {host_of(pkg.registry_source) or pkg.registry_source}"))
        if status is PublicStatus.NOT_FOUND:
            conf_adj.append(("resolved from an explicit private source", 0.05))
    elif mixed:
        tags.add("mixed_index")
        drivers.append(drv("Mixed package index", 15,
                           f"Extra index configured ({compact(lf.extra_index_urls, 2)}): resolver considers both indexes"))
    else:
        tags.add("public_source")
        drivers.append(drv("Resolved via public registry", 10,
                           "Lockfile does not pin a private registry for this package"))
    if lf and lf.meta.get("require_hashes"):
        drivers.append(drv("--require-hashes enforced", -10, "pip refuses artifacts whose hash is not in the lock"))
        tags.add("hashed")

    # --- downstream usage --------------------------------------------------------------------------------
    if pkg.dependents_count >= 3:
        drivers.append(drv("High downstream usage", 10, f"{pkg.dependents_count} packages in the project depend on it"))
        tags.add("high_usage")

    total = sum(d.points for d in drivers)
    informational = status is PublicStatus.NOT_FOUND and not assess.internal_looking and private_src
    if total <= 0:
        return None
    if total < 10 and status in (PublicStatus.UNKNOWN, PublicStatus.ERROR):
        return None

    # --- narrative ----------------------------------------------------------------------------------------
    eco_label = ECOSYSTEM_LABEL[eco]
    if status is PublicStatus.NOT_FOUND and assess.internal_looking:
        title = "Dependency Confusion Candidate"
        summary = (f"`{pkg.name}` looks internal and is not registered on {label}"
                   f"{'; resolved by version range' if 'range' in tags else ''}.")
        why = (f"The name matches internal naming patterns ({'; '.join(assess.reasons[:2])}) and {label} returns 404 for it. "
               f"Resolution: {pkg.resolution.value}{f' ({pkg.spec})' if pkg.spec else ''}; "
               f"{'private registry pinned in lockfile' if private_src else 'no private registry is pinned for this package'}.")
        vector = (f"If a resolver ever consults {label} for this name - a missing scope-to-registry mapping, a fallback index, or a "
                  f"CI job without the private registry config - anyone able to publish that unclaimed name publicly could supply a "
                  f"package that is installed instead of the internal one. Resolvers that prefer the highest version number "
                  f"are the most exposed, and install-time scripts would run with the build's privileges.")
    elif status is PublicStatus.NOT_FOUND:
        title = "Unregistered Package Name" if not informational else "Private Package (Expected)"
        summary = (f"`{pkg.name}` is not on {label}; it is resolved from an explicit private source."
                   if informational else f"`{pkg.name}` is not registered on {label} and has no internal naming signals.")
        why = ("Not-found alone is not treated as a confusion signal: the name does not look internal and the lockfile pins a "
               "private source, so the exposure is limited to a future lockfile regeneration without that registry."
               if informational else
               "The registry returned 404 for a name the lockfile resolves without a private registry. It may have been unpublished, "
               "renamed, or served from a registry the lockfile does not record.")
        vector = (f"An unclaimed public name can be registered by anyone. If this dependency is ever re-resolved through {label}, "
                  f"the lockfile's trust in the name would transfer to whoever registered it first.")
    elif status is PublicStatus.REGISTERED:
        title = "Internal-Looking Name Registered Publicly"
        summary = f"`{pkg.name}` looks internal but already exists on {label}."
        age = days_since(rec.registered_at, ctx.now) if rec else None
        why = (f"The name matches internal naming patterns ({'; '.join(assess.reasons[:2])}) yet a public package with that name exists"
               f"{f', first published {age} days ago' if age is not None else ''}"
               f"{f' with {human_downloads(rec.weekly_downloads)}' if rec and rec.weekly_downloads is not None else ''}.")
        vector = (f"A public package sharing an internal package's name is the precondition for dependency confusion: if the resolver "
                  f"consults {label} it may select the public artifact - especially with a higher version number - and run its "
                  f"install-time code inside the build environment.")
    else:
        title = "Potential Dependency Confusion (Unverified)"
        summary = f"`{pkg.name}` looks internal; public registry status was not verified."
        why = (f"Heuristic only: {'; '.join(assess.reasons[:2])}. Run a live scan to check whether the name is registered publicly.")
        vector = (f"If this internal-looking name is unclaimed on {label} and the build can reach that registry, a publicly "
                  f"registered package of the same name could be selected instead of the private one.")

    evidence = [
        ev("Package", pkg.name), ev("Ecosystem", eco_label, mono=False),
        ev("Resolution", f"{pkg.resolution.value}" + (f" ({pkg.spec})" if pkg.spec else ""), mono=False),
        ev("Registry source", pkg.registry_source or f"(default) {pkg.registry}"),
        ev("Public status", status.value, mono=False),
    ]
    if assess.reasons:
        evidence.append(ev("Internal-name signals", "; ".join(assess.reasons), mono=False))
    if rec and status is PublicStatus.REGISTERED:
        evidence += [ev("Registered publicly", rec.registered_at or "unknown"),
                     ev("Weekly downloads", human_downloads(rec.weekly_downloads), mono=False)]
        if rec.maintainers:
            evidence.append(ev("Public maintainers", compact(rec.maintainers, 4)))
    if lf and lf.extra_index_urls:
        evidence.append(ev("Extra indexes", compact(lf.extra_index_urls, 3)))
    if pkg.dependents_count:
        evidence.append(ev("Dependents in project", pkg.dependents_count, mono=False))
    evidence.append(ev("Lockfile", pkg.source_file))

    return Detection(
        package_id=pkg.id, category=Category.DEPENDENCY_CONFUSION, rule_id=RULE_ID, title=title, drivers=drivers,
        summary=summary, why_flagged=why, attack_vector=vector, evidence=evidence, tags=tags,
        confidence_base=conf_base, confidence_adjustments=conf_adj,
    )
