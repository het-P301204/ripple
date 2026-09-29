import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import './settings.css'
import type { Settings, ScanResult, Severity } from '@/types/scan'
import { SEVERITY_META, sevColor } from '@/lib/meta'
import { bandFor } from '@/lib/settings'
import { SeverityDot } from '@/components/ui/SeverityBadge'
import { MicroBar } from '@/components/ui/Progress'
import { cn } from '@/lib/cn'

type Thresholds = Settings['scanner']['thresholds']
type Key = keyof Thresholds
const KEYS: Key[] = ['low', 'medium', 'high', 'critical']   // ascending along the track
const BANDS: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

const glowFor = (k: Key) => `rgb(${SEVERITY_META[k].rgb} / .38)`

/**
 * Four-handle risk-threshold control. Handles can't cross (≥1 point apart). Each is a real
 * `role="slider"` (arrows ±1, Shift+arrows ±5, PageUp/Down ±10, Home/End to the limits).
 * Number fields underneath give exact entry; the preview classifies this scan's findings live.
 */
export function ThresholdControl({
  value, onChange, scan, labelledBy, error,
}: { value: Thresholds; onChange: (t: Thresholds) => void; scan: ScanResult | null; labelledBy: string; error?: string }) {
  const track = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Key | null>(null)

  const bounds = (k: Key): [number, number] => {
    const i = KEYS.indexOf(k)
    const lo = i === 0 ? 0 : value[KEYS[i - 1]] + 1
    const hi = i === KEYS.length - 1 ? 100 : value[KEYS[i + 1]] - 1
    return [lo, hi]
  }
  const set = (k: Key, v: number) => {
    const [lo, hi] = bounds(k)
    const n = Math.round(Math.min(hi, Math.max(lo, v)))
    if (n !== value[k]) onChange({ ...value, [k]: n })
  }

  const fromPointer = (e: PointerEvent) => {
    const r = track.current?.getBoundingClientRect()
    if (!r || !r.width) return null
    return ((e.clientX - r.left) / r.width) * 100
  }
  const onDown = (k: Key) => (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.currentTarget.focus()
    setDrag(k)
  }
  const onMove = (k: Key) => (e: PointerEvent<HTMLDivElement>) => {
    if (drag !== k) return
    const v = fromPointer(e)
    if (v != null) set(k, v)
  }
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    setDrag(null)
  }
  const onKey = (k: Key) => (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 5 : 1
    const [lo, hi] = bounds(k)
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value[k] + step
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value[k] - step
    else if (e.key === 'PageUp') next = value[k] + 10
    else if (e.key === 'PageDown') next = value[k] - 10
    else if (e.key === 'Home') next = lo
    else if (e.key === 'End') next = hi
    if (next == null) return
    e.preventDefault()
    set(k, next)
  }

  // Band segments along the track
  const segs: Array<{ sev: Severity; from: number; to: number }> = [
    { sev: 'info', from: 0, to: value.low },
    { sev: 'low', from: value.low, to: value.medium },
    { sev: 'medium', from: value.medium, to: value.high },
    { sev: 'high', from: value.high, to: value.critical },
    { sev: 'critical', from: value.critical, to: 100 },
  ]

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    scan?.findings.forEach((f) => { c[bandFor(f.risk_score, value)]++ })
    return c
  }, [scan, value])

  return (
    <div>
      {/* track */}
      <div className="px-2.5 pb-1 pt-7">
        <div ref={track} className="relative h-2.5">
          <div className="absolute inset-0 flex gap-[2px] overflow-hidden rounded-full" aria-hidden>
            {segs.map((s) => (
              <div
                key={s.sev}
                className="h-full transition-[flex-grow] duration-micro ease-ripple"
                style={{ flexGrow: Math.max(0.0001, s.to - s.from), flexBasis: 0, background: s.sev === 'info' ? 'rgba(255,255,255,.09)' : sevColor(s.sev, s.sev === 'low' ? 0.55 : 0.75) }}
              />
            ))}
          </div>
          {KEYS.map((k) => {
            const [lo, hi] = bounds(k)
            const m = SEVERITY_META[k]
            return (
              <div
                key={k}
                role="slider" tabIndex={0}
                aria-label={`${m.label} threshold`} aria-orientation="horizontal"
                aria-valuemin={lo} aria-valuemax={hi} aria-valuenow={value[k]}
                aria-valuetext={`${m.label} from score ${value[k]}`}
                data-drag={drag === k}
                className="rp-thumb"
                style={{ left: `${value[k]}%`, ['--thumb-c' as string]: `rgb(${m.rgb})`, ['--thumb-glow' as string]: glowFor(k), zIndex: drag === k ? 3 : 2 }}
                onPointerDown={onDown(k)} onPointerMove={onMove(k)} onPointerUp={onUp} onPointerCancel={onUp}
                onKeyDown={onKey(k)}
              >
                {(drag === k) && (
                  <span aria-hidden className="tnum absolute -top-8 left-1/2 -translate-x-1/2 rounded-md border border-white/[.1] bg-elevated px-1.5 py-0.5 text-[11px] font-semibold text-ink shadow-pop">{value[k]}</span>
                )}
              </div>
            )
          })}
        </div>
        <div className="tnum mt-3 flex justify-between text-[10.5px] text-ink-4" aria-hidden><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
      </div>

      {/* exact entry */}
      <div role="group" aria-labelledby={labelledBy} className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([...KEYS].reverse() as Key[]).map((k) => {
          const m = SEVERITY_META[k]
          const id = `thr-${k}`
          return (
            <div key={k}>
              <label htmlFor={id} className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[.1em]" style={{ color: m.text }}>
                <SeverityDot severity={k} /> {m.label}
              </label>
              <div className="relative">
                <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-ink-4">≥</span>
                <input
                  id={id} type="number" inputMode="numeric" min={bounds(k)[0]} max={bounds(k)[1]} step={1}
                  value={value[k]}
                  onChange={(e) => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) onChange({ ...value, [k]: Math.round(n) }) }}
                  aria-invalid={!!error || undefined}
                  className={cn(
                    'mono h-9 w-full rounded-r1 border bg-white/[.03] pl-6 pr-2 text-[13px] text-ink tnum transition-[border-color,box-shadow] duration-micro ease-ripple',
                    'focus:border-accent-soft/60 focus:shadow-[0_0_0_3px_rgb(var(--c-accent)/.18)] hover:border-white/[.15]',
                    error ? 'border-sev-critical/50' : 'border-white/[.09]',
                  )}
                />
              </div>
            </div>
          )
        })}
      </div>
      {error && <p role="alert" className="mt-2 text-[12px] text-sev-critical">{error}</p>}

      {/* live preview */}
      <div className="mt-5 rounded-r2 border border-white/[.06] bg-black/20 p-4" aria-live="polite">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[12px] font-medium text-ink-2">Live preview</p>
          <p className="text-[11.5px] text-ink-3">
            {scan ? <>Classifying <span className="mono text-ink-2">{scan.project}</span>’s {scan.findings.length} findings</> : 'Load a scan to preview real findings'}
          </p>
        </div>
        {scan ? (
          <>
            <MicroBar height={8} className="mt-3" parts={BANDS.map((b) => ({ value: counts[b], color: b === 'info' ? 'rgba(255,255,255,.18)' : sevColor(b, 0.85) }))} />
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
              {BANDS.map((b) => (
                <li key={b} className="flex items-center gap-1.5 text-[12px] text-ink-3">
                  <SeverityDot severity={b} />
                  {SEVERITY_META[b].label} <span className="tnum font-semibold text-ink">{counts[b]}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
            A score of <span className="tnum text-ink-2">{value.critical}</span> or more is Critical, <span className="tnum text-ink-2">{value.high}</span>–{value.critical - 1} High, <span className="tnum text-ink-2">{value.medium}</span>–{value.high - 1} Medium, <span className="tnum text-ink-2">{value.low}</span>–{value.medium - 1} Low. Anything lower is Info.
          </p>
        )}
      </div>
    </div>
  )
}
