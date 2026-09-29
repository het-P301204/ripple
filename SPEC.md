# RIPPLE — build contract (internal)

Root: `H:\CLAUDE\DAILY PROJECTS - R\ripple`. Windows 11, Python 3.14, Node 24. Installed: typer, rich, httpx, pydantic 2, fastapi, uvicorn, pytest, pytest-asyncio. Do NOT pip-install exotic deps without need (`respx` is NOT installed — mock with `httpx.MockTransport`).

```
ripple/                     # repo root
├── pyproject.toml          # (exists) package `ripple`, script `ripple = ripple.cli.app:main`
├── ripple/                 # python package
│   ├── models/             # (DONE — the contract; do not change field names without telling the lead)
│   ├── parsers/            # npm.py pypi.py golang.py rust.py + detect.py (+ __init__: parse_file, detect_file)
│   ├── registries/         # base.py npm.py pypi.py golang.py crates.py + cache.py + fixture.py (offline fixture registry)
│   ├── scanners/           # confusion.py typosquatting.py metadata.py exposure.py
│   ├── scoring/risk.py
│   ├── engine.py           # orchestrator
│   ├── demo/               # dataset.py (synthetic 4-ecosystem project), popular.py (popular package lists)
│   ├── reports/            # rich.py json.py sarif.py csv.py
│   ├── cli/                # app.py commands/ output/
│   ├── server/             # app.py (FastAPI), jobs.py, store.py, static/ (built web goes here)
│   └── config.py           # settings load/save (~/.ripple/settings.json), paths
├── tests/
├── web/                    # React + TS + Vite
├── README.md  LICENSE  SPEC.md
```

## Engine interface (owned by the ENGINE agent)

```python
# ripple/engine.py
ProgressCallback = Callable[[str, str, str, float | None], None]   # (stage_id, state, detail, fraction_within_stage)

@dataclass
class ScanInput: filename: str; content: bytes | str      # lockfile bytes; filename decides the parser

async def run_scan(inputs: list[ScanInput], options: ScanOptions, *, project: str | None = None,
                   registries: RegistrySet | None = None, progress: ProgressCallback | None = None,
                   source: ScanSource | None = None) -> ScanResult
def detect(filename: str, content: bytes|str) -> DetectResult-like dict   # {filename, ecosystem, supported, kind, dependency_count, error}
# ripple/demo/__init__.py
def build_demo_scan() -> ScanResult          # deterministic, offline, uses FixtureRegistry — never touches network
def demo_inputs() -> list[ScanInput]         # the synthetic lockfiles (package-lock.json, requirements.txt, go.mod/go.sum, Cargo.lock)
```
`RegistrySet` = one `Registry` per ecosystem (async `get_package(name) -> RegistryRecord | None` (None = 404, raise `RegistryError` for 429/5xx/timeout after retries)). `FixtureRegistry` serves curated synthetic records; `LiveRegistry` classes do GET-only httpx calls with token-bucket rate limiting, `Retry-After` handling, exponential backoff, and disk+memory cache (`~/.ripple/cache`). Tests use `httpx.MockTransport`. There must be NO code path that issues anything other than GET/HEAD — enforce in the shared HTTP client (raise on other methods) and unit-test it.

## Demo dataset target ("payments-api")
187 deps: npm 87, pypi 52, go 28, rust 20. 164 public / 12 internal-looking (+ others unverified). 4 ecosystems.
Findings target: **3 dependency-confusion (critical/high, e.g. `@acme/internal-utils` not registered publicly, range-resolved)**, **8 typosquatting** (e.g. dep `requets`, `crossenv`-style, `python-requests` lookalikes, etc.), **14 suspicious metadata** (install scripts, recent registration, maintainer change, low downloads), **12 registry exposure** (http registry, no integrity hash, git deps, mixed index). Overall risk ≈ 72, severities ≈ 3 critical / 8 high / 14 medium / rest low. The `requests` lookalike group must contain: requets, requsets, reqquests, reqests, requ3sts, python-requests, python_requests with realistic registry facts. All names/records are synthetic and clearly fictional where malicious-looking (no real-world maintainers' names).

## HTTP API (owned by the SERVER agent) — `ripple serve` on 127.0.0.1:8787, serves built web from `ripple/server/static`
| Method | Path | Notes |
|---|---|---|
| GET | /api/health | `Health` |
| GET | /api/demo | builds demo scan, stores it in history, returns `ScanResult` |
| POST | /api/detect | multipart `files[]` → `DetectResult[]` |
| POST | /api/scans | multipart: `files[]`, form `options` (JSON `ScanOptions` subset) → `{job_id}` (202) |
| GET | /api/jobs/{id} | `JobStatus` (polled by UI ~300ms; reflects real engine progress) |
| GET | /api/scans | `ScanHistoryEntry[]` newest first |
| GET | /api/scans/{id} | `ScanResult` |
| DELETE | /api/scans/{id} | 204 |
| GET | /api/scans/{id}/export?format=json\|sarif\|csv | file download (Content-Disposition) |
| GET/PUT | /api/settings | `Settings` |
Errors: JSON `{error: {code, message}}` with user-safe text — never stack traces. Dev CORS for `http://localhost:5175`. Store history as JSON files in `~/.ripple/scans/`.

## Web (owned by FRONTEND agents) — `web/`, Vite dev port **5175**, proxy `/api` → `http://127.0.0.1:8787`; production build → `ripple/server/static`
Windows Application Control blocks rollup's native binary. Copy the approach from `H:\CLAUDE\DAILY PROJECTS - R\sigil\frontend`: devDependency `@rollup/wasm-node`, `scripts/patch-rollup.cjs` (copy that file) as `postinstall`. Build: `tsc -b && vite build`.
Stack: React 18 + TS + Vite 5 + Tailwind 3 (tokens in CSS variables) + framer-motion + lucide-react + react-router-dom 6. Graph: hand-rolled SVG with `d3-force` (+ manual zoom/pan) — no canvas, no react-flow. No chart lib required (SVG by hand), recharts allowed only if truly needed.
Data-loading rule: the app talks to `/api`. If `/api` is unreachable it MUST still work offline with a bundled demo: `web/src/data/demo-scan.json` (a copy of `GET /api/demo`, copied in by the lead/engine agent once available; until then a frontend agent may hand-generate a small realistic one matching `types/scan.ts`).

## Design system (non-negotiable — see the user's brief)
Graphite, NOT navy: bg `#090A0B`, sidebar `#0C0D0F`, card `#111316`, elevated `#15171A`; hairline borders `rgba(255,255,255,.06–.10)`. Accent violet `#8B5CF6/#A78BFA`, secondary magenta `#EC4899/#F472B6`, amber `#F59E0B` sparingly. Severity: critical `#F0506E`-ish red, high `#F97316`, medium `#F59E0B`, low `#A3E635`/yellow-green (muted), info neutral gray. Fonts: Inter (UI), JetBrains Mono (package names, versions, hashes, URLs, commands, evidence values) — load via Google Fonts `<link>`. Radii: 8/12/16/20/24 tokens; pills only for badges/severity/ecosystem/filters/tags. Easing `cubic-bezier(0.22,1,0.36,1)`; micro 150–220ms, component 220–350ms, page 350–500ms, hero 500–800ms. Respect `prefers-reduced-motion`. Icons: lucide only, 16/18/20px. Matte, minimal glow; glow only for focus/severity/active/key viz. No matrix rain, no neon, no fake terminal logs.
