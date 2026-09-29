from __future__ import annotations

import json

import pytest

from ripple.models import Ecosystem, Resolution
from ripple.parsers import LockfileParseError, UnsupportedLockfile, detect_file, merge_go_sum, parse_file

from conftest import fixture_text


def by_name(parsed, name, version=None):
    for p in parsed.packages:
        if p.name == name and (version is None or p.version == version):
            return p
    raise AssertionError(f"{name} not parsed: {[p.id for p in parsed.packages]}")


# ---------------------------------------------------------------------------------------------- npm
def test_package_lock_v3():
    r = parse_file("package-lock.json", fixture_text("package-lock-v3.json"))
    assert r.ecosystem is Ecosystem.NPM and r.kind == "package-lock.json"
    lp = by_name(r, "left-pad")
    assert lp.version == "1.3.0" and lp.resolution is Resolution.HASHED and lp.direct and lp.depth == 1
    assert lp.integrity == "sha512-AAA"
    # nested node_modules copy is a distinct package id; edges follow node resolution
    d1, d2 = by_name(r, "dep", "1.0.5"), by_name(r, "dep", "2.1.0")
    assert d1.id in lp.dependencies and d2.id not in lp.dependencies
    assert d1.depth == 2 and not d1.direct
    tool = by_name(r, "@scope/tool")
    assert d2.id in tool.dependencies
    assert tool.resolution is Resolution.EXACT and tool.registry_source == "http://registry.npmjs.org"  # http, no hash
    assert any(u.startswith("http://") for u in r.insecure_sources)
    priv = by_name(r, "@acme/private-lib")
    assert priv.registry_source == "https://npm.acme.corp/repo" and priv.resolution is Resolution.HASHED
    git = by_name(r, "gitdep")
    assert git.resolution is Resolution.VCS and "0123456789abcdef" in git.registry_source
    mocha = by_name(r, "mocha")
    assert mocha.dev and mocha.direct
    ws = by_name(r, "ws-pkg")
    assert ws.resolution is Resolution.LOCAL and ws.version == "0.0.1"
    assert d2.id in ws.dependencies


def test_package_lock_v1():
    r = parse_file("package-lock.json", fixture_text("package-lock-v1.json"))
    express, accepts, jest = by_name(r, "express"), by_name(r, "accepts"), by_name(r, "jest")
    assert accepts.id in express.dependencies
    assert express.direct and not accepts.direct and accepts.depth == 2
    assert jest.dev and jest.resolution is Resolution.HASHED


def test_package_lock_range_when_no_resolution_data():
    lock = {"lockfileVersion": 3, "packages": {"": {"dependencies": {"@acme/internal-utils": "^2.1.0"}},
                                               "node_modules/@acme/internal-utils": {"version": "2.1.0"}}}
    r = parse_file("package-lock.json", json.dumps(lock))
    p = r.packages[0]
    assert p.resolution is Resolution.RANGE and p.spec == "^2.1.0" and p.version == "2.1.0"


def test_yarn_v1():
    r = parse_file("yarn.lock", fixture_text("yarn-v1.lock"))
    cf = by_name(r, "@babel/code-frame")
    hl = by_name(r, "@babel/highlight")
    assert cf.version == "7.12.13" and hl.id in cf.dependencies
    assert cf.resolution is Resolution.HASHED and cf.registry_source == "https://registry.yarnpkg.com"
    assert by_name(r, "lodash").direct
    assert by_name(r, "private-thing").resolution is Resolution.VCS
    assert not hl.direct                       # depended on by code-frame
    assert r.warnings                          # yarn v1 has no direct info


def test_yarn_berry_workspace_gives_direct():
    r = parse_file("yarn.lock", fixture_text("yarn-berry.lock"))
    cf, hl = by_name(r, "@babel/code-frame"), by_name(r, "@babel/highlight")
    assert cf.direct and not hl.direct and hl.id in cf.dependencies
    assert len(r.packages) == 2                # the workspace itself is not a dependency
    assert r.meta["yarn_berry"] is True
    assert cf.resolution is Resolution.HASHED


