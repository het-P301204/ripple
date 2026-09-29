"""Ecosystem-specific, defender-oriented remediation guidance."""
from __future__ import annotations

from ..models import Category, Ecosystem, Package, Remediation
from ..scanners.base import Detection


def _r(title: str, detail: str) -> Remediation:
    return Remediation(title=title, detail=detail)


def _pin(eco: Ecosystem) -> Remediation:
    return {
        Ecosystem.NPM: _r("Pin exact versions and verify integrity",
                          "Commit package-lock.json with `integrity` entries and install with `npm ci` so the lockfile is authoritative."),
        Ecosystem.PYPI: _r("Pin exact versions and require hashes",
                           "Generate a hashed lock (`pip-compile --generate-hashes`) and install with `pip install --require-hashes -r requirements.txt`."),
        Ecosystem.GO: _r("Commit go.sum and verify modules",
                         "Keep go.sum in version control, build with `-mod=readonly` and run `go mod verify` in CI."),
        Ecosystem.RUST: _r("Build from the lockfile",
                           "Commit Cargo.lock and use `cargo build --locked` (or `cargo vendor`) so checksums are enforced."),
    }[eco]


def confusion(eco: Ecosystem, tags: set[str]) -> list[Remediation]:
    out: list[Remediation] = []
    if eco is Ecosystem.NPM:
        out += [
            _r("Map the scope to your private registry",
               "In .npmrc set `@yourscope:registry=https://npm.internal.example/` so this scope is never resolved from the public registry."),
            _r("Claim the namespace publicly",
               "Register the organisation/scope on npmjs.com (or publish a placeholder) so nobody else can publish under it."),
        ]
    elif eco is Ecosystem.PYPI:
        out += [
            _r("Use a single index for internal names",
               "Avoid `--extra-index-url`; point `--index-url` at a proxy/virtual repository that serves internal names exclusively and mirrors PyPI for the rest."),
            _r("Reserve the name on PyPI",
               "Publish a harmless placeholder project with the same name so the public index cannot be used to shadow the internal package."),
        ]
    elif eco is Ecosystem.GO:
        out += [
            _r("Configure GOPRIVATE",
               "Set `GOPRIVATE=corp.example/*` (and `GONOSUMDB`/`GONOPROXY` as needed) so private modules bypass proxy.golang.org and sum.golang.org."),
            _r("Own the import path",
               "Make sure the organisation/host in the module path is controlled by you; unclaimed VCS namespaces can be registered by others."),
        ]
    else:
        out += [
            _r("Pin internal crates to your registry",
               "Declare `registry = \"internal\"` on internal dependencies and define the registry in .cargo/config.toml, or use `[source]` replacement."),
            _r("Reserve the crate name",
               "Publish a placeholder crate (or use a distinct prefix you own) so the name cannot be claimed on crates.io."),
        ]
    if "range" in tags:
        out.append(_r("Replace version ranges with exact pins",
                      "Ranges let a higher public version outrank the internal package; pin the exact version you audited."))
    if "hashed" not in tags:
        out.append(_pin(eco))
    out.append(_r("Enforce registry policy centrally",
                  "Configure your artifact manager (Artifactory/Nexus/Verdaccio/devpi) so internal namespaces are served only from private repositories and never proxied from the public registry."))
    if "registered" in tags:
        out.append(_r("Investigate the public package",
                      "Review the public package's publisher, release history and scripts; if it is not yours, report it to the registry security team and rotate anything exposed to builds that installed it."))
    return out


def typosquat(eco: Ecosystem, det: Detection) -> list[Remediation]:
    rel = det.related_package or "the intended package"
    out: list[Remediation] = []
    if "lookalike_group" in det.tags:
        out += [
            _r("Add an allow-list for new dependencies",
               "Require review (or an approved-package list) before new names enter the manifest so mistyped names cannot slip in."),
            _r("Report hostile look-alikes",
               f"If a look-alike of `{rel}` runs install scripts or contains copied code, report it to the registry's security contact for takedown."),
            _r("Verify what you actually install",
               "Confirm the lockfile names exactly match the intended packages and check publisher/provenance before upgrading."),
        ]
    else:
        out += [
            _r(f"Confirm the intended package is `{rel}`",
               f"If `{rel}` was meant, replace the dependency with it, regenerate the lockfile and remove the look-alike from every environment."),
            _r("Review the package before keeping it",
               "Inspect the publisher, repository link, release history and install scripts; treat an unexplained near-copy of a popular name as hostile until proven otherwise."),
            _r("Report if malicious",
               "Report confirmed look-alikes to the registry security team and rotate any credentials available to builds that installed it."),
        ]
    out.append({
        Ecosystem.NPM: _r("Restrict install scripts", "Use `npm ci --ignore-scripts` in CI and allow scripts only for reviewed packages."),
        Ecosystem.PYPI: _r("Prefer wheels", "Use `pip install --only-binary :all:` where possible so no `setup.py` runs during installation."),
        Ecosystem.GO: _r("Verify module provenance", "Check the module's repository and use `go mod verify`; consult the Go checksum database entry."),
        Ecosystem.RUST: _r("Audit build scripts", "Run `cargo deny`/`cargo vet` and review `build.rs` in new crates before adding them."),
    }[eco])
    return out


