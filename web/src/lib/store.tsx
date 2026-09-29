import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import type { Health, JobStatus, ProgressStage, ScanHistoryEntry, ScanOptions, ScanResult } from '@/types/scan'
import { ApiError, api } from './api'
import { downloadBlob, sleep } from './format'
import { hardenHtml, toCSV, toHTML, toJSON, toSARIF } from './exporters'
import { normalizeScan, safeFilename } from './sanitize'
import { useToast } from '@/components/ui/Toast'
import type { ErrorVariant } from '@/components/ui/States'

const LAST_KEY = 'ripple.lastScan'
const safeGet = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const safeSet = (k: string, v: string | null) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* ignore */ } }

/** Job polling: cadence, tolerated consecutive failures, and a hard ceiling so a wedged job can never poll forever. */
const POLL_MS = 300
const POLL_MAX_FAILS = 4
const POLL_MAX_MS = 10 * 60 * 1000

export type ExportFormat = 'json' | 'sarif' | 'csv' | 'pdf'
export interface ScanFailure { variant: ErrorVariant; detail?: string }
export interface ScanFile { file: File; path?: string }

/** Load the bundled offline demo (lazy chunk). Goes through the same normaliser as API payloads. */
async function loadBundledDemo(): Promise<ScanResult> {
  const mod = await import('@/data/demo-scan.json')
  return { ...normalizeScan(mod.default), mode: 'demo' }
}

const failureFromApi = (e: unknown): ScanFailure => {
  if (e instanceof ApiError) {
    if (e.unreachable) return { variant: 'server' }
    if (e.code === 'unsupported_lockfile') return { variant: 'lockfile' }
    if (e.code === 'registry_unavailable') return { variant: 'registry' }
    return { variant: 'generic', detail: e.message }
  }
  return { variant: 'generic' }
}

const isAbort = (e: unknown) => e instanceof ApiError && e.aborted

/** sleep() that resolves early (false) when the signal aborts, and never leaves a dangling timer. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(false); return }
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(true) }, ms)
    const onAbort = () => { clearTimeout(t); resolve(false) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export interface RippleStore {
  /** currently open scan */
  scan: ScanResult | null
  history: ScanHistoryEntry[]
  health: Health | null
  /** null until first health check completes */
  apiOnline: boolean | null
  /** true when the API is unreachable and the UI is running on the bundled demo */
  offline: boolean
  /** first health + history load finished (LoadingScreen gates on this) */
  ready: boolean
  loading: boolean
  /** live job while scanning (real JobStatus from the API, or a short real-time sequence for demo) */
  job: JobStatus | null
  scanning: boolean
  scanFailure: ScanFailure | null
  exporting: { format: ExportFormat } | null

  loadDemo: () => Promise<ScanResult | null>
  /** Same as loadDemo but drives `job` stages so ScanModal can animate. Resolves with the scan. */
  runDemoScan: () => Promise<ScanResult | null>
  loadScan: (id: string) => Promise<ScanResult | null>
  startScan: (files: File[], options?: Partial<ScanOptions>, project?: string) => Promise<ScanResult | null>
  resetJob: () => void
  clearScan: () => void
  deleteScan: (id: string) => Promise<void>
  exportScan: (format: ExportFormat) => Promise<void>
  refreshHealth: () => Promise<boolean>
  refreshHistory: () => Promise<void>
}

const Ctx = createContext<RippleStore | null>(null)

const DEMO_STAGES: Array<[string, string]> = [
  ['parse', 'Lockfile parsed'],
  ['discover', 'Dependencies discovered'],
  ['variants', 'Generating typosquatting variants'],
  ['registry', 'Resolving registry metadata'],
  ['score', 'Scoring attack surface'],
]

const mkStages = (active: number, details: Record<number, string> = {}): ProgressStage[] =>
  DEMO_STAGES.map(([id, label], i) => ({
    id, label, detail: details[i] ?? '',
    state: i < active ? 'done' : i === active ? 'active' : 'pending',
  }))

/** Open an HTML blob in a new tab. The blob is CSP-hardened first (blob: URLs inherit our origin), and revoked later. */
function openHtmlBlob(html: string) {
  const url = URL.createObjectURL(new Blob([hardenHtml(html)], { type: 'text/html' }))
  window.open(url, '_blank', 'noopener,noreferrer')
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000)
}

