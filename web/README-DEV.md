# RIPPLE web — developer guide

React 18 + TypeScript + Vite 5 + Tailwind 3 + framer-motion + lucide-react + react-router 6. No chart lib; graph = hand-rolled SVG + `d3-force`.

```
npm install          # postinstall patches rollup -> @rollup/wasm-node (Windows Application Control blocks the native binary)
npm run dev          # http://localhost:5175, proxies /api -> http://127.0.0.1:8787
npm run build        # tsc -b && vite build  -> ../ripple/server/static
npm run sample       # regenerate src/data/demo-scan.json (offline fallback; the lead replaces it with the real /api/demo output)
```
Launch config: `.claude/launch.json` entry `ripple-web`. If HMR misbehaves, delete `node_modules/.vite`.

## Layout

| Path | What lives there |
|---|---|
| `src/types/scan.ts` | The API contract (mirror of the Python models). Never rename fields. |
| `src/styles/tokens.css` | ALL design tokens (colours as RGB triplets, severity triads, radii, spacing, shadows, motion). |
| `src/styles/globals.css` | Tailwind layers, focus ring, grain/ambient, keyframes, reduced-motion, responsive-table CSS. |
| `tailwind.config.js` | Maps Tailwind colours/radii/shadows to the CSS variables. |
| `src/lib/` | `api.ts` (typed client), `store.tsx` (state), `motion.ts`, `meta.ts` (severity/ecosystem/category tables), `format.ts`, `exporters.ts`, `nav.ts`, `cn.ts` |
| `src/hooks/` | `useScan.ts` (store + selectors), `useFocusTrap.ts` |
| `src/components/ui/` | The UI kit (below). Import from `@/components/ui` (barrel) or the file. |
| `src/components/brand/` | `Logo`, `LogoMark`, `RippleRings`, `AmbientBackground` |
| `src/components/layout/` | `AppShell`, `PageTransition`, `Sidebar`, `Topbar` |
| `src/components/scan/` | `ScanModal`, `ScanModalContext` (`useScanModal`), `ScanViz` |
| `src/components/` | `FindingCard`, `NoScanEmptyState`, `PagePlaceholder`, `LoadingScreen` (`LoadingGate`) |
| `src/pages/` | one file per route. `charts/` and `graph/` are reserved (empty) for the chart and graph agents. |

Path alias: `@/` = `src/`.

## Adding a page (parallel-safe)