def metadata(eco: Ecosystem, tags: set[str]) -> list[Remediation]:
    out: list[Remediation] = []
    if "maintainer_change" in tags:
        out.append(_r("Review what changed after the maintainer change",
                      "Diff the pinned version against later releases, read the changelog and confirm the new publisher through the project's official channels."))
    if "recent" in tags or "low_downloads" in tags:
        out.append(_r("Verify provenance of a young or rarely used package",
                      "Confirm the repository, authorship and why this dependency is needed; prefer well-established alternatives."))
    if "install_script" in tags or "network" in tags:
        out.append({
            Ecosystem.NPM: _r("Disable lifecycle scripts by default", "Set `ignore-scripts=true` in .npmrc and allow-list only reviewed packages (e.g. via `npm rebuild <pkg>`)."),
            Ecosystem.PYPI: _r("Avoid running setup.py", "Install wheels only (`--only-binary :all:`) and build sdists in an isolated, network-less sandbox."),
            Ecosystem.GO: _r("Review generated code", "Inspect `go generate` directives and cgo usage in the module before use."),
            Ecosystem.RUST: _r("Review build.rs", "Read the crate's build script and run builds in a sandbox without network access (`cargo vet`, `cargo deny`)."),
        }[eco])
    if "network" in tags:
        out.append(_r("Treat fetch-and-execute scripts as hostile",
                      "Do not install this version on developer or CI machines until the script's downloads have been reviewed; run installs in an egress-restricted sandbox."))
    if "deprecated" in tags:
        out.append(_r("Migrate off the deprecated package", "Follow the deprecation notice to a maintained replacement or upgrade to a supported release."))
    out.append(_pin(eco))
    return out


def exposure(eco: Ecosystem, tags: set[str], det: Detection) -> list[Remediation]:
    out: list[Remediation] = []
    if "insecure_transport" in tags:
        out.append(_r("Use HTTPS registries only",
                      "Change http:// registry/index URLs to https:// (and enable TLS verification); block plain-HTTP egress from build agents."))
    if "unpinned" in tags or "vcs_dependency" in tags:
        out.append(_r("Pin to a full commit SHA or publish a release",
                      "Reference an immutable commit hash (not a branch or tag) or move the dependency to a versioned registry release with integrity data."))
    if "no_integrity" in tags:
        out.append({
            Ecosystem.NPM: _r("Regenerate the lockfile with integrity", "Run `npm install --package-lock-only` with a current npm so every entry records `integrity`, then use `npm ci`."),
            Ecosystem.PYPI: _r("Generate hashes", "Use `pip-compile --generate-hashes` (or `uv pip compile --generate-hashes`) and install with `--require-hashes`."),
            Ecosystem.GO: _r("Complete go.sum", "Run `go mod tidy` and `go mod verify`, and commit the resulting go.sum."),
            Ecosystem.RUST: _r("Refresh Cargo.lock", "Regenerate Cargo.lock from the registry so every crate has a `checksum`, then build with `--locked`."),
        }[eco])
    if "mixed_index" in tags:
        out += [
            _r("Remove --extra-index-url", "Use one index that proxies PyPI and hosts internal packages; pip merges indexes and picks the highest version."),
            _r("Require hashes", "Install with `--require-hashes` so only artifacts you approved can be installed from any index."),
        ]
    if "floating" in tags:
        out.append(_r("Replace wildcard/latest specifiers", "Pin to an exact, audited version and update deliberately (Renovate/Dependabot with review)."))
    if eco is Ecosystem.GO and "vcs_dependency" in tags:
        out.append(_r("Review replace directives", "Keep `replace` directives out of released go.mod files, or point them at reviewed, pinned module versions."))
    if eco is Ecosystem.RUST and "vcs_dependency" in tags:
        out.append(_r("Use [patch] or source replacement deliberately", "Prefer `cargo vendor` with source replacement; pin git dependencies with `rev = \"<sha>\"`."))
    if not out:
        out.append(_pin(eco))
    return out


def for_detection(det: Detection, pkg: Package) -> list[Remediation]:
    if det.remediation:
        return det.remediation
    eco = pkg.ecosystem
    if det.category is Category.DEPENDENCY_CONFUSION:
        return confusion(eco, det.tags)
    if det.category is Category.TYPOSQUATTING:
        return typosquat(eco, det)
    if det.category is Category.SUSPICIOUS_METADATA:
        return metadata(eco, det.tags)
    return exposure(eco, det.tags, det)
