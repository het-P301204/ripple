import type {
  DetectResult, Health, JobStatus, ScanHistoryEntry, ScanOptions, ScanResult, Settings,
} from '@/types/scan'
import { normalizeDetect, normalizeHealth, normalizeHistory, normalizeJob, normalizeScan, safeFilename } from './sanitize'

/** Typed error thrown by every api.* call. `unreachable` = network failure / proxy 5xx with no JSON body. */
export class ApiError extends Error {
  code: string
  status: number
  unreachable: boolean
  /** true when the caller cancelled the request (AbortSignal) - never treat this as "server down". */
  aborted: boolean
  constructor(message: string, opts: { code?: string; status?: number; unreachable?: boolean; aborted?: boolean } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = opts.code ?? 'internal'
    this.status = opts.status ?? 0
    this.unreachable = !!opts.unreachable
    this.aborted = !!opts.aborted
  }
}

const BASE = '/api'
/** Server-supplied error text is shown in toasts / ErrorState detail; keep it short and single-purpose. */
const MAX_ERR = 240

interface ReqInit extends RequestInit {
  timeoutMs?: number
  /** how to read the body. `blob` keeps the timeout armed until the whole body has arrived. */
  as?: 'json' | 'blob'
}

async function request<T>(path: string, init: ReqInit = {}): Promise<T> {
  const { timeoutMs = 15000, as = 'json', signal: outer, ...rest } = init
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctrl.abort() }, timeoutMs)
  const onOuterAbort = () => ctrl.abort()
  if (outer) { if (outer.aborted) ctrl.abort(); else outer.addEventListener('abort', onOuterAbort, { once: true }) }
  const cancelled = () => new ApiError('Request cancelled.', { code: 'aborted', aborted: true })
  const unreachable = () => new ApiError('RIPPLE server is not reachable.', { code: 'unreachable', unreachable: true })
  try {
    let res: Response
    try {
      // same-origin only: never sends credentials cross-origin, no cache, no referrer.
      res = await fetch(BASE + path, { ...rest, signal: ctrl.signal, credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer' })
    } catch {
      throw outer?.aborted && !timedOut ? cancelled() : unreachable()
    }
    if (!res.ok) {
      let code = 'internal'
      let message = `Request failed (${res.status})`
      let jsonBody = false
      try {
        const body = await res.json()
        jsonBody = true
        if (body && typeof body === 'object' && body.error && typeof body.error === 'object') {
          if (typeof body.error.code === 'string') code = body.error.code.slice(0, 64)
          if (typeof body.error.message === 'string') message = body.error.message.slice(0, MAX_ERR)
        }
      } catch { /* not json */ }
      // Vite's proxy returns a bare 500/502/504 (no JSON) when nothing listens on :8787
      const down = !jsonBody && res.status >= 500
      throw new ApiError(down ? 'RIPPLE server is not reachable.' : message, { code: down ? 'unreachable' : code, status: res.status, unreachable: down })
    }
    try {
      if (as === 'blob') return { res, blob: await res.blob() } as unknown as T
      if (res.status === 204) return undefined as T
      const ct = res.headers.get('content-type') ?? ''
      // SPA fallback HTML means the API isn't mounted
      if (!ct.includes('json')) throw unreachable()
      return (await res.json()) as T
    } catch (e) {
      if (e instanceof ApiError) throw e
      if (outer?.aborted && !timedOut) throw cancelled()
      if (timedOut) throw unreachable()
      // body was not valid JSON / was truncated: a server bug, not an outage
      throw new ApiError('RIPPLE server returned an unreadable response.', { code: 'malformed_response', status: res.status })
    }
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuterAbort)
  }
}

/** Wrap a normaliser so payloads that are not even objects surface as ApiError('malformed_response'). */
function shaped<T>(fn: (raw: unknown) => T) {
  return (raw: unknown): T => {
    try { return fn(raw) } catch {
      throw new ApiError('RIPPLE server returned an unexpected response.', { code: 'malformed_response' })
    }
  }
}
const asScan = shaped(normalizeScan)
const asJob = shaped(normalizeJob)
const asHistory = shaped(normalizeHistory)
const asDetect = shaped(normalizeDetect)
const asHealth = shaped(normalizeHealth)

const json = (body: unknown): RequestInit => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

type Sig = { signal?: AbortSignal }
export type ExportKind = 'json' | 'sarif' | 'csv' | 'html'

export const api = {
  health: (o: Sig = {}) => request<unknown>('/health', { timeoutMs: 1500, ...o }).then(asHealth) as Promise<Health>,
  demo: (o: Sig = {}) => request<unknown>('/demo', { timeoutMs: 30000, ...o }).then(asScan) as Promise<ScanResult>,
  detect: (files: File[], o: Sig = {}) => {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f, f.name))
    return request<unknown>('/detect', { method: 'POST', body: fd, timeoutMs: 20000, ...o }).then(asDetect) as Promise<DetectResult[]>
  },
  createScan: (files: File[], options: Partial<ScanOptions>, project?: string, o: Sig = {}) => {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f, f.name))
    fd.append('options', JSON.stringify(options))
    if (project) fd.append('project', project)
    return request<{ job_id: string }>('/scans', { method: 'POST', body: fd, timeoutMs: 30000, ...o }).then((r) => {
      if (!r || typeof r.job_id !== 'string' || !r.job_id) throw new ApiError('RIPPLE server returned an unexpected response.', { code: 'malformed_response' })
      return { job_id: r.job_id }
    })
  },
  job: (id: string, o: Sig = {}) => request<unknown>(`/jobs/${encodeURIComponent(id)}`, { timeoutMs: 8000, ...o }).then(asJob) as Promise<JobStatus>,
  scans: (o: Sig = {}) => request<unknown>('/scans', { timeoutMs: 5000, ...o }).then(asHistory) as Promise<ScanHistoryEntry[]>,
  scan: (id: string, o: Sig = {}) => request<unknown>(`/scans/${encodeURIComponent(id)}`, { timeoutMs: 20000, ...o }).then(asScan) as Promise<ScanResult>,
  deleteScan: (id: string, o: Sig = {}) => request<void>(`/scans/${encodeURIComponent(id)}`, { method: 'DELETE', ...o }),
  exportUrl: (id: string, format: ExportKind) =>
    `${BASE}/scans/${encodeURIComponent(id)}/export?format=${format}`,
  exportBlob: async (id: string, format: ExportKind, o: Sig = {}) => {
    const { res, blob } = await request<{ res: Response; blob: Blob }>(`/scans/${encodeURIComponent(id)}/export?format=${format}`, { as: 'blob', timeoutMs: 60000, ...o })
    const cd = res.headers.get('content-disposition') ?? ''
    const m = /filename="?([^";]+)"?/i.exec(cd)
    return { blob, filename: safeFilename(m?.[1], `ripple-${safeFilename(id, 'scan')}.${format}`) }
  },
  settings: (o: Sig = {}) => request<Settings>('/settings', { timeoutMs: 5000, ...o }),
  saveSettings: (s: Settings, o: Sig = {}) => request<Settings>('/settings', { method: 'PUT', ...json(s), ...o }),
}

export type Api = typeof api