export function RippleProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [history, setHistory] = useState<ScanHistoryEntry[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [apiOnline, setApiOnline] = useState<boolean | null>(null)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [job, setJob] = useState<JobStatus | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanFailure, setScanFailure] = useState<ScanFailure | null>(null)
  const [exporting, setExporting] = useState<{ format: ExportFormat } | null>(null)
  const scanRef = useRef<ScanResult | null>(null)
  scanRef.current = scan

  // --- request ordering -------------------------------------------------------------------------------------------
  // `loadSeq`: only the newest "open a scan" request may commit (kills stale-response overwrites, e.g. the boot restore
  //            finishing after the user clicked Demo, or two quick History clicks resolving out of order).
  // `jobSeq`:  the newest scan *job* (real or demo). Bumped by resetJob so a dismissed modal stops polling and can
  //            never write into the next session's job state.
  const loadSeq = useRef(0)
  const loadAbort = useRef<AbortController | null>(null)
  const jobSeq = useRef(0)
  const jobAbort = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const healthSeq = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; loadAbort.current?.abort(); jobAbort.current?.abort() }
  }, [])

  /** Begin a new exclusive "open a scan" operation; supersedes (and aborts) whatever was in flight. */
  const beginLoad = useCallback(() => {
    loadAbort.current?.abort()
    const ctrl = new AbortController()
    loadAbort.current = ctrl
    const my = ++loadSeq.current
    return { my, signal: ctrl.signal, current: () => mounted.current && my === loadSeq.current }
  }, [])

  /** Invalidate any in-flight "open a scan" request (a newer result is about to be committed). */
  const supersedeLoads = useCallback(() => { ++loadSeq.current; loadAbort.current?.abort(); setLoading(false) }, [])

  const refreshHealth = useCallback(async () => {
    const my = ++healthSeq.current
    try {
      const h = await api.health()
      if (my === healthSeq.current && mounted.current) { setHealth((p) => (p && JSON.stringify(p) === JSON.stringify(h) ? p : h)); setApiOnline(true) }
      return true
    } catch (e) {
      if (isAbort(e)) return false
      if (my === healthSeq.current && mounted.current) { setHealth(null); setApiOnline(false) }
      return false
    }
  }, [])

  const refreshHistory = useCallback(async () => {
    try {
      const h = await api.scans()
      if (mounted.current) setHistory(h)
    } catch { /* offline: keep whatever we have */ }
  }, [])

  const commit = useCallback((s: ScanResult) => {
    setScan(s)
    safeSet(LAST_KEY, s.id)
  }, [])

  const loadDemo = useCallback(async () => {
    const L = beginLoad()
    setLoading(true)
    try {
      let s: ScanResult
      try { s = await api.demo({ signal: L.signal }) } catch (e) {
        if (isAbort(e)) return null
        if (e instanceof ApiError && !e.unreachable && e.code !== 'malformed_response') throw e
        s = await loadBundledDemo()
      }
      if (!L.current()) return null
      commit(s)
      void refreshHistory()
      return s
    } catch (e) {
      if (L.current()) toast.error('Couldn’t load the demo dataset', e instanceof ApiError ? e.message : undefined)
      return null
    } finally { if (L.current()) setLoading(false) }
  }, [beginLoad, commit, refreshHistory, toast])

  const loadScan = useCallback(async (id: string) => {
    const L = beginLoad()
    setLoading(true)
    try {
      const s = await api.scan(id, { signal: L.signal })
      if (!L.current()) return null
      commit(s)
      return s
    } catch (e) {
      if (isAbort(e) || !L.current()) return null
      if (id.startsWith('demo')) { // bundled demo id, API offline
        try {
          const s = await loadBundledDemo()
          if (!L.current()) return null
          commit(s); return s
        } catch { /* fall through to the generic failure path */ }
      }
      safeSet(LAST_KEY, null)
      if (!(e instanceof ApiError && e.unreachable)) toast.error('Couldn’t open that scan', e instanceof ApiError ? e.message : undefined)
      return null
    } finally { if (L.current()) setLoading(false) }
  }, [beginLoad, commit, toast])

  /** Start a new exclusive job; supersedes whatever job was running (its polling loop sees `cur()` go false). */
  const beginJob = useCallback(() => {
    jobAbort.current?.abort()
    const ctrl = new AbortController()
    jobAbort.current = ctrl
    const my = ++jobSeq.current
    return { my, signal: ctrl.signal, cur: () => mounted.current && my === jobSeq.current }
  }, [])

  const runDemoScan = useCallback(async () => {
    const J = beginJob()
    setScanFailure(null); setScanning(true)
    const jid = `demo-${Date.now()}`
    const push = (active: number, progress: number, details: Record<number, string> = {}) => {
      if (J.cur()) setJob({ job_id: jid, status: 'running', progress, stages: mkStages(active, details), scan_id: null, error: null, error_code: null })
    }
    push(0, 0.04)
    // kick off the real load immediately; animate stages while it resolves (no fake long timers)
    const box: { scan: ScanResult | null; err: unknown } = { scan: null, err: null }
    const loadP = (async () => {
      try {
        try { box.scan = await api.demo({ signal: J.signal }) } catch (e) {
          if (isAbort(e)) throw e
          if (e instanceof ApiError && !e.unreachable && e.code !== 'malformed_response') throw e
          box.scan = await loadBundledDemo()
        }
      } catch (e) { box.err = e }
    })()
    const total = 5
    for (let i = 0; i < total - 1; i++) {
      if (!(await abortableSleep(i === 0 ? 260 : 340, J.signal))) break
      const n = box.scan ? box.scan.summary.total_dependencies : undefined
      push(i + 1, (i + 1) / total, n && i >= 0 ? { 1: `${n} dependencies discovered` } : {})
    }
    await loadP
    if (!J.cur()) return null // dismissed / superseded: leave the new session's state alone
    if (box.err || !box.scan) {
      const f = failureFromApi(box.err)
      setScanFailure(f); setScanning(false)
      setJob((j) => (j ? { ...j, status: 'error', error: f.detail ?? f.variant, error_code: null } : j))
      return null
    }
    const s = box.scan
    setJob({
      job_id: jid, status: 'done', progress: 1, scan_id: s.id, error: null, error_code: null,
      stages: DEMO_STAGES.map(([id, label], i) => ({ id, label, state: 'done' as const, detail: i === 1 ? `${s.summary.total_dependencies} dependencies discovered` : '' })),
    })
    supersedeLoads() // a finished job outranks any older in-flight "open scan" request
    commit(s); void refreshHistory(); setScanning(false)
    return s
  }, [beginJob, commit, refreshHistory, supersedeLoads])

  const startScan = useCallback(async (files: File[], options: Partial<ScanOptions> = {}, project?: string) => {
    const J = beginJob()
    setScanFailure(null); setScanning(true); setJob(null)
    try {
      const { job_id } = await api.createScan(files, options, project, { signal: J.signal })
      let status: JobStatus | null = null
      const t0 = Date.now()
      let fails = 0
      // Poll the real JobStatus every ~300ms. Sequential (never overlapping), abortable, tolerant of a few blips,
      // and bounded: it stops on unmount / resetJob / a newer job, and after POLL_MAX_MS.
      while (J.cur()) {
        try {
          const st = await api.job(job_id, { signal: J.signal })
          fails = 0
          if (!J.cur()) return null
          status = st
          setJob(st)
          if (st.status === 'done' || st.status === 'error') break
        } catch (e) {
          if (isAbort(e) || !J.cur()) return null
          // 404/4xx = the job is gone for good; network blips and 5xx get a few retries with backoff
          const fatal = e instanceof ApiError && e.status >= 400 && e.status < 500
          if (fatal || ++fails > POLL_MAX_FAILS) throw e
        }
        if (Date.now() - t0 > POLL_MAX_MS) throw new ApiError('The scan is taking too long. Try again with fewer files.', { code: 'timeout' })
        if (!(await abortableSleep(POLL_MS * (1 + fails * 2), J.signal))) return null
      }
      if (!J.cur() || !status) return null
      if (status.status === 'error') {
        const variant: ErrorVariant =
          status.error_code === 'unsupported_lockfile' || status.error_code === 'parse_error' ? 'lockfile'
            : status.error_code === 'registry_unavailable' ? 'registry' : 'generic'
        setScanFailure({ variant, detail: variant === 'generic' ? status.error?.slice(0, 240) ?? undefined : undefined })
        return null
      }
      if (!status.scan_id) throw new ApiError('The scan finished without a result.', { code: 'malformed_response' })
      const s = await api.scan(status.scan_id, { signal: J.signal })
      if (!J.cur()) return null
      supersedeLoads()
      commit(s); void refreshHistory()
      return s
    } catch (e) {
      if (isAbort(e) || !J.cur()) return null
      setScanFailure(failureFromApi(e))
      if (e instanceof ApiError && e.unreachable) setApiOnline(false)
      return null
    } finally { if (J.cur()) setScanning(false) }
  }, [beginJob, commit, refreshHistory, supersedeLoads])

  /** Dismiss the current job: aborts polling / in-flight requests and clears the transient state. */
  const resetJob = useCallback(() => {
    jobAbort.current?.abort()
    ++jobSeq.current
    setJob(null); setScanFailure(null); setScanning(false)
  }, [])
  const clearScan = useCallback(() => { supersedeLoads(); setScan(null); safeSet(LAST_KEY, null) }, [supersedeLoads])

  const deleteScan = useCallback(async (id: string) => {
    try {
      await api.deleteScan(id)
      setHistory((h) => h.filter((x) => x.id !== id))
      if (scanRef.current?.id === id) clearScan()
      if (safeGet(LAST_KEY) === id) safeSet(LAST_KEY, null)
      toast.success('Scan removed')
    } catch (e) { toast.error('Couldn’t remove that scan', e instanceof ApiError ? e.message : undefined) }
  }, [clearScan, toast])

  const exportScan = useCallback(async (format: ExportFormat) => {
    const s = scanRef.current
    if (!s) { toast.info('Nothing to export yet', 'Load the demo dataset or run a scan first.'); return }
    setExporting({ format })
    const stamp = safeFilename(s.project.replace(/[^\w.-]+/g, '-'), 'scan')
    try {
      if (format === 'pdf') {
        // "PDF-ready" = open the printable HTML report in a new tab
        let opened = false
        if (apiOnline !== false) {
          try {
            const { blob } = await api.exportBlob(s.id, 'html')
            openHtmlBlob(await blob.text())
            opened = true
          } catch { /* fall through to client-side */ }
        }
        if (!opened) openHtmlBlob(toHTML(s))
        toast.success('Report opened', 'Use your browser’s Print → Save as PDF.')
        return
      }
      let done = false
      if (apiOnline !== false) {
        try {
          const { blob, filename } = await api.exportBlob(s.id, format)
          downloadBlob(blob, filename, blob.type)
          done = true
        } catch { /* fall back */ }
      }
      if (!done) {
        await sleep(280)
        const map = {
          json: [toJSON(s), 'application/json', 'json'],
          csv: [toCSV(s), 'text/csv', 'csv'],
          sarif: [toSARIF(s), 'application/sarif+json', 'sarif'],
        } as const
        const [data, type, ext] = map[format]
        downloadBlob(data, `ripple-${stamp}.${ext}`, type)
      }
      toast.success(`${format.toUpperCase()} exported`, `${s.summary.total_findings} findings from ${s.project}.`)
    } catch (e) {
      toast.error('Export failed', e instanceof ApiError ? e.message : undefined)
    } finally { if (mounted.current) setExporting(null) }
  }, [apiOnline, toast])

  // Boot: health + history + last viewed scan. Health re-checked every 20s (skipped while the tab is hidden).
  useEffect(() => {
    const L = beginLoad()
    ;(async () => {
      const online = await refreshHealth()
      if (online) await refreshHistory()
      const last = safeGet(LAST_KEY)
      if (last && L.current()) {
        try { const s = await api.scan(last, { signal: L.signal }); if (L.current()) setScan(s) }
        catch (e) {
          if (isAbort(e)) return
          if (last.startsWith('demo')) { try { const s = await loadBundledDemo(); if (L.current()) setScan(s) } catch { /* noop */ } } else safeSet(LAST_KEY, null)
        }
      }
      if (mounted.current) setReady(true)
    })()
    const t = window.setInterval(() => { if (!document.hidden) void refreshHealth() }, 20000)
    return () => { window.clearInterval(t) }
  }, [beginLoad, refreshHealth, refreshHistory])

  const value = useMemo<RippleStore>(() => ({
    scan, history, health, apiOnline, offline: apiOnline === false, ready, loading, job, scanning, scanFailure, exporting,
    loadDemo, runDemoScan, loadScan, startScan, resetJob, clearScan, deleteScan, exportScan, refreshHealth, refreshHistory,
  }), [scan, history, health, apiOnline, ready, loading, job, scanning, scanFailure, exporting, loadDemo, runDemoScan, loadScan, startScan, resetJob, clearScan, deleteScan, exportScan, refreshHealth, refreshHistory])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRipple(): RippleStore {
  const c = useContext(Ctx)
  if (!c) throw new Error('useRipple must be used inside <RippleProvider>')
  return c
}
