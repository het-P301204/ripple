"""Regression tests distilled from running RIPPLE against real-world lockfiles and live registry responses.

Fixtures under ``tests/fixtures/realworld/`` are trimmed copies of real files (a real ``package-lock.json`` v3, a real
``uv.lock``) plus a corpus of well-known package names that offline heuristics must never flag.
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from ripple.engine import ScanInput, run_scan
from ripple.models import Category, Ecosystem, Resolution, ScanOptions
from ripple.parsers import detect_file, parse_file
from ripple.parsers.base import LockfileParseError, UnsupportedLockfile
from ripple.parsers.normalize import npm_name
from ripple.registries import CratesRegistry, GoRegistry, NpmRegistry, PyPIRegistry
from ripple.scanners.confusion import assess_internal
from ripple.scanners.typosquatting import find_squat_target

from test_registries import Recorder, client

RW = Path(__file__).parent / "fixtures" / "realworld"
E = {"npm": Ecosystem.NPM, "pypi": Ecosystem.PYPI, "rust": Ecosystem.RUST, "go": Ecosystem.GO}


def rw(name: str) -> str:
    return (RW / name).read_text(encoding="utf-8")


def by_name(lf, name):
    return next(p for p in lf.packages if p.name == name)


# ---------------------------------------------------------------------------------------------------------
# false positives on well-known real package names (offline heuristics)
# ---------------------------------------------------------------------------------------------------------

KNOWN_GOOD = json.loads(rw("known_good_names.json"))


@pytest.mark.parametrize("eco", sorted(KNOWN_GOOD))
def test_well_known_names_are_never_flagged_by_offline_heuristics(eco):
    squats = [(n, find_squat_target(E[eco], n, 2, strict=True)) for n in KNOWN_GOOD[eco]]
    assert [x for x in squats if x[1]] == []
    internal = [n for n in KNOWN_GOOD[eco] if assess_internal(E[eco], n, [], None).internal_looking]
    assert internal == []


def _lock_text(eco: str, names: list[str]) -> tuple[str, str]:
    if eco == "npm":
        pk = {"": {"name": "x", "dependencies": {n: "1.0.0" for n in names}}}
        for n in names:
            pk[f"node_modules/{n}"] = {"version": "1.0.0", "resolved": f"https://registry.npmjs.org/{n}/-/x-1.0.0.tgz",
                                       "integrity": "sha512-AA"}
        return "package-lock.json", json.dumps({"name": "x", "lockfileVersion": 3, "packages": pk})
    if eco == "pypi":
        return "requirements.txt", "".join(f"{n}==1.0.0 --hash=sha256:aa\n" for n in names)
    if eco == "go":
        return "go.mod", "module example.com/x\n\ngo 1.22\n\nrequire (\n" + "".join(f"\t{n} v1.0.0\n" for n in names) + ")\n"
    body = 'version = 3\n\n[[package]]\nname = "app"\nversion = "0.1.0"\ndependencies = [\n' + "".join(
        f' "{n}",\n' for n in names) + "]\n\n"
    body += "".join(f'[[package]]\nname = "{n}"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n'
                    f'checksum = "aa"\n\n' for n in names)
    return "Cargo.lock", body


@pytest.mark.parametrize("eco", sorted(KNOWN_GOOD))
async def test_scanning_a_lockfile_of_popular_packages_offline_reports_no_name_findings(eco):
    fname, text = _lock_text(eco, KNOWN_GOOD[eco])
    res = await run_scan([ScanInput(fname, text)], ScanOptions(live=False))
    bad = [f for f in res.findings if f.category in (Category.DEPENDENCY_CONFUSION, Category.TYPOSQUATTING)]
    assert bad == []


def test_internal_and_squat_signals_still_fire():
    assert assess_internal(Ecosystem.NPM, "@acme/internal-utils").internal_looking
    assert assess_internal(Ecosystem.NPM, "@acme/utils").internal_looking            # company-like scope + generic name
    assert assess_internal(Ecosystem.PYPI, "acme-platform-core").internal_looking
    assert assess_internal(Ecosystem.RUST, "megacorp-core").internal_looking
    assert not assess_internal(Ecosystem.NPM, "@vitest/utils").internal_looking      # open-source scope, generic name
    assert not assess_internal(Ecosystem.RUST, "axum-core").internal_looking
    assert find_squat_target(Ecosystem.NPM, "crossenv", 2, strict=True)
    assert find_squat_target(Ecosystem.PYPI, "requets", 2, strict=True)
    assert find_squat_target(Ecosystem.PYPI, "python-requests", 2, strict=True)      # prefix affixes stay in strict mode
    assert find_squat_target(Ecosystem.NPM, "lodash-core", 2) is not None            # generic suffix: only with registry data
    assert find_squat_target(Ecosystem.NPM, "lodash-core", 2, strict=True) is None


# ---------------------------------------------------------------------------------------------------------
# real lockfiles
# ---------------------------------------------------------------------------------------------------------

async def test_real_package_lock_v3_scans_clean_offline():
    text = rw("package-lock-real-v3.json")
    lf = parse_file("package-lock.json", text)
    assert len(lf.packages) == 14
    assert {p.name for p in lf.packages if p.direct} == {"js-yaml", "postcss", "@types/babel__core"}
    assert all(p.resolution is Resolution.HASHED for p in lf.packages)
    # `*` is what @types/babel__core asks of its peers; the lockfile pins them, so this is not "floating"
    assert by_name(lf, "@types/babel__generator").spec == "*" and not by_name(lf, "@types/babel__generator").direct
    res = await run_scan([ScanInput("package-lock.json", text)], ScanOptions(live=False))
    assert res.findings == []
    assert res.summary.internal_looking == 0


async def test_floating_direct_dependency_is_still_reported():
    doc = {"name": "x", "lockfileVersion": 3, "packages": {
        "": {"dependencies": {"leftpad": "*"}},
        "node_modules/leftpad": {"version": "1.0.0", "resolved": "https://registry.npmjs.org/leftpad/-/leftpad-1.0.0.tgz",
                                 "integrity": "sha512-AA"}}}
    res = await run_scan([ScanInput("package-lock.json", json.dumps(doc))], ScanOptions(live=False))
    assert [f.title for f in res.findings] == ["Floating Version Range"]


def test_real_uv_lock():
    lf = parse_file("uv.lock", rw("uv.lock"))
    assert lf.kind == "uv.lock" and lf.project_name == "brag"
    assert len(lf.packages) == 8                                    # the project itself is not a dependency
    assert {p.name for p in lf.packages if p.direct} == {"requests", "soundfile"}
    assert by_name(lf, "cffi").depth == 2 and by_name(lf, "pycparser").depth == 3
    assert all(p.resolution is Resolution.HASHED and p.integrity.startswith("sha256:") for p in lf.packages)
    assert detect_file("uv.lock", rw("uv.lock"))["supported"]


POETRY_LOCK = '''# This file is automatically @generated by Poetry 1.8.2 and should not be changed by hand.

[[package]]
name = "certifi"
version = "2024.2.2"
description = "Python package for providing Mozilla's CA Bundle."
optional = false
python-versions = ">=3.6"
files = [
    {file = "certifi-2024.2.2-py3-none-any.whl", hash = "sha256:dc383c07b76109f368f6106eee2b593b04a011ea4d55f652c6ca24a754d1cdd1"},
]

[[package]]
name = "requests"
version = "2.31.0"
description = "Python HTTP for Humans."
optional = false
python-versions = ">=3.7"
files = [{file = "requests-2.31.0-py3-none-any.whl", hash = "sha256:58cd2187c01e70e6e26505bca751777aa9f2ee0b7f4300988b709f44e013003f"}]

[package.dependencies]
certifi = ">=2017.4.17"

[[package]]
name = "pytest"
version = "8.1.1"
description = "pytest"
optional = false
python-versions = ">=3.8"
category = "dev"
files = []

[[package]]
name = "vendored"
version = "0.1.0"
description = ""
optional = false
python-versions = "*"
files = []
develop = false

[package.source]
type = "git"
url = "https://github.com/example/vendored.git"
reference = "main"
resolved_reference = "0123456789abcdef0123456789abcdef01234567"

[metadata]
lock-version = "2.0"
python-versions = "^3.10"
content-hash = "abc"
'''


def test_poetry_lock():
    lf = parse_file("poetry.lock", POETRY_LOCK)
    assert lf.kind == "poetry.lock" and len(lf.packages) == 4
    assert by_name(lf, "requests").dependencies == [by_name(lf, "certifi").id]
    assert by_name(lf, "certifi").depth == 2 and not by_name(lf, "certifi").direct
    assert by_name(lf, "pytest").dev and not by_name(lf, "requests").dev
    v = by_name(lf, "vendored")
    assert v.resolution is Resolution.VCS and v.registry_source.endswith("@0123456789abcdef0123456789abcdef01234567")
    assert by_name(lf, "requests").integrity.startswith("sha256:")


def test_unsupported_lockfiles_get_a_specific_message():
    for name, word in (("pnpm-lock.yaml", "pnpm"), ("composer.lock", "PHP"), ("Gemfile.lock", "RubyGems")):
        with pytest.raises(UnsupportedLockfile) as ei:
            parse_file(name, "lockfileVersion: '9.0'\n")
        assert word in ei.value.message
    assert "pnpm" in detect_file("pnpm-lock.yaml", b"x")["error"]


# ---------------------------------------------------------------------------------------------------------
# npm oddities
# ---------------------------------------------------------------------------------------------------------

def _pl(packages, **top):
    return json.dumps({"name": "m", "lockfileVersion": 3, "packages": packages, **top})


def _reg(name, ver, **kw):
    return {"version": ver, "resolved": f"https://registry.npmjs.org/{name}/-/{name.split('/')[-1]}-{ver}.tgz",
            "integrity": "sha512-AA", **kw}


def test_package_lock_workspaces_links_aliases_bundled_and_peers():
    pk = {
        "": {"name": "mono", "workspaces": ["packages/*"], "dependencies": {"str-cjs": "npm:string-width@^4.2.0"}},
        "node_modules/@mono/app": {"resolved": "packages/app", "link": True},
        "packages/app": {"name": "@mono/app", "version": "0.1.0", "dependencies": {"ws": "^8"},
                         "peerDependencies": {"react-dom": "^18"}},
        "packages/app/node_modules/ws": _reg("ws", "8.17.0"),
        "node_modules/str-cjs": {**_reg("string-width", "4.2.3"), "name": "string-width"},
        "node_modules/react-dom": _reg("react-dom", "18.3.1"),
        "node_modules/npm": _reg("npm", "10.0.0"),
        "node_modules/npm/node_modules/chalk": {"version": "5.3.0", "inBundle": True},
        "node_modules/JSONStream": _reg("JSONStream", "1.3.5"),
    }
    lf = parse_file("package-lock.json", _pl(pk))
    app = by_name(lf, "@mono/app")
    assert app.resolution is Resolution.LOCAL and app.direct                       # workspace member is part of the project
    assert by_name(lf, "ws").direct                                              # installed inside the member
    assert app.dependencies == [by_name(lf, "ws").id, by_name(lf, "react-dom").id]   # peer dependencies are edges
    assert by_name(lf, "string-width").direct and by_name(lf, "string-width").name == "string-width"   # alias -> real name
    chalk = by_name(lf, "chalk")
    assert chalk.resolution is Resolution.HASHED and chalk.integrity == "sha512-AA"  # covered by the parent's hash
    assert by_name(lf, "JSONStream").name == "JSONStream"                          # legacy names are case-sensitive


def test_npm_name_keeps_case_for_unscoped_and_lowercases_scoped():
    assert npm_name("JSONStream") == "JSONStream"
    assert npm_name("@Scope%2FName") == "@scope/name"


def test_package_lock_v1_warns_about_direct_dependencies():
    v1 = {"name": "old", "lockfileVersion": 1, "dependencies": {
        "a": {"version": "1.0.0", "resolved": "https://registry.npmjs.org/a/-/a-1.0.0.tgz", "integrity": "sha1-x",
              "requires": {"b": "^1.0.0"}},
        "b": {"version": "1.2.0", "resolved": "https://registry.npmjs.org/b/-/b-1.2.0.tgz", "integrity": "sha1-y"},
        "bund": {"version": "1.0.0", "bundled": True}}}
    lf = parse_file("package-lock.json", json.dumps(v1))
    assert any("does not record which dependencies are direct" in w for w in lf.warnings)
    assert by_name(lf, "bund").integrity == "bundled"


YARN1 = '''# yarn lockfile v1


"string-width-cjs@npm:string-width@^4.2.0":
  version "4.2.3"
  resolved "https://registry.yarnpkg.com/string-width/-/string-width-4.2.3.tgz#269c7117d27b05ad2e536830a8ec895ef9c6d010"
  integrity sha512-wKyQRQpjJ0sIp62ErSZdGsjMJWsap5oRNihHhu6G7JVO/9jIB6UyevL+tXuOqrng8j/cxKTWyWUwvSTriiZz/g==

JSONStream@^1.3.5:
  version "1.3.5"
  resolved "https://registry.yarnpkg.com/JSONStream/-/JSONStream-1.3.5.tgz#3208c1f08d3a4d99261ab64f92302bc15e111ca0"
  integrity sha512-E+iruNOY8VV9s4JEbe1aNEm6MiszPRr/UfcHMz0TQh1BXSxHK+ASV1R6W4HpjBhSeS+54PIsAMCBmwD06LLsqQ==
  dependencies:
    through ">=2.2.7 <3"

through@>=2.2.7 <3:
  version "2.3.8"
  resolved "https://registry.yarnpkg.com/through/-/through-2.3.8.tgz#0dd4c9ffaabc357960b1b724115d7e0e86a2e1f5"
  integrity sha1-DdTJ/6q8NXlgsbckEV1+Doai4fU=
'''


def test_yarn_classic_alias_and_case():
    lf = parse_file("yarn.lock", YARN1)
    names = sorted(p.name for p in lf.packages)
    assert names == ["JSONStream", "string-width", "through"]
    assert by_name(lf, "JSONStream").dependencies == [by_name(lf, "through").id]


YARN_BERRY = '''__metadata:
  version: 8
  cacheKey: 10c0

"resolve@patch:resolve@npm%3A^1.20.0#optional!builtin<compat/resolve>":
  version: 1.22.8
  resolution: "resolve@patch:resolve@npm%3A1.22.8#optional!builtin<compat/resolve>::version=1.22.8&hash=c3c19d"
  dependencies:
    is-core-module: "npm:^2.13.0"
  checksum: 10c0/abcdef
  languageName: node
  linkType: hard

"is-core-module@npm:^2.13.0":
  version: 2.13.1
  resolution: "is-core-module@npm:2.13.1"
  checksum: 10c0/fedcba
  languageName: node
  linkType: hard

"string-width-cjs@npm:string-width@^4.2.0":
  version: 4.2.3
  resolution: "string-width@npm:4.2.3"
  checksum: 10c0/010101
  languageName: node
  linkType: hard

"root@workspace:.":
  version: 0.0.0-use.local
  resolution: "root@workspace:."
  dependencies:
    resolve: "patch:resolve@npm%3A^1.20.0#optional!builtin<compat/resolve>"
    string-width-cjs: "npm:string-width@^4.2.0"
  languageName: unknown
  linkType: soft
'''


def test_yarn_berry_patch_protocol_and_alias():
    lf = parse_file("yarn.lock", YARN_BERRY)
    assert sorted(p.name for p in lf.packages) == ["is-core-module", "resolve", "string-width"]
    r = by_name(lf, "resolve")
    assert r.direct and r.spec == "^1.20.0" and r.dependencies == [by_name(lf, "is-core-module").id]
    assert by_name(lf, "string-width").direct
    assert not by_name(lf, "is-core-module").direct


# ---------------------------------------------------------------------------------------------------------
# PyPI / Go / Rust oddities
# ---------------------------------------------------------------------------------------------------------

REQS = '''# café - non-ASCII comment
--index-url https://pypi.example.com/simple
-r base.txt
Flask==2.0.1 \\
    --hash=sha256:aaaa \\
    --hash=sha256:bbbb
PyYAML == 6.0.1   # inline comment
requests[socks]>=2.0 ; python_version >= "3.8"
-e .
../other/pkg-1.0.tar.gz
file:///opt/wheels/foo-1.0-py3-none-any.whl
-e git+https://github.com/org/edit.git@v1#subdirectory=x
'''


@pytest.mark.parametrize("encode", [
    lambda t: t.encode("utf-8"), lambda t: t.encode("utf-8-sig"), lambda t: t.replace("\n", "\r\n").encode("utf-8"),
    lambda t: t.encode("utf-16"), lambda t: t.encode("cp1252"),
], ids=["utf8", "bom", "crlf", "utf16", "cp1252"])
def test_requirements_encodings_and_odd_lines(encode):
    lf = parse_file("requirements.txt", encode(REQS))
    names = sorted(p.name for p in lf.packages)
    assert names == ["edit", "flask", "foo", "pkg", "pyyaml", "requests"]         # no '-' / 'pkg-1-0-tar-gz' garbage
    fl = by_name(lf, "flask")
    assert fl.version == "2.0.1" and fl.resolution is Resolution.HASHED and fl.integrity == "sha256:aaaa"
    assert by_name(lf, "pyyaml").version == "6.0.1"
    assert by_name(lf, "requests").resolution is Resolution.RANGE
    assert lf.index_urls == ["https://pypi.example.com/simple"] and lf.includes == ["base.txt"]


def test_binary_file_is_rejected_with_a_clear_message():
    with pytest.raises(LockfileParseError) as ei:
        parse_file("requirements.txt", bytes(range(256)) * 8)
    assert "binary" in ei.value.message
    with pytest.raises(LockfileParseError):
        parse_file("package-lock.json", bytes(range(256)) * 8)


def test_pyproject_uv_sources_and_build_requires():
    toml = '''
[build-system]
requires = ["setuptools>=61", "wheel"]
[project]
name = "demo"
version = "1.0"
dependencies = ["requests>=2", "mylib>=1"]
[tool.uv.sources]
mylib = { git = "https://github.com/x/mylib", rev = "abc123" }
requests = { path = "../requests" }
'''
    lf = parse_file("pyproject.toml", toml)
    assert by_name(lf, "mylib").resolution is Resolution.VCS and by_name(lf, "mylib").registry_source.endswith("@abc123")
    assert by_name(lf, "requests").resolution is Resolution.LOCAL
    assert lf.meta["build_requires"] == ["setuptools", "wheel"]


async def test_unpinned_build_requirements_are_not_floating_findings():
    toml = '[build-system]\nrequires = ["setuptools>=61", "wheel"]\n[project]\nname = "d"\nversion = "1"\ndependencies = ["click>=8"]\n'
    res = await run_scan([ScanInput("pyproject.toml", toml)], ScanOptions(live=False))
    assert [f for f in res.findings if f.title.startswith("Floating")] == []


def test_go_mod_with_every_directive():
    gomod = '''module example.com/mod

go 1.22.0
toolchain go1.22.3
godebug default=go1.21

require github.com/single/req v1.0.0
require (
	github.com/a/b v1.2.3 // indirect
	"github.com/quoted/mod" v2.0.0+incompatible
	github.com/Azure/azure-sdk-for-go v68.0.0+incompatible
)
replace (
	github.com/a/b => ../b
)
replace github.com/single/req => github.com/other/req v1.0.1
exclude github.com/bad/mod v1.0.0
retract (
	v1.0.0 // published accidentally
	[v1.1.0, v1.2.0]
)
tool github.com/foo/tool
'''.replace("\n", "\r\n")
    lf = parse_file("go.mod", gomod)
    assert sorted(p.name for p in lf.packages) == [
        "github.com/Azure/azure-sdk-for-go", "github.com/a/b", "github.com/quoted/mod", "github.com/single/req"]
    assert by_name(lf, "github.com/a/b").resolution is Resolution.LOCAL and not by_name(lf, "github.com/a/b").direct
    assert by_name(lf, "github.com/single/req").resolution is Resolution.VCS
    assert by_name(lf, "github.com/Azure/azure-sdk-for-go").name == "github.com/Azure/azure-sdk-for-go"   # case kept


CRATES_IDX = "registry+https://github.com/rust-lang/crates.io-index"
CARGO_V1 = f'''[[package]]
name = "app"
version = "0.1.0"
dependencies = [
 "libc 0.2.100 ({CRATES_IDX})",
]

[[package]]
name = "libc"
version = "0.2.100"
source = "{CRATES_IDX}"

[metadata]
"checksum libc 0.2.100 ({CRATES_IDX})" = "aaaa"
'''


async def test_cargo_lock_v1_checksums_live_in_the_metadata_table():
    lf = parse_file("Cargo.lock", CARGO_V1)
    p = by_name(lf, "libc")
    assert p.integrity == "aaaa" and p.resolution is Resolution.HASHED and p.direct
    res = await run_scan([ScanInput("Cargo.lock", CARGO_V1)], ScanOptions(live=False))
    assert [f for f in res.findings if "Integrity" in f.title] == []


def test_cargo_workspace_members_make_their_dependencies_direct():
    lock = f'''version = 3

[[package]]
name = "member-a"
version = "0.1.0"
dependencies = ["member-b"]

[[package]]
name = "member-b"
version = "0.1.0"
dependencies = ["tokio"]

[[package]]
name = "tokio"
version = "1.37.0"
source = "sparse+https://index.crates.io/"
checksum = "3333"
'''
    lf = parse_file("Cargo.lock", lock)
    assert by_name(lf, "tokio").direct and by_name(lf, "tokio").registry_source is None
    assert by_name(lf, "member-b").resolution is Resolution.LOCAL


# ---------------------------------------------------------------------------------------------------------
# live-registry response shapes (trimmed from real responses; MockTransport, no network)
# ---------------------------------------------------------------------------------------------------------

REAL_PYPI_REQUESTS = {          # https://pypi.org/pypi/requests/json (2026): author/maintainer empty, people in *_email
    "info": {"name": "requests", "version": "2.34.2", "author": None, "author_email": "Kenneth Reitz <me@kennethreitz.org>",
             "maintainer": None,
             "maintainer_email": "Ian Stapleton Cordasco <graffatcolmingov@gmail.com>, Nate Prewitt <nate.prewitt@gmail.com>",
             "summary": "Python HTTP for Humans.", "classifiers": [], "yanked": False,
             "project_urls": {"Documentation": "https://requests.readthedocs.io", "Source": "https://github.com/psf/requests"}},
    "last_serial": 1, "vulnerabilities": [],
    "ownership": {"organization": None, "roles": [{"role": "Owner", "user": "Lukasa"}, {"role": "Owner", "user": "nateprewitt"}]},
    "releases": {"0.2.0": [{"packagetype": "sdist", "upload_time_iso_8601": "2011-02-14T08:49:42.641660Z", "yanked": False}],
                 "2.34.2": [{"packagetype": "bdist_wheel", "upload_time_iso_8601": "2026-05-14T19:25:26.443000Z", "yanked": False}]},
    "urls": [{"packagetype": "bdist_wheel", "upload_time_iso_8601": "2026-05-14T19:25:26.443000Z", "yanked": False}],
}


async def test_pypi_real_shape_ownership_and_author_email():
    rec = Recorder(lambda r: httpx.Response(200, json=REAL_PYPI_REQUESTS))
    r = await PyPIRegistry(client(rec)).get_package("Requests")
    assert r.maintainers[:2] == ["Lukasa", "nateprewitt"]
    assert "Kenneth Reitz" in r.maintainers and "Nate Prewitt" in r.maintainers
    assert r.registered_at.startswith("2011-02-14") and r.latest_version == "2.34.2" and not r.install_scripts.any()


async def test_npm_lookup_keeps_case_of_legacy_names():
    seen = []

    def h(req: httpx.Request):
        seen.append(req.url.raw_path.decode())
        if req.url.host == "registry.npmjs.org":
            return httpx.Response(200, json={"name": "JSONStream", "dist-tags": {"latest": "1.3.5"},
                                             "time": {"created": "2011-09-23T11:01:36.806Z", "1.3.5": "2018-10-14T01:24:01.629Z"},
                                             "versions": {"1.3.5": {"_npmUser": {"name": "dominictarr"}}},
                                             "maintainers": [{"name": "dominictarr", "email": "x@example.com"}]})
        return httpx.Response(200, json={"downloads": 14420090, "package": "JSONStream"})

    r = await NpmRegistry(client(Recorder(h))).get_package("JSONStream")
    assert seen[0] == "/JSONStream" and seen[1].endswith("/JSONStream")
    assert r.name == "JSONStream" and r.weekly_downloads == 14420090


REAL_CRATE = {"categories": [], "keywords": [], "crate": {
    "id": "serde", "name": "serde", "created_at": "2014-12-05T20:20:39.487502Z", "downloads": 900000000,
    "recent_downloads": 328647875, "max_version": "1.0.229", "newest_version": "1.0.229", "max_stable_version": "1.0.229",
    "description": "A generic serialization/deserialization framework", "repository": "https://github.com/serde-rs/serde",
    "versions": [1, 2, 3], "yanked": False},
    "versions": [{"id": 3, "crate": "serde", "num": "1.0.229", "created_at": "2026-07-18T23:05:13.266456Z", "yanked": False},
                 {"id": 1, "crate": "serde", "num": "0.1.0", "created_at": "2014-12-05T20:20:39.487502Z", "yanked": False}]}


async def test_crates_real_shape():
    def h(req: httpx.Request):
        assert "ripple" in req.headers["user-agent"].lower()              # crates.io rejects clients without a User-Agent
        if req.url.path.endswith("/owners"):
            return httpx.Response(200, json={"users": [{"login": "dtolnay", "kind": "user"},
                                                       {"login": "github:serde-rs:publish", "kind": "team"}]})
        return httpx.Response(200, json=REAL_CRATE)

    r = await CratesRegistry(client(Recorder(h))).get_package("serde")
    assert r.registered_at.startswith("2014-12-05") and r.latest_version == "1.0.229"
    assert r.latest_published_at.startswith("2026-07-18") and r.weekly_downloads == 328647875 // 13
    assert r.maintainers == ["dtolnay", "github:serde-rs:publish"] and len(r.versions) == 2


async def test_go_proxy_real_shape_and_uppercase_escape():
    paths = []

    def h(req: httpx.Request):
        paths.append(req.url.path)
        p = req.url.path
        if p.endswith("/@latest"):
            return httpx.Response(200, json={"Version": "v1.6.0", "Time": "2025-12-18T12:15:22Z",
                                             "Origin": {"VCS": "git", "URL": "https://github.com/BurntSushi/toml",
                                                        "Ref": "refs/tags/v1.6.0", "Hash": "abc"}})
        if p.endswith("/@v/list"):
            return httpx.Response(200, text="v0.1.0\nv1.6.0\nv0.3.1\n")
        return httpx.Response(200, json={"Version": "v0.1.0", "Time": "2014-07-17T22:42:52Z"})

    r = await GoRegistry(client(Recorder(h))).get_package("github.com/BurntSushi/toml")
    assert all(p.startswith("/github.com/!burnt!sushi/toml/") for p in paths)
    assert r.name == "github.com/BurntSushi/toml" and r.registered_at == "2014-07-17T22:42:52Z"
    assert r.latest_version == "v1.6.0" and r.repository_url == "https://github.com/BurntSushi/toml"


# ---------------------------------------------------------------------------------------------------------
# CLI behaviour on hostile / odd inputs
# ---------------------------------------------------------------------------------------------------------

def test_cli_explains_why_a_file_is_unsupported(tmp_path, monkeypatch):
    from typer.testing import CliRunner

    from ripple.cli.app import app
    monkeypatch.setenv("RIPPLE_HOME", str(tmp_path / "home"))
    (tmp_path / "package-lock.json").write_bytes(bytes(range(256)) * 8)
    (tmp_path / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n")
    r = CliRunner().invoke(app, ["scan", str(tmp_path / "package-lock.json"), "--no-save"])
    assert r.exit_code == 2 and "binary" in (r.output + r.stderr).lower()
    r = CliRunner().invoke(app, ["scan", str(tmp_path / "pnpm-lock.yaml"), "--no-save"])
    assert r.exit_code == 2 and "pnpm" in (r.output + r.stderr)


def test_github_packages_tarballs_are_registry_resolved_not_vcs():
    url = "https://npm.pkg.github.com/download/@acme/util/1.0.0/0123456789abcdef0123456789abcdef01234567"
    lf = parse_file("package-lock.json", _pl({"": {"dependencies": {"@acme/util": "^1"}},
                                              "node_modules/@acme/util": {"version": "1.0.0", "resolved": url, "integrity": "sha512-AA"}}))
    p = by_name(lf, "@acme/util")
    assert p.resolution is Resolution.HASHED and p.registry_source == "https://npm.pkg.github.com"


def test_cli_ecosystem_flag_forces_a_parser_for_unrecognised_file_names(tmp_path, monkeypatch):
    from typer.testing import CliRunner

    from ripple.cli.app import app
    monkeypatch.setenv("RIPPLE_HOME", str(tmp_path / "home"))
    f = tmp_path / "deps.txt"
    f.write_text("flask==2.0.1\nrequests>=2\n")
    r = CliRunner().invoke(app, ["scan", str(f), "--no-save", "-f", "json"])
    assert r.exit_code == 2 and "--ecosystem" in (r.output + r.stderr)
    r = CliRunner().invoke(app, ["scan", str(f), "-e", "pypi", "--no-save", "-f", "json"])
    assert r.exit_code == 0, r.output
    assert json.loads(r.stdout)["summary"]["total_dependencies"] == 2


async def test_index_credentials_never_reach_the_result():
    text = ("--index-url https://deploy:s3cr3tTOKEN@pypi.acme.corp/simple\n"
            "--extra-index-url https://user:hunter2@pypi.org/simple\n"
            "acme-internal-auth>=1.0\nflask==2.0.1\n"
            "-e git+https://ghp_ABCDEF123456@github.com/acme/private.git#egg=private\n")
    res = await run_scan([ScanInput("requirements.txt", text)], ScanOptions(live=False))
    blob = res.model_dump_json()
    assert "s3cr3tTOKEN" not in blob and "hunter2" not in blob and "ghp_ABCDEF123456" not in blob
    assert "pypi.acme.corp" in blob


def test_cli_directory_with_only_a_pnpm_lockfile_explains_itself(tmp_path, monkeypatch):
    from typer.testing import CliRunner

    from ripple.cli.app import app
    monkeypatch.setenv("RIPPLE_HOME", str(tmp_path / "home"))
    proj = tmp_path / "proj"
    proj.mkdir()
    (proj / "package.json").write_text('{"name": "x"}')
    (proj / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n")
    r = CliRunner().invoke(app, ["scan", str(proj), "--no-save"])
    assert r.exit_code == 2 and "pnpm" in (r.output + r.stderr)


async def test_npm_maintainer_change_counts_new_publishers_not_alternation():
    """express alternates between its maintainers 15 times; that is a healthy team, not a takeover."""
    def doc(users):
        vs = {f"1.0.{i}": {"_npmUser": {"name": u}} for i, u in enumerate(users)}
        ts = {"created": "2015-01-01T00:00:00.000Z", **{v: f"2020-01-{i + 1:02d}T00:00:00.000Z" for i, v in enumerate(vs)}}
        return {"name": "p", "dist-tags": {"latest": list(vs)[-1]}, "time": ts, "versions": vs}

    async def changes(users):
        rec = Recorder(lambda r: httpx.Response(200, json=doc(users)) if r.url.host == "registry.npmjs.org"
                       else httpx.Response(200, json={"downloads": 5}))
        return (await NpmRegistry(client(rec)).get_package("p")).maintainer_changes

    assert await changes(["a", "b"] * 12) == 0                      # A,B,A,B...: same two accounts
    assert await changes(["a"] * 20) == 0
    assert await changes(["a"] * 19 + ["mallory"]) == 1             # a new account publishes the latest release
    assert await changes(["a", "b"] + ["a"] * 30) == 0              # b joined long ago


def test_empty_lockfile_gets_a_warning():
    import asyncio
    res = asyncio.run(run_scan([ScanInput("requirements.txt", "# nothing here\n")], ScanOptions(live=False)))
    assert res.summary.total_dependencies == 0
    assert any("no dependencies were found" in w for w in res.warnings)


async def test_real_yarn_v1_lock_trimmed():
    text = rw("yarn-v1-real.lock")
    lf = parse_file("yarn.lock", text)
    assert len(lf.packages) == 11
    assert all(p.resolution is Resolution.HASHED for p in lf.packages)
    assert sum(len(p.dependencies) for p in lf.packages) == text.count('\n    "@babel/') + text.count("\n    chalk ") + sum(
        text.count(f"\n    {n} ") for n in ("esutils", "js-tokens", "ansi-styles", "escape-string-regexp", "supports-color",
                                             "color-convert", "color-name", "has-flag"))
    res = await run_scan([ScanInput("yarn.lock", text)], ScanOptions(live=False))
    assert res.findings == []