# ---------------------------------------------------------------------------------------------- pypi
def test_requirements_txt():
    r = parse_file("requirements.txt", fixture_text("requirements.txt"))
    assert r.index_urls == ["https://pypi.acme.corp/simple"]
    assert r.extra_index_urls == ["https://pypi.org/simple"]
    assert r.includes == ["base.txt"]
    req = by_name(r, "requests")
    assert req.version == "2.31.0" and req.resolution is Resolution.HASHED and req.integrity == "sha256:aaaa"
    assert req.registry_source == "https://pypi.acme.corp/simple"
    flask = by_name(r, "flask")
    assert flask.resolution is Resolution.RANGE and flask.spec == ">=2.3,<3" and flask.version == ""
    assert by_name(r, "django").spec == "~=4.2"
    assert by_name(r, "pillow-extra").version == "10.0.0"                      # PEP 503 normalisation
    assert by_name(r, "numpy").resolution is Resolution.RANGE and by_name(r, "numpy").spec == "*"
    pdfx = by_name(r, "pdfx")
    assert pdfx.resolution is Resolution.VCS and "@main" in pdfx.registry_source
    assert by_name(r, "common-lib").resolution is Resolution.LOCAL
    # pip-compile "# via" annotations create edges and mark transitive packages
    u3 = by_name(r, "urllib3")
    assert u3.id in req.dependencies and not u3.direct and u3.depth == 2
    assert r.hashes_declared


def test_requirements_pip_compile_via_block():
    text = "a==1.0\n    # via -r requirements.in\nb==2.0\n    # via\n    #   a\n    #   c\nc==3.0\n"
    r = parse_file("requirements.txt", text)
    a, b, c = by_name(r, "a"), by_name(r, "b"), by_name(r, "c")
    assert a.direct and c.direct is True and not b.direct
    assert b.id in a.dependencies and b.id in c.dependencies


def test_pipfile_lock():
    r = parse_file("Pipfile.lock", fixture_text("Pipfile.lock"))
    req = by_name(r, "requests")
    assert req.version == "2.31.0" and req.resolution is Resolution.HASHED and req.registry_source is None
    acme = by_name(r, "acme-lib")
    assert acme.registry_source == "http://pypi.acme.corp/simple"
    assert by_name(r, "flask").resolution is Resolution.RANGE
    assert by_name(r, "pytest").dev
    vcs = by_name(r, "vcsdep")
    assert vcs.resolution is Resolution.VCS and vcs.registry_source.endswith("@abc1234")
    assert r.insecure_sources                                            # verify_ssl false / http
    assert r.extra_index_urls


def test_pyproject_pep621():
    r = parse_file("pyproject.toml", fixture_text("pyproject-pep621.toml"))
    names = {p.name: p for p in r.packages}
    assert names["requests"].resolution is Resolution.RANGE and names["requests"].spec == ">=2.28"
    assert names["pydantic"].resolution is Resolution.EXACT and names["pydantic"].version == "2.5.0"
    assert "uvicorn" in names and names["uvicorn"].spec == "~=0.24"
    assert names["pytest"].dev and names["ruff"].dev
    assert not names["mkdocs"].dev
    assert r.project_name == "demo-service"


def test_pyproject_poetry():
    r = parse_file("pyproject.toml", fixture_text("pyproject-poetry.toml"))
    names = {p.name: p for p in r.packages}
    assert "python" not in names
    assert names["requests"].spec == "^2.31" and names["requests"].resolution is Resolution.RANGE
    assert names["fastapi"].version == "0.104.1" and names["fastapi"].resolution is Resolution.EXACT
    assert names["mylib"].resolution is Resolution.VCS and names["mylib"].registry_source.endswith("@abcdef1")
    assert names["localdep"].resolution is Resolution.LOCAL
    assert names["starlette"].spec == "*"
    assert names["pytest"].dev
    assert "https://pypi.acme.corp/simple" in r.index_urls + r.extra_index_urls


