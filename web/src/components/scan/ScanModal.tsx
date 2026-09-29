import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import {
  ArrowRight, Check, FileUp, FlaskConical, FolderOpen, Circle, Loader2, ShieldCheck, Upload, X,
} from 'lucide-react'
import type { DetectResult, Ecosystem, ScanOptions } from '@/types/scan'
import { api, ApiError } from '@/lib/api'
import { useRipple } from '@/lib/store'
import { CATEGORY_META, ECOSYSTEMS, ECOSYSTEM_META, KNOWN_LOCKFILE_NAMES, detectEcosystemFromName } from '@/lib/meta'
import { cn } from '@/lib/cn'
import { checkUpload, dropHasDirectory } from '@/lib/upload'
import { EASE, tween } from '@/lib/motion'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Switch, Select } from '@/components/ui/Input'
import { EcosystemPill } from '@/components/ui/EcosystemPill'
import { ErrorState } from '@/components/ui/States'
import { ProgressBar, ProgressRing } from '@/components/ui/Progress'
import { CountUp } from '@/components/ui/CountUp'
import { Mono } from '@/components/ui/CopyButton'
import { ScanViz } from './ScanViz'

type Source = 'upload' | 'folder' | 'demo'
const STEPS = ['Source', 'Detection', 'Configuration', 'Scan'] as const
const CHECKS: Array<{ id: string; label: string; blurb: string }> = [
  { id: 'dependency_confusion', label: CATEGORY_META.dependency_confusion.label, blurb: 'Internal names a public registry could shadow' },
  { id: 'typosquatting', label: CATEGORY_META.typosquatting.label, blurb: 'Lookalikes of popular packages' },
  { id: 'suspicious_metadata', label: 'Metadata risk', blurb: 'Install scripts, fresh registrations, maintainer churn' },
  { id: 'registry_exposure', label: CATEGORY_META.registry_exposure.label, blurb: 'http registries, missing hashes, VCS sources' },
]

/** Client-side detection used when /api/detect is unreachable. */
function detectLocally(files: File[]): DetectResult[] {
  return files.map((f) => {
    const d = detectEcosystemFromName(f.name)
    return {
      filename: f.name, ecosystem: d.ecosystem, supported: !!d.ecosystem, kind: d.kind, dependency_count: null,
      error: d.ecosystem ? null : 'Unsupported lockfile',
    }
  })
}

/** Full-screen ripple that travels once across the viewport on completion. */
function RippleBurst({ show }: { show: boolean }) {
  const reduced = useReducedMotion()
  if (!show || reduced) return null
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[95] overflow-hidden">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute left-1/2 top-1/2 rounded-full border"
          style={{ width: 200, height: 200, x: '-50%', y: '-50%', borderColor: i === 1 ? 'rgba(244,114,182,.5)' : 'rgba(167,139,250,.6)' }}
          initial={{ scale: 0.1, opacity: 0.8 }} animate={{ scale: 16, opacity: 0 }}
          transition={{ duration: 1.9, delay: i * 0.16, ease: EASE }}
        />
      ))}
    </div>,
    document.body,
  )
}

