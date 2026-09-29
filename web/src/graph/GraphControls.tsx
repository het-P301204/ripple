import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, Maximize2, Minus, Plus, RotateCcw, Search, X } from 'lucide-react'
import type { Ecosystem, Severity } from '@/types/scan'
import { ECOSYSTEM_META, SEVERITY_META } from '@/lib/meta'
import { cn } from '@/lib/cn'
import { EcosystemMark } from '@/components/ui/EcosystemPill'
import { Segmented } from '@/components/ui/Segmented'
import { SeverityDot } from '@/components/ui/SeverityBadge'
import { shapePath } from './nodeShape'
import type { GraphModel, ViewMode } from './types'

/* ---------------------------------------------------------------------------------------------- */

/** Package search: type to find, arrows to move, Enter to focus (highlights, centres and dims the rest). */
export function GraphSearch({ model, onPick }: { model: GraphModel; onPick: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(0)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    const hits: Array<{ id: string; score: number }> = []
    model.nodes.forEach((n) => {
      const name = n.name.toLowerCase()
      const at = name.indexOf(s)
      if (at < 0) return
      hits.push({ id: n.id, score: (at === 0 ? 0 : 100) + (name.length - s.length) * 0.2 - n.risk * 0.3 })
    })
    return hits.sort((a, b) => a.score - b.score).slice(0, 8).map((h) => model.nodes.get(h.id)!)
  }, [q, model])

  useEffect(() => { setIdx(0) }, [q])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); inputRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pick = (id: string) => { onPick(id); setQ(''); setOpen(false); inputRef.current?.blur() }

  return (
    <div className="relative w-[min(300px,calc(100vw-72px))]">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setIdx((i) => Math.min(results.length - 1, i + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
            else if (e.key === 'Enter' && results[idx]) { e.preventDefault(); pick(results[idx].id) }
            else if (e.key === 'Escape') { if (q) setQ(''); else inputRef.current?.blur(); setOpen(false) }
          }}
          role="combobox"
          aria-expanded={open && q.trim().length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results[idx] ? `${listId}-${idx}` : undefined}
          aria-label="Find a package in the graph"
          placeholder="Find a package…"
          className="h-10 w-full rounded-r2 border border-white/[.1] bg-elevated pl-9 pr-9 text-[13px] text-ink shadow-card transition-[border-color,box-shadow] duration-micro ease-ripple placeholder:text-ink-4 hover:border-white/[.16] focus:border-accent-soft/60 focus:shadow-[0_0_0_3px_rgb(var(--c-accent)/.18)]"
        />
        {q ? (
          <button type="button" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={() => setQ('')} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:bg-white/[.06] hover:text-ink">
            <X size={14} />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-white/[.08] px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3 sm:block">/</kbd>
        )}
      </div>
      {open && q.trim() && (
        <ul id={listId} role="listbox" aria-label="Matching packages" className="absolute left-0 right-0 top-[46px] z-30 max-h-72 overflow-y-auto rounded-r3 border border-white/[.1] bg-elevated p-1.5 shadow-pop">
          {results.length === 0 && <li className="px-3 py-3 text-[12.5px] text-ink-3">No package named “{q.trim()}” in this scan.</li>}
          {results.map((n, i) => (
            <li
              key={n.id} id={`${listId}-${i}`} role="option" aria-selected={i === idx}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(n.id)} onMouseEnter={() => setIdx(i)}
              className={cn('flex cursor-pointer items-center gap-2.5 rounded-r2 px-2.5 py-2', i === idx && 'bg-white/[.06]')}
            >
              <SeverityDot severity={n.severity} />
              <span className="mono min-w-0 flex-1 truncate text-[12.5px] text-ink">{n.name}</span>
              <span className="mono text-[11px] text-ink-3">{n.version}</span>
              <EcosystemMark ecosystem={n.eco} size={13} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------------------------------- */

const SEVS: Severity[] = ['critical', 'high', 'medium', 'low']

function Chip({ pressed, onClick, children, label }: { pressed: boolean; onClick: () => void; children: React.ReactNode; label: string }) {
  return (
    <button
      type="button" aria-pressed={pressed} aria-label={label} onClick={onClick}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[12px] font-medium transition-[background,border-color,color] duration-micro ease-ripple',
        pressed ? 'border-accent-soft/45 bg-accent/[.14] text-ink' : 'border-white/[.09] bg-elevated text-ink-3 hover:border-white/[.16] hover:text-ink-2',
      )}
    >
      {children}
    </button>
  )
}

/** Severity + ecosystem filter chips (multi-select). */
export function GraphFilters({
  model, severities, ecosystems, onSeverity, onEcosystem,
}: {
  model: GraphModel
  severities: Set<Severity>
  ecosystems: Set<Ecosystem>
  onSeverity: (s: Severity) => void
  onEcosystem: (e: Ecosystem) => void
}) {
  const counts = useMemo(() => {
    const c: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    model.nodes.forEach((n) => { c[n.severity] += 1 })
    return c
  }, [model])
  return (
    <div className="flex max-w-full flex-wrap items-center gap-1.5" role="group" aria-label="Graph filters">
      {SEVS.map((s) => (
        <Chip key={s} pressed={severities.has(s)} onClick={() => onSeverity(s)} label={`${SEVERITY_META[s].label} severity, ${counts[s]} packages`}>
          <SeverityDot severity={s} /> {SEVERITY_META[s].label} <span className="tnum text-[11px] text-ink-3">{counts[s]}</span>
        </Chip>
      ))}
      <span aria-hidden className="mx-0.5 hidden h-4 w-px bg-white/[.1] sm:block" />
      {model.ecos.map((e) => (
        <Chip key={e} pressed={ecosystems.has(e)} onClick={() => onEcosystem(e)} label={`${ECOSYSTEM_META[e].label} packages, ${model.ecoCounts[e]}`}>
          <EcosystemMark ecosystem={e} size={13} /> {ECOSYSTEM_META[e].label}
        </Chip>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------------------------------------- */

function IconBtn({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className="grid h-8 w-8 place-items-center rounded-r2 text-ink-2 transition-colors duration-micro hover:bg-white/[.07] hover:text-ink disabled:opacity-40"
    >
      {children}
    </button>
  )
}

export type DepthValue = 1 | 2 | 3 | 99

/** Floating toolbar: detail mode, depth (when a package is focused), zoom, reset. */
export function GraphToolbar({
  mode, onMode, depth, onDepth, hasSelection, onZoomIn, onZoomOut, onFit, dirty, onReset, legendOpen, onLegend,
}: {
  mode: ViewMode
  onMode: (m: ViewMode) => void
  depth: DepthValue
  onDepth: (d: DepthValue) => void
  hasSelection: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  dirty: boolean
  onReset: () => void
  legendOpen: boolean
  onLegend: () => void
}) {
  return (
    <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2">
      <div className="flex max-w-full flex-wrap items-center gap-1.5 rounded-r3 border border-white/[.1] bg-elevated p-1.5 shadow-pop" role="toolbar" aria-label="Graph controls">
        <Segmented<ViewMode>
          size="sm" ariaLabel="Graph detail"
          options={[{ value: 'direct', label: 'Direct' }, { value: 'focused', label: 'Focused' }, { value: 'full', label: 'Full' }]}
          value={mode} onChange={onMode}
        />
        {hasSelection && (
          <>
            <span aria-hidden className="h-5 w-px bg-white/[.1]" />
            <span className="pl-1 text-[11.5px] text-ink-3">Depth</span>
            <Segmented<`${DepthValue}`>
              size="sm" ariaLabel="Neighbourhood depth"
              options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '99', label: 'All' }]}
              value={`${depth}`} onChange={(v) => onDepth(Number(v) as DepthValue)}
            />
          </>
        )}
        <span aria-hidden className="h-5 w-px bg-white/[.1]" />
        <IconBtn label="Zoom out" onClick={onZoomOut}><Minus size={16} /></IconBtn>
        <IconBtn label="Zoom in" onClick={onZoomIn}><Plus size={16} /></IconBtn>
        <IconBtn label="Fit graph to view" onClick={onFit}><Maximize2 size={15} /></IconBtn>
        {dirty && <IconBtn label="Reset view, filters and selection" onClick={onReset}><RotateCcw size={15} /></IconBtn>}
      </div>
      <button
        type="button" aria-expanded={legendOpen} onClick={onLegend}
        className="inline-flex h-11 items-center gap-1.5 rounded-r3 border border-white/[.1] bg-elevated px-3.5 text-[12.5px] font-medium text-ink-2 shadow-pop transition-colors duration-micro hover:text-ink"
      >
        Legend <ChevronDown size={14} className={cn('transition-transform duration-comp ease-ripple', legendOpen && 'rotate-180')} aria-hidden />
      </button>
    </div>
  )
}

/* ---------------------------------------------------------------------------------------------- */

const LEG_STROKE = 'rgba(236,237,240,.55)'

function Swatch({ children }: { children: React.ReactNode }) {
  return <svg width="20" height="20" viewBox="-10 -10 20 20" aria-hidden className="shrink-0">{children}</svg>
}

/** Compact legend: shape = ecosystem, ring colour = severity, outline = package type. */
export function GraphLegend() {
  const shapeEcos: Ecosystem[] = ['npm', 'pypi', 'go', 'rust']
  return (
    <div className="pointer-events-auto w-[min(420px,100%)] rounded-r3 border border-white/[.1] bg-elevated p-4 shadow-pop" role="region" aria-label="Graph legend">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-[11.5px] text-ink-2">
        <div>
          <p className="eyebrow mb-2 !text-[10px]">Ecosystem · shape</p>
          <ul className="space-y-1.5">
            {shapeEcos.map((e) => (
              <li key={e} className="flex items-center gap-2">
                <Swatch><path d={shapePath(e, 6)} fill="rgb(var(--c-card))" stroke={LEG_STROKE} strokeWidth="1.2" strokeLinejoin="round" /></Swatch>
                {ECOSYSTEM_META[e].label}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow mb-2 !text-[10px]">Severity · ring colour</p>
          <ul className="space-y-1.5">
            {(['critical', 'high', 'medium', 'low'] as Severity[]).map((s) => (
              <li key={s} className="flex items-center gap-2">
                <Swatch><circle r="6" fill={`rgb(${SEVERITY_META[s].rgb} / .17)`} stroke={`rgb(${SEVERITY_META[s].rgb})`} strokeWidth="1.5" /></Swatch>
                {SEVERITY_META[s].label}
              </li>
            ))}
            <li className="flex items-center gap-2"><Swatch><circle r="6" fill="rgb(var(--c-card))" stroke="rgba(236,237,240,.32)" strokeWidth="1.1" /></Swatch>No signals</li>
          </ul>
        </div>
        <div className="col-span-2">
          <p className="eyebrow mb-2 !text-[10px]">Package type · outline</p>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            <li className="flex items-center gap-2"><Swatch><circle r="6" fill="rgb(var(--c-elevated))" stroke="rgba(236,237,240,.7)" strokeWidth="1.6" /></Swatch>Direct</li>
            <li className="flex items-center gap-2"><Swatch><circle r="6" fill="rgb(var(--c-card))" stroke="rgba(236,237,240,.32)" strokeWidth="1.1" /></Swatch>Transitive</li>
            <li className="flex items-center gap-2"><Swatch><circle r="6" fill="rgb(var(--c-card))" stroke={LEG_STROKE} strokeWidth="1.1" strokeDasharray="2.4 2" /></Swatch>Dev only</li>
            <li className="flex items-center gap-2"><Swatch><circle r="4.2" fill="rgb(var(--c-card))" stroke={LEG_STROKE} strokeWidth="1.1" /><circle r="7.6" fill="none" stroke="rgb(var(--c-magenta-soft) / .65)" strokeWidth="1" /></Swatch>Internal-looking</li>
            <li className="col-span-2 flex items-center gap-2"><Swatch><circle r="7" fill="rgb(var(--c-elevated))" stroke={LEG_STROKE} strokeWidth="1.2" strokeDasharray="2.6 2.2" /></Swatch>Cluster of low-risk transitive packages. Click to expand.</li>
          </ul>
        </div>
      </div>
      <p className="mt-3 border-t border-white/[.06] pt-3 text-[11px] leading-relaxed text-ink-3">Node size grows with dependents and risk. Lines point from a package to what it depends on.</p>
    </div>
  )
}