# ---------------------------------------------------------------------------------------------- go
def test_go_mod_and_sum():
    r = parse_file("go.mod", fixture_text("go.mod"))
    assert r.project_name == "github.com/acme/payments"
    gin = by_name(r, "github.com/gin-gonic/gin")
    assert gin.resolution is Resolution.LOCAL and gin.registry_source == "../gin-fork"
    text = by_name(r, "golang.org/x/text")
    assert not text.direct and text.depth == 2
    testify = by_name(r, "github.com/stretchr/testify")
    assert testify.resolution is Resolution.VCS and testify.registry_source == "github.com/fork/testify@v1.8.5"
    auth = by_name(r, "corp.internal/platform/auth")
    assert auth.direct and auth.resolution is Resolution.EXACT
    merge_go_sum(r, parse_file("go.sum", fixture_text("go.sum")))
    assert by_name(r, "golang.org/x/text").integrity == "h1:TEXTHASH="
    assert by_name(r, "golang.org/x/text").resolution is Resolution.HASHED
    assert by_name(r, "corp.internal/platform/auth").resolution is Resolution.HASHED
    assert r.meta["go_sum"] is True


def test_go_sum_standalone():
    r = parse_file("go.sum", fixture_text("go.sum"))
    assert {p.name for p in r.packages} >= {"github.com/gin-gonic/gin", "golang.org/x/text"}
    assert all(p.integrity.startswith("h1:") for p in r.packages)


# ---------------------------------------------------------------------------------------------- rust
def test_cargo_lock():
    r = parse_file("Cargo.lock", fixture_text("Cargo.lock"))
    assert r.project_name == "my-app"
    assert "my-app" not in {p.name for p in r.packages}                       # workspace root is not a dependency
    serde, derive = by_name(r, "serde"), by_name(r, "serde_derive")
    assert serde.direct and serde.resolution is Resolution.HASHED and serde.integrity == "aaaa"
    assert derive.id in serde.dependencies and not derive.direct and derive.depth == 2
    tokio = by_name(r, "tokio")
    assert tokio.registry_source is None and tokio.direct                       # sparse crates.io index is public
    shared = by_name(r, "shared-lib")
    assert shared.resolution is Resolution.LOCAL
    git = by_name(r, "gitcrate")
    assert git.resolution is Resolution.VCS and "branch=main" in git.registry_source


# ---------------------------------------------------------------------------------------------- errors / detect
def test_unsupported_file_raises_typed_error():
    with pytest.raises(UnsupportedLockfile) as e:
        parse_file("notes.docx", b"PK\x03\x04binary")
    assert "not a supported file" in str(e.value)


def test_garbled_files_raise_parse_error_with_safe_message():
    for name, content in [("package-lock.json", "{not json"), ("Cargo.lock", "[[package"), ("pyproject.toml", "= = ="),
                          ("Pipfile.lock", "[1,2,3]"), ("go.mod", "hello world")]:
        with pytest.raises(LockfileParseError) as e:
            parse_file(name, content)
        assert "Traceback" not in str(e.value) and len(str(e.value)) < 200


def test_binary_content_is_rejected_safely():
    with pytest.raises(LockfileParseError):
        parse_file("package-lock.json", b"\xff\xfe\x00\x01\x80\x81")


def test_detect_file():
    ok = detect_file("requirements.txt", "requests==2.0\nflask==3.0\n")
    assert ok == {"filename": "requirements.txt", "ecosystem": "pypi", "supported": True, "kind": "requirements.txt",
                  "dependency_count": 2, "error": None}
    bad = detect_file("Cargo.lock", "nope [")
    assert bad["supported"] is False and bad["error"]
    unk = detect_file("readme.md", "# hi")
    assert unk["supported"] is False and unk["ecosystem"] is None
    sniffed = detect_file("weird-name.json", fixture_text("package-lock-v3.json"))
    assert sniffed["supported"] and sniffed["ecosystem"] == "npm"


def test_ecosystem_override_forces_requirements_parser():
    r = parse_file("deps.list", "requests==2.31.0\n", "pypi")
    assert r.packages[0].name == "requests"