export function ScanModal({ open, onClose, startWithDemo }: { open: boolean; onClose: () => void; startWithDemo?: boolean }) {
  const store = useRipple()
  const navigate = useNavigate()
  const reduced = !!useReducedMotion()

  const [step, setStep] = useState(0)
  const [source, setSource] = useState<Source>('upload')
  const [files, setFiles] = useState<File[]>([])
  const [detections, setDetections] = useState<DetectResult[]>([])
  const [detecting, setDetecting] = useState(false)
  const [override, setOverride] = useState<Ecosystem | ''>('')
  const [checks, setChecks] = useState<string[]>(CHECKS.map((c) => c.id))
  const [full, setFull] = useState(true)
  const [live, setLive] = useState(false)
  const [drag, setDrag] = useState(false)
  const [dropRipple, setDropRipple] = useState<{ x: number; y: number; k: number } | null>(null)
  const [burst, setBurst] = useState(false)
  const [finished, setFinished] = useState<{ deps: number; signals: number; score: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const zoneRef = useRef<HTMLDivElement>(null)
  const started = useRef(false)
  const busy = useRef(false)
  const detectSeq = useRef(0)
  const detectAbort = useRef<AbortController | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const supported = useMemo(() => detections.filter((d) => d.supported), [detections])
  const unsupported = useMemo(() => detections.filter((d) => !d.supported), [detections])
  const detectedEcos = useMemo(() => Array.from(new Set(supported.map((d) => d.ecosystem!))), [supported])

  const runDetect = useCallback(async (fs: File[]) => {
    // newest selection wins; an older, slower /detect response can never overwrite it
    detectAbort.current?.abort()
    const ctrl = new AbortController()
    detectAbort.current = ctrl
    const my = ++detectSeq.current
    setDetecting(true)
    try {
      let res: DetectResult[]
      try { res = await api.detect(fs, { signal: ctrl.signal }) } catch (e) {
        if (e instanceof ApiError && e.aborted) return
        if (e instanceof ApiError && !e.unreachable && e.code !== 'malformed_response') throw e
        res = detectLocally(fs)
      }
      if (my === detectSeq.current) setDetections(res)
    } catch { if (my === detectSeq.current) setDetections(detectLocally(fs)) }
    finally { if (my === detectSeq.current) setDetecting(false) }
  }, [])

  // leaving the wizard cancels any in-flight detection
  useEffect(() => () => { detectAbort.current?.abort(); detectSeq.current++ }, [])

  const acceptFiles = useCallback((list: File[], pt?: { x: number; y: number }, opts: { directory?: boolean } = {}) => {
    if (opts.directory) { setNotice('That looks like a folder. Drop the lockfile itself, or choose “Select folder” to pick one from a project.'); return }
    if (!list.length) return
    const { accepted, problems } = checkUpload(list)
    setNotice(problems.length ? problems.slice(0, 3).join(' ') : null)
    if (!accepted.length) { setFiles([]); setDetections([]); return }
    setFiles(accepted)
    setDetections([])
    if (pt) setDropRipple({ x: pt.x, y: pt.y, k: Date.now() })
    void runDetect(accepted)
  }, [runDetect])

  const onFolder = (list: FileList | null) => {
    if (!list) return
    const picked = Array.from(list).filter((f) => KNOWN_LOCKFILE_NAMES.some((n) => n.toLowerCase() === f.name.toLowerCase()) || /^requirements[\w.-]*\.txt$/i.test(f.name))
    // ignore vendored trees
    const clean = picked.filter((f) => !/node_modules|\.venv|vendor|site-packages/.test((f as File & { webkitRelativePath?: string }).webkitRelativePath ?? ''))
    // Never fall back to "upload some other file from the folder": only recognised lockfiles leave the browser.
    if (!clean.length) { setFiles([]); setDetections([]); setNotice('No supported lockfile was found in that folder (vendored directories are skipped).'); return }
    acceptFiles(clean)
  }

  const options = useMemo<Partial<ScanOptions>>(() => ({
    checks: full ? CHECKS.map((c) => c.id) : checks,
    ecosystem: override || null,
    live,
  }), [full, checks, override, live])

  const projectName = useMemo(() => {
    const rel = (files[0] as (File & { webkitRelativePath?: string }) | undefined)?.webkitRelativePath
    return rel ? rel.split('/')[0].slice(0, 80) : undefined
  }, [files])

  const begin = useCallback(async (forceDemo = false) => {
    if (busy.current) return // double-click / Enter-repeat must not start two jobs
    busy.current = true
    started.current = true
    setStep(3); setFinished(null)
    try {
      const s = forceDemo || source === 'demo' ? await store.runDemoScan() : await store.startScan(files, options, projectName)
      if (s) {
        setFinished({ deps: s.summary.total_dependencies, signals: s.summary.total_findings, score: s.summary.risk_score })
        setBurst(true)
        window.setTimeout(() => setBurst(false), 2400)
      }
    } finally { busy.current = false }
  }, [source, store, files, options, projectName])

  // Demo shortcut from NoScanEmptyState / landing
  useEffect(() => {
    if (open && startWithDemo && !started.current) { setSource('demo'); void begin(true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startWithDemo])

  // reset job when modal is dismissed
  useEffect(() => { if (!open) { store.resetJob(); started.current = false } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const next = () => {
    if (step === 0) { if (source === 'demo') void begin(); else setStep(1) }
    else if (step === 1) setStep(2)
    else if (step === 2) void begin()
  }
  const back = () => { if (step === 3) { store.resetJob(); started.current = false; setFinished(null); setStep(source === 'demo' ? 0 : 2) } else setStep((s) => Math.max(0, s - 1)) }

  const canNext =
    step === 0 ? source === 'demo' || (files.length > 0 && !detecting) :
    step === 1 ? supported.length > 0 :
    step === 2 ? full || checks.length > 0 : false

  const toggleCheck = (id: string) => { setFull(false); setChecks((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id])) }
  const toggleFull = () => { if (!full) { setFull(true); setChecks(CHECKS.map((c) => c.id)) } else setFull(false) }

  const job = store.job
  const stages = job?.stages ?? []
  const doneCount = stages.filter((s) => s.state === 'done').length
  const progress = finished ? 1 : job ? Math.max(job.progress, stages.length ? doneCount / stages.length : 0) : 0.02

  return (
    <Modal open={open} onClose={onClose} title="New scan" className="max-w-[720px]" dismissible>
      <RippleBurst show={burst} />
      <div className="flex max-h-[calc(100vh-24px)] flex-col sm:max-h-[calc(100vh-48px)]">
        {/* header + stepper */}
        <div className="border-b border-hair px-6 pb-5 pt-6 sm:px-8">
          <h2 className="text-[19px] font-semibold tracking-[-0.02em]">New scan</h2>
          <ol className="mt-4 flex min-w-0 items-center gap-1.5 sm:gap-2" aria-label="Progress">
            {STEPS.map((s, i) => {
              const state = i < step ? 'done' : i === step ? 'active' : 'todo'
              return (
                <li key={s} className="flex items-center gap-2" aria-current={state === 'active' ? 'step' : undefined}>
                  <span className={cn(
                    'grid h-6 w-6 place-items-center rounded-full border text-[11px] font-semibold transition-colors duration-comp',
                    state === 'done' && 'border-accent/40 bg-accent/20 text-accent-soft',
                    state === 'active' && 'border-accent-soft/70 bg-accent/25 text-white',
                    state === 'todo' && 'border-white/[.1] text-ink-4',
                  )}>
                    {state === 'done' ? <Check size={12} /> : i + 1}
                  </span>
                  <span className={cn('hidden text-[12.5px] sm:inline', state === 'active' ? 'text-ink' : 'text-ink-3')}>{s}</span>
                  {i < STEPS.length - 1 && <span aria-hidden className={cn('mx-0.5 h-px w-4 sm:w-6', i < step ? 'bg-accent/50' : 'bg-white/[.08]')} />}
                </li>
              )
            })}
          </ol>
        </div>

        {/* body */}
        <div className="min-h-[340px] flex-1 overflow-y-auto px-6 py-6 sm:px-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0, transition: tween(0.3) }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
            >
              {step === 0 && (
                <div>
                  <p className="mb-4 text-[13.5px] text-ink-3">Choose what to analyze. Lockfiles are parsed locally; nothing is uploaded anywhere but your own RIPPLE server.</p>
                  <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Scan source">
                    {([
                      ['upload', 'Upload lockfile', FileUp], ['folder', 'Select folder', FolderOpen], ['demo', 'Demo dataset', FlaskConical],
                    ] as const).map(([id, label, Icon]) => (
                      <button
                        key={id} type="button" role="radio" aria-checked={source === id}
                        onClick={() => { setSource(id); if (id !== source) { setFiles([]); setDetections([]); setNotice(null) } }}
                        className={cn(
                          'flex items-center gap-3 rounded-r3 border p-3.5 text-left transition-[border-color,background] duration-comp ease-ripple',
                          source === id ? 'border-accent-soft/50 bg-accent/[.08]' : 'border-white/[.08] bg-white/[.02] hover:border-white/[.16]',
                        )}
                      >
                        <span className={cn('grid h-9 w-9 place-items-center rounded-r2 border', source === id ? 'border-accent/40 bg-accent/15 text-accent-soft' : 'border-white/[.08] text-ink-3')}><Icon size={18} /></span>
                        <span className="text-[13.5px] font-medium">{label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="mt-5">
                    {source === 'demo' ? (
                      <div className="rounded-r3 border border-hair bg-white/[.02] p-5 text-[13.5px] leading-relaxed text-ink-2">
                        <p className="font-medium text-ink">payments-api — synthetic four-ecosystem project</p>
                        <p className="mt-1.5 text-ink-3">npm, PyPI, Go, and Rust lockfiles with a realistic spread of dependency-confusion, typosquatting, metadata, and exposure signals. Runs fully offline.</p>
                      </div>
                    ) : (
                      <div
                        ref={zoneRef}
                        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
                        onDragLeave={() => setDrag(false)}
                        onDrop={(e) => {
                          e.preventDefault(); setDrag(false)
                          const r = zoneRef.current!.getBoundingClientRect()
                          acceptFiles(Array.from(e.dataTransfer.files), { x: e.clientX - r.left, y: e.clientY - r.top }, { directory: dropHasDirectory(e.dataTransfer) })
                        }}
                        className={cn(
                          'relative overflow-hidden rounded-r4 border border-dashed p-8 text-center transition-[border-color,background] duration-comp ease-ripple',
                          drag ? 'border-accent-soft bg-accent/[.09]' : 'border-white/[.14] bg-white/[.02] hover:border-white/[.24] hover:bg-white/[.03]',
                        )}
                      >
                        {dropRipple && !reduced && (
                          <motion.span
                            key={dropRipple.k} aria-hidden
                            className="pointer-events-none absolute rounded-full border border-accent-soft/70 bg-accent/10"
                            style={{ left: dropRipple.x, top: dropRipple.y, width: 60, height: 60, x: '-50%', y: '-50%' }}
                            initial={{ scale: 0.1, opacity: 0.9 }} animate={{ scale: 14, opacity: 0 }} transition={{ duration: 1.1, ease: EASE }}
                          />
                        )}
                        <div className="relative">
                          <div className={cn('mx-auto grid h-12 w-12 place-items-center rounded-r3 border transition-colors', drag ? 'border-accent-soft/60 text-accent-soft' : 'border-white/[.1] text-ink-3')}>
                            <Upload size={20} />
                          </div>
                          <p className="mt-4 text-[14px] font-medium">{source === 'folder' ? 'Choose a project folder' : 'Drop a lockfile here'}</p>
                          <p className="mt-1 text-[12.5px] text-ink-3">
                            {source === 'folder' ? 'RIPPLE picks out known lockfiles and skips node_modules.' : 'package-lock.json · yarn.lock · requirements.txt · Pipfile.lock · pyproject.toml · poetry.lock · uv.lock · go.mod · go.sum · Cargo.lock'}
                          </p>
                          <div className="mt-4 flex justify-center">
                            <Button size="sm" variant="secondary" onClick={() => (source === 'folder' ? folderRef : inputRef).current?.click()}>
                              {source === 'folder' ? 'Select folder' : 'Browse files'}
                            </Button>
                          </div>
                          <input ref={inputRef} type="file" multiple hidden onChange={(e) => acceptFiles(Array.from(e.target.files ?? []))} aria-label="Choose lockfiles" />
                          <input
                            ref={folderRef} type="file" hidden aria-label="Choose folder"
                            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                            onChange={(e) => onFolder(e.target.files)}
                          />
                        </div>
                      </div>
                    )}

                    {notice && source !== 'demo' && (
                      <p role="alert" className="mt-4 rounded-r2 border border-amber/30 bg-amber/[.08] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">{notice}</p>
                    )}
                    {/* detected files */}
                    <AnimatePresence>
                      {source !== 'demo' && files.length > 0 && (
                        <motion.ul initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 space-y-2">
                          {files.map((f, i) => {
                            const d = detections.find((x) => x.filename === f.name)
                            return (
                              <li key={f.name + i} className="flex items-center gap-3 rounded-r2 border border-hair bg-white/[.02] px-3.5 py-2.5 text-[13px]">
                                {!d ? <Loader2 size={15} className="animate-spin text-ink-3" /> : d.supported ? <Check size={15} className="text-ok" /> : <X size={15} className="text-sev-critical" />}
                                <Mono className="text-[13px]">{f.name}</Mono>
                                <span className="ml-auto text-ink-3">
                                  {!d ? 'Detecting…' : d.supported ? <>Detected: <span className="text-ink">{ECOSYSTEM_META[d.ecosystem!].label}</span></> : 'Unsupported'}
                                </span>
                              </li>
                            )
                          })}
                        </motion.ul>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div>
                  <p className="mb-4 text-[13.5px] text-ink-3">RIPPLE identified these ecosystems. Override if a file was misidentified.</p>
                  {supported.length === 0 ? (
                    <ErrorState variant="lockfile" compact />
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2.5">
                        {detectedEcos.map((e) => (
                          <div key={e} className="flex items-center gap-3 rounded-r3 border border-accent/25 bg-accent/[.06] py-2 pl-3 pr-4">
                            <EcosystemPill ecosystem={e} />
                            <span className="text-[12.5px] text-ink-2">
                              {supported.filter((d) => d.ecosystem === e).map((d) => d.kind ?? d.filename).join(', ')}
                            </span>
                            {supported.filter((d) => d.ecosystem === e && d.dependency_count != null).length > 0 && (
                              <span className="tnum text-[12px] text-ink-3">{supported.filter((d) => d.ecosystem === e).reduce((a, d) => a + (d.dependency_count ?? 0), 0)} deps</span>
                            )}
                          </div>
                        ))}
                      </div>
                      {unsupported.length > 0 && (
                        <p className="mt-4 text-[13px] text-ink-3">
                          Skipping unsupported: <Mono>{unsupported.map((u) => u.filename).join(', ')}</Mono>
                        </p>
                      )}
                      <div className="mt-6 max-w-xs">
                        <Select
                          label="Ecosystem override" value={override} onChange={(e) => setOverride(e.target.value as Ecosystem | '')}
                          options={[{ value: '', label: 'Auto-detect' }, ...ECOSYSTEMS.map((e) => ({ value: e, label: ECOSYSTEM_META[e].label }))]}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {step === 2 && (
                <div>
                  <p className="mb-4 text-[13.5px] text-ink-3">Pick what to look for. A full scan runs every check.</p>
                  <div className="space-y-2.5">
                    <CheckRow checked={full} onToggle={toggleFull} label="Full scan" blurb="All four checks. Recommended." strong />
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {CHECKS.map((c) => (
                        <CheckRow key={c.id} checked={full || checks.includes(c.id)} onToggle={() => toggleCheck(c.id)} label={c.label} blurb={c.blurb} />
                      ))}
                    </div>
                  </div>
                  <div className="mt-5 flex items-start gap-4 rounded-r3 border border-hair bg-white/[.02] p-4">
                    <Switch checked={live} onChange={setLive} label="Query live registries (read-only)" />
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium">Query live registries <span className="font-normal text-ink-3">(read-only)</span></p>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
                        Adds real registry metadata: registration dates, downloads, maintainers. RIPPLE only issues GET requests. Off keeps the scan fully local.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {step === 3 && (
                <ExecutePane
                  finished={finished} progress={progress}
                  onRetry={() => void begin(source === 'demo')}
                  onUseDemo={() => { setSource('demo'); void begin(true) }}
                  usingDemo={source === 'demo'}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* footer */}
        <div className="flex items-center justify-between gap-3 border-t border-hair bg-black/20 px-6 py-4 sm:px-8">
          {step === 3 && finished ? (
            <>
              <span className="text-[12.5px] text-ink-3">Saved to scan history</span>
              <Button variant="primary" size="lg" trailing={<ArrowRight size={16} />} onClick={() => { onClose(); navigate('/') }}>View overview</Button>
            </>
          ) : step === 3 ? (
            <>
              <Button variant="ghost" onClick={back} disabled={store.scanning}>Back</Button>
              <span className="text-[12.5px] text-ink-3">{store.scanning ? 'Scanning…' : ''}</span>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={step === 0 ? onClose : back}>{step === 0 ? 'Cancel' : 'Back'}</Button>
              <Button variant="primary" disabled={!canNext} loading={detecting} trailing={<ArrowRight size={16} />} onClick={next}>
                {step === 0 && source === 'demo' ? 'Run demo scan' : step === 2 ? 'Start scan' : 'Continue'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function CheckRow({ checked, onToggle, label, blurb, strong }: { checked: boolean; onToggle: () => void; label: string; blurb: string; strong?: boolean }) {
  return (
    <button
      type="button" role="checkbox" aria-checked={checked} onClick={onToggle}
      className={cn(
        'flex w-full items-start gap-3 rounded-r3 border p-3.5 text-left transition-[border-color,background] duration-comp ease-ripple',
        checked ? 'border-accent-soft/45 bg-accent/[.07]' : 'border-white/[.08] bg-white/[.02] hover:border-white/[.16]',
      )}
    >
      <span className={cn('mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border transition-colors', checked ? 'border-accent-soft bg-accent text-white' : 'border-white/[.2]')}>
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      <span>
        <span className={cn('block text-[13.5px]', strong ? 'font-semibold' : 'font-medium')}>{label}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">{blurb}</span>
      </span>
    </button>
  )
}

function ExecutePane({
  finished, progress, onRetry, onUseDemo, usingDemo,
}: { finished: { deps: number; signals: number; score: number } | null; progress: number; onRetry: () => void; onUseDemo: () => void; usingDemo: boolean }) {
  const { job, scanFailure } = useRipple()
  const stages = job?.stages ?? []

  if (scanFailure) {
    return (
      <ErrorState
        compact variant={scanFailure.variant} detail={scanFailure.detail} onRetry={onRetry}
        secondary={!usingDemo && scanFailure.variant === 'server' ? <Button variant="ghost" onClick={onUseDemo}>Use demo dataset</Button> : undefined}
      />
    )
  }

  return (
    <div>
      <div className="rounded-r4 border border-hair bg-black/25 p-2">
        <ScanViz progress={progress} done={!!finished} className="h-auto w-full" />
      </div>

      {finished ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="mt-5 flex items-center gap-5">
          <ProgressRing value={finished.score / 100} size={72} stroke={5}>
            <span className="text-[22px] font-semibold tracking-[-0.03em]"><CountUp value={finished.score} duration={0.9} /></span>
          </ProgressRing>
          <div>
            <p className="flex items-center gap-2 text-[16px] font-semibold tracking-[-0.01em]"><ShieldCheck size={18} className="text-accent-soft" /> Attack surface mapped</p>
            <p className="mt-1 text-[13.5px] text-ink-3">{finished.deps} dependencies analyzed · {finished.signals} signals identified</p>
          </div>
        </motion.div>
      ) : (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-[12.5px]">
            <span className="text-ink-2">Resolving dependency relationships…</span>
            <span className="tnum text-ink-3">{Math.round(progress * 100)}%</span>
          </div>
          <ProgressBar value={progress} label="Scan progress" />
          <ul className="mt-4 grid gap-x-6 gap-y-1.5 sm:grid-cols-2" aria-live="polite">
            {stages.map((s) => (
              <li key={s.id} className={cn('flex items-center gap-2.5 text-[13px]', s.state === 'pending' ? 'text-ink-4' : s.state === 'active' ? 'text-ink' : 'text-ink-2')}>
                <span className="grid h-4 w-4 shrink-0 place-items-center">
                  {s.state === 'done' ? <Check size={14} className="text-ok" />
                    : s.state === 'active' ? <span className="h-2 w-2 animate-pulse rounded-full bg-accent-soft" />
                    : s.state === 'error' ? <X size={14} className="text-sev-critical" />
                    : <Circle size={9} className="text-ink-4" />}
                </span>
                <span className="truncate">{s.state === 'done' && s.detail ? s.detail : s.label}</span>
              </li>
            ))}
            {stages.length === 0 && <li className="text-[13px] text-ink-3">Preparing scan…</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