1. Edit only `src/pages/YourPage.tsx` (default export). Routes for every planned page already exist in `App.tsx` and render `PagePlaceholder`; **replace the file body, keep the default export**.
2. Inside, start with `const { scan } = useScan(); if (!scan) return <><PageHeader …/><NoScanEmptyState /></>`.
3. Wrap content in `<PageHeader/>` + `<Section/>`s. Page entrance/exit is handled by `PageTransition` (don't add your own route fade); do stagger your own children with `staggerParent` / `itemVariants` from `@/lib/motion`.
4. New top-level route or nav item: add a `<Route>` in `App.tsx` and a `NAV` entry in `src/lib/nav.ts`. Do not put page logic in shared files.
5. Filters live in the URL (`/findings?severity=critical&category=typosquatting`). The Overview links use `severity`, `category`, and `ecosystem` params.

## Data / state

`useScan()` (alias of `useRipple()`) returns:

`scan: ScanResult | null` · `history` · `health` · `apiOnline` · `offline` (API unreachable -> bundled demo) · `ready` · `loading` · `job: JobStatus | null` (real, polled ~300ms) · `scanning` · `scanFailure: {variant, detail?} | null` · `exporting`
`loadDemo()` · `runDemoScan()` (animated stage sequence tied to the real load) · `loadScan(id)` · `startScan(files, options?, project?)` · `resetJob()` · `clearScan()` · `deleteScan(id)` · `exportScan('json'|'sarif'|'csv'|'pdf')` · `refreshHealth()` · `refreshHistory()`

Selectors (`hooks/useScan.ts`): `useScanIndex()` -> `{packageById, packageByName, findingById, findingsByPackage, sortedFindings}`; `useFindings({severity, category, ecosystem, query, packageId})`; `useFinding(id)`; `usePackage(idOrName, ecosystem?)`.

`lib/api.ts` exports `api` (`health, demo, detect, createScan, job, scans, scan, deleteScan, exportUrl, exportBlob, settings, saveSettings`) and `ApiError` (`.unreachable` when the server is down; never show raw error text, map to `ErrorState`).

Offline: `/api` unreachable -> `loadDemo()` uses `src/data/demo-scan.json` (mode `demo`), topbar shows "Offline demo", real scans show the `server` ErrorState with Retry. Export falls back to client-side JSON/CSV/SARIF/HTML (`lib/exporters.ts`). Last viewed scan id: `localStorage['ripple.lastScan']`. Loading screen shown once per session: `sessionStorage['ripple.booted']` (clear both to see the landing page again).

## UI kit (`src/components/ui`)

| Component | Notes |
|---|---|
| `Button` / `LinkButton` | `variant: primary\|secondary\|ghost\|danger`, `size: sm\|md\|lg`, `icon`, `loading`, `leading/trailing`. Primary/secondary ripple from the pointer. |
| `Card` | `interactive` (hover lift + brighter border), `radius: 2\|3\|4\|5`, `padded`, `elevated` |
| `Badge` / `Pill` | `tone: neutral\|accent\|magenta\|amber\|ok`, `mono` |
| `SeverityBadge`, `SeverityDot` | critical dot pulses every few seconds; high glows on hover; `size: sm\|md` |
| `EcosystemPill`, `EcosystemMark` | npm / PyPI / Go / Rust custom SVG marks |
| `Input`, `SearchInput`, `Select`, `Switch` | `SearchInput` is controlled (`value`, `onChange(string)`), Esc clears |
| `Segmented` (`Tabs`) | shared-layout indicator; `variant: segmented\|tabs`; options `{value,label,count?}` |
| `Modal`, `Drawer` | portal, blur backdrop, focus trap, Esc, 24px radius; `open`, `onClose`, `title`/`label` |
| `Tooltip` | wrap one element: `<Tooltip content="…"><button/></Tooltip>` |
| `Dropdown` | `items: MenuItem[]`, `trigger={({ref, props}) => <Button ref={ref} {...props}/>}` |
| `ToastProvider`, `useToast()` | `.success/.error/.info(title, detail?)` |
| `Skeleton`, `SkeletonRows`, `SkeletonCards` | |
| `CopyButton`, `Mono` | `Mono` = JetBrains Mono text; `copy` prop adds a copy button |
| `CountUp` | `value`, `duration`, `delay`; snaps under reduced motion |
| `TableContainer/Table/THead/TBody/Tr/Th/Td/ExpandableTr` | 56px rows; give each `Td` a `label` for the mobile card mode (<768px) |
| `EmptyState`, `ErrorState`, `StateGlyph` | `ErrorState variant: registry\|lockfile\|server\|generic` uses the brief's copy verbatim |
| `ProgressRing`, `ProgressBar`, `RadialScore`, `Sparkline`, `MicroBar` | SVG, no chart lib |
| `PageHeader`, `Section`, `StatCard` | `StatCard`: label, value (CountUp), description, context, indicator, `to` |
| `Kbd` | |

Shared feature components: `FindingCard({finding, rank?})`, `NoScanEmptyState({title?, description?})`, `useScanModal().openScan({demo?})`, `Landing`.

## Design rules (from SPEC.md)

Graphite, not navy. Violet primary, magenta secondary, amber sparingly. Pills only for badges/severity/ecosystem/filters/tags. Mono font for package names, versions, hashes, URLs, commands, evidence values (`className="mono"` or `<Mono>`). Motion tokens: micro 150-220ms, component 220-350ms, page 350-500ms, hero 500-800ms with `cubic-bezier(0.22,1,0.36,1)` (`EASE` in `lib/motion.ts`). Always respect reduced motion: use `useReducedMotion()` / the variant factories in `lib/motion.ts` (`pageVariants(reduced)`, `itemVariants(reduced)` …) or the `useMotion()` hook.

Microcopy: "Attack surface mapped", "Resolving dependency relationships…", "Registry query interrupted", "No exposed package signals detected".

## History, Reports, Settings, NotFound (wave 2, agent C)

| Route | File | Notes |
|---|---|---|
| `/history` | `pages/History.tsx` | Trend card (`components/history/RiskTrend`), responsive table (cards <768px, sideways scroll 768–1200px), row menu (open / export JSON, SARIF, CSV / delete), `DeleteScanModal`. Data = `history` from the store; when the API is down it shows the scan held in the store (`entryFromScan`) with a banner. Opening a row calls `loadScan(id)` then navigates to `/` with the "Attack surface mapped" toast. Non-current rows export through `api.exportBlob`; offline only the open scan can be exported (client exporters). |
| `/reports` | `pages/Reports.tsx` | `ReportDocument` (`components/reports`) renders the executive report from a `ScanResult`. `theme="dark"` = in-app, `theme="paper"` = light print theme. Right rail: `ExportCard` x4 (JSON / SARIF / CSV / PDF-ready, all through `exportScan(format)`), `TerminalPreview` (built from real scan data, palette copied from `ripple/reports/rich.py`), collapsible `SarifPreview` (client-generated excerpt). |
| `/settings` | `pages/Settings.tsx` | `lib/settings.ts` (defaults = `ripple/config.py`, validation, `loadSettings` / `persistSettings` with localStorage fallback under `ripple.settings`). Controls in `components/settings`: `RegistryField`, `ThresholdControl` (4 handles, `role="slider"`, live severity preview from the open scan), `TagInput`, `NumInput`, `RadioSegmented` (real radiogroup), `SectionNav`, `SaveBar`. |
| `*` | `pages/NotFound.tsx` | Ripple rings behind the broken-link glyph; shows the attempted path. |

**Printing.** `Reports` mounts a paper-theme copy of the report in a `div.rp-print-root` that is a direct child of `<body>` (portal). `lib/report-print.css` hides it on screen and, under `@media print`, hides every other body child (`body > *:not(.rp-print-root)`), so only the report prints: A4 `@page`, `break-inside: avoid` on cards/rows, findings start on a new page, page counter in the margin box where supported. The window title is set to "RIPPLE report - <project>" during printing so the saved PDF is named sensibly. To change the report, edit `ReportDocument.tsx` (structure) or `report-print.css` (`.rp-*` classes; sizes are in `em`, `data-theme` switches palettes). Keep the mark gradient-free: the print copy is duplicated in the DOM and the app copy is `display:none` while printing.

**Settings save semantics.** `PUT /api/settings` succeeds -> "Settings saved". If the server is unreachable the values are written to localStorage instead, the toast says "Saved locally" and the header shows a subtle "Saved locally" note. A validation error from the server is surfaced as an error toast (nothing is stored locally in that case). Threshold rule (server enforces the same): `critical > high > medium > low >= 0`. Ctrl/Cmd+S saves while there are unsaved changes.

**Reusable pieces.** `RadioSegmented` (`components/settings/controls.tsx`) is the accessible alternative to `Segmented` when the control is a setting rather than tabs. `Field` / `SettingRow` wire label, help and error text to the control. `CommandLine` (`components/reports/ExportCard.tsx`) is a mono command with a copy button.

**Accessibility notes.** Inputs are labelled (`label[for]`), errors are linked with `aria-describedby` and `role="alert"`; the save bar is a labelled region with a polite status; the delete dialog is focus-trapped and starts on "Keep scan"; threshold handles and radio groups are fully keyboard operable; informational text uses `ink-3` or brighter (`ink-4` is reserved for decoration because it is below 4.5:1 on cards).

## Visualizations (`src/graph/`, `src/charts/`) — added by the visualization agent

Pages: `DependencyGraph` (`/graph`, `?focus=<package name>&severity=critical,high&ecosystem=npm`), `AttackSurface` (`/attack-surface`, `?category=&finding=`), `Typosquatting` (`/typosquatting/:pkg`, `?c=<lookalike>&eco=`).

| Export | Use |
|---|---|
| `@/charts` `CharDiff({original, candidate, mode: 'candidate'\|'original'\|'stacked'})` | Mono name with the differing characters highlighted (gap marker for missing characters). Pure helpers in `charts/diff.ts` (`diffChars`, `describeDiff`, `editDistance`). |
| `@/charts` `SeverityRing({severity, value, max?, size?, stroke?, children?})` | Small ring gauge in the severity colour. |
| `@/charts` `LookalikeTree / LookalikeDetail / LookalikeTable / LookalikeSelector` | Typosquatting building blocks (take a `LookalikeGroup`). |
| `@/charts` `AttackConstellation / AttackPath / ExposedList / SurfaceMatrix`, `buildSurface(scan)` | Attack-surface building blocks. |
| `@/charts` `useMeasure`, `useMedia` | ResizeObserver / matchMedia hooks. |
| `@/graph` `buildModel(scan)`, `computeView(model, opts)`, `neighbourhood()` | Pure graph model: direct / focused / full views, cluster folding, BFS neighbourhood. |
| `@/graph` `GraphLayout`, `Camera`, `GraphCanvas` | d3-force layout (rAF-batched, settles then freezes; >300 nodes solved off-screen then tweened), pan/zoom camera that writes the viewport transform directly, and the canvas. Node/edge positions are written as attributes, never as React state. |

Deep-link to a package in the graph: `/graph?focus=lodash`.

## Performance and motion policy

- `src/lib/perf.ts` owns the **Reduce animations** state (`<html data-motion="reduced|full">`, `localStorage['ripple.motion']`). Default is reduced when `hardwareConcurrency <= 4`, `deviceMemory <= 4` or the OS asks for reduced motion. The pre-paint bootstrap lives in `public/boot.js`.
- **Always import `useReducedMotion` from `@/lib/perf`, never from `framer-motion`** (it also reflects the app setting and the FPS guard).
- `MotionRoot` sets framer's `reducedMotion="always"` when reduced; `PerfGuard` runs a rAF FPS guard (<40 fps for ~2s -> auto-reduce for the session + one toast) and prewarms lazy route chunks when idle. Set `localStorage['ripple.motion']='full'` to disable the guard while profiling.
- Rules of thumb: no `backdrop-filter` / `filter: blur` / `mix-blend-mode` on anything large or scrolling; ambient loops are transform/opacity only and must pause when hidden/off-screen (`useAmbientActive`); infinite loops are the exception, prefer 2-3 iterations; never update React state per animation frame (CountUp writes textContent, the graph writes attributes).
- `scripts/perf-probe.js`: paste into the console to sample fps / p95 frame time / long tasks for 5 s.

## Security & robustness (web-security pass)

Everything in a scan (package names, descriptions, evidence, scripts, maintainers, URLs) is attacker-influenced.

| Concern | Where / rule |
|---|---|
| Untrusted payloads | `lib/sanitize.ts` `normalizeScan / normalizeHistory / normalizeJob / normalizeHealth` run in `lib/api.ts` (and on the bundled demo). Unknown enums are coerced (severity -> `info`, category -> `suspicious_metadata`), unknown-ecosystem records are dropped with a `warnings` entry, numbers are finite and clamped, arrays/objects always exist, ids are unique. Components can rely on the strict types in `types/scan.ts`. Add new API fields to the normaliser too. |
| No raw HTML | The app has no `dangerouslySetInnerHTML` / `innerHTML` / `eval`. Keep it that way; `RichText` only splits on backticks and renders React text. |
| Links built from data | Use `safeHttpUrl()` (`lib/sanitize.ts`): http(s) only, no credentials; add `rel="noopener noreferrer"` on `target="_blank"`. Internal links must `encodeURIComponent` ids. |
| URL params | Validate against enums with `pickParam()` / a local `pick()`; never cast `params.get()` to a union. |
| Exports | `lib/exporters.ts`: CSV cells starting with `= + - @` (also after whitespace / zero-width chars) get a leading `'`; the HTML report escapes every value and carries a CSP `<meta>`. HTML opened via `blob:` goes through `hardenHtml()` because blob URLs inherit the app origin. Download names go through `safeFilename()`. |
| API client | `lib/api.ts`: every call takes `{ signal }`, has a timeout that covers the body read, distinguishes `aborted` from `unreachable`, maps unparsable JSON to `malformed_response`, never attaches credentials cross-origin, caps server error text. |
| Store | `lib/store.tsx`: newest "open a scan" request wins (`loadSeq`), job polling is sequential, abortable (`resetJob`, unmount), tolerant of 4 transient failures and bounded to 10 min. Do not `await sleep()` in loops without a signal. |
| Uploads | `lib/upload.ts` (24 MB total, 64 files, no empty files, directory drops rejected). Only recognised lockfiles are ever sent; files are never read by the page. |
| Errors | `components/ErrorBoundary.tsx` at the app root and around `<Routes>` (reset on pathname change). It never renders `error.message` or stacks. |
| CSP | `vite.config.ts` `ripple-csp` injects a `<meta http-equiv="Content-Security-Policy">` into the production `index.html` only (dev needs inline React-refresh + HMR). It mirrors the server header `_SPA_CSP`; keep them in sync. No inline scripts: use files in `public/` (see `boot.js`). `index.html` also sets `referrer: no-referrer`. |
| a11y | `useFocusTrap` supports stacked overlays (only the top one handles Tab/Esc), restores focus to a still-connected opener, ref-safe `onClose`. `AppShell` moves focus to `<main>` and sets `document.title` on route change. Error toasts use `role="alert"`. |
