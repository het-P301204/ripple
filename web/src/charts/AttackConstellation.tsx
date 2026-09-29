import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useReducedMotion } from '@/lib/perf'
import type { Category, Ecosystem, Finding, Severity } from '@/types/scan'
import { CATEGORY_META, ECOSYSTEM_META, SEVERITY_ORDER, sevColor } from '@/lib/meta'
import { cn } from '@/lib/cn'
import { EcosystemMark } from '@/components/ui/EcosystemPill'
import { MicroBar } from '@/components/ui/Progress'
import { useMeasure } from './hooks'
import { CATEGORIES, curvePoint, linkPath, type SurfaceData } from './surface'
import './charts.css'

const HUB_H = 68
const GAP = 26
const PAD = 16

export interface ConstellationLink { cat: Category; eco: Ecosystem; count: number; d: string; x: number; y: number }

/** Pure geometry so it can be tested: hubs on the left, ecosystems on the right, one curve per non-empty cell. */
export function layoutConstellation(width: number, data: SurfaceData) {
  const compact = width < 560
  const hubW = compact ? 138 : Math.max(176, Math.min(220, width * 0.28))
  const ecoW = compact ? 78 : 116
  const ecoH = compact ? 64 : 58
  const H = PAD * 2 + CATEGORIES.length * HUB_H + (CATEGORIES.length - 1) * GAP
  const hubY = CATEGORIES.map((_, i) => PAD + HUB_H / 2 + i * (HUB_H + GAP))
  const e = data.ecos.length
  const top = PAD + ecoH / 2
  const bottom = H - PAD - ecoH / 2
  const ecoY = data.ecos.map((_, j) => (e === 1 ? H / 2 : top + (j * (bottom - top)) / (e - 1)))
  const x0 = hubW
  const x1 = width - ecoW
  const links: ConstellationLink[] = []
  CATEGORIES.forEach((cat, i) => {
    data.ecos.forEach((eco, j) => {
      const count = data.cells[cat][eco].length
      if (!count) return
      // chips are staggered along the curve by hub so those sharing an ecosystem do not stack
      const p = curvePoint(x0, hubY[i], x1, ecoY[j], 0.36 + 0.12 * i)
      links.push({ cat, eco, count, d: linkPath(x0, hubY[i], x1, ecoY[j]), x: p.x, y: p.y })
    })
  })
  // nudge any remaining collisions apart vertically (chips are 26 x 22)
  const placed: ConstellationLink[] = []
  for (const l of [...links].sort((a, b) => a.y - b.y)) {
    for (let guard = 0; guard < 8; guard++) {
      const hit = placed.find((o) => Math.abs(o.x - l.x) < 28 && Math.abs(o.y - l.y) < 24)
      if (!hit) break
      l.y = hit.y + 24
    }
    placed.push(l)
  }
  return { compact, hubW, ecoW, ecoH, H, hubY, ecoY, x0, x1, links }
}

/**
 * The exposure map: four category hubs (with counts) joined to the ecosystems they touch. Line weight follows the number of
 * findings in that cell and the count sits on the line. Selecting a hub sends a ripple outward and lights its connections.
 */
export function AttackConstellation({
  data, selectedCat, onSelectCat, finding, burst,
}: {
  data: SurfaceData
  selectedCat: Category | null
  onSelectCat: (c: Category) => void
  finding: Finding | null
  /** increments on every hub / finding selection to replay the ripple */
  burst: number
}) {
  const reduced = !!useReducedMotion()
  const [ref, { width }] = useMeasure<HTMLDivElement>({ width: 720, height: 0 })
  const w = Math.max(320, width || 720)
  const g = useMemo(() => layoutConstellation(w, data), [w, data])
  const selIdx = selectedCat ? CATEGORIES.indexOf(selectedCat) : -1
  const sevOfCat = (c: Category): Severity => data.catWorst[c] ?? 'info'
  const focusCell = finding ? `${finding.category}:${finding.ecosystem}` : null

  return (
    <div ref={ref} className="relative w-full" style={{ height: g.H }}>
      <svg width={w} height={g.H} viewBox={`0 0 ${w} ${g.H}`} className="absolute left-0 top-0" aria-hidden>
        {/* ripple burst from the chosen hub */}
        {!reduced && selIdx >= 0 && (
          <g key={burst}>
            {[0, 1, 2].map((k) => (
              <circle
                key={k} className="as-burst" cx={g.hubW / 2} cy={g.hubY[selIdx]} r={Math.min(190, w * 0.3)} fill="none"
                stroke={data.catTotals[selectedCat!] ? sevColor(sevOfCat(selectedCat!), 0.6) : 'rgba(255,255,255,.2)'} strokeWidth="1"
                style={{ ['--bd' as string]: `${k * 260}ms` }}
              />
            ))}
          </g>
        )}
        {g.links.map((l, i) => {
          const on = selectedCat === l.cat
          const exact = focusCell === `${l.cat}:${l.eco}`
          const dim = selectedCat != null && !on
          const wgt = 1 + 3.4 * (l.count / Math.max(1, data.cellMax))
          const col = exact ? sevColor(finding!.severity, 0.95) : on ? 'rgb(167 139 250 / .8)' : 'rgb(167 139 250 / .34)'
          return (
            <g key={`${l.cat}:${l.eco}`} style={{ opacity: dim ? 0.16 : 1, transition: 'opacity 320ms cubic-bezier(0.22,1,0.36,1)' }}>
              <path d={l.d} fill="none" stroke={col} strokeWidth={wgt} strokeLinecap="round" style={{ transition: 'stroke 320ms cubic-bezier(0.22,1,0.36,1)' }} />
              {/* travelling dots: SMIL loops never pause, so only the selected hub / focused cell gets them (max ~8, usually <=4) */}
              {!reduced && (on || exact) && (
                <circle r={on ? 3 : 2.2} fill="rgb(196 181 253)" opacity="0">
                  <animateMotion dur={`${4.2 + (i % 4) * 0.8}s`} begin={`${(i * 0.7) % 3.5}s`} repeatCount="indefinite" path={l.d} />
                  <animate attributeName="opacity" values="0;.85;.85;0" keyTimes="0;.14;.86;1" dur={`${4.2 + (i % 4) * 0.8}s`} begin={`${(i * 0.7) % 3.5}s`} repeatCount="indefinite" />
                </circle>
              )}
            </g>
          )
        })}
      </svg>

      {/* count chips sit on the connections */}
      {g.links.map((l) => {
        const dim = selectedCat != null && selectedCat !== l.cat
        return (
          <Link
            key={`${l.cat}:${l.eco}`}
            to={`/findings?category=${l.cat}&ecosystem=${l.eco}`}
            aria-label={`${l.count} ${CATEGORY_META[l.cat].label} ${l.count === 1 ? 'finding' : 'findings'} in ${ECOSYSTEM_META[l.eco].label}. Open list`}
            className={cn(
              'tnum absolute z-10 grid h-[22px] min-w-[24px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/[.14] bg-elevated px-1.5 text-[11.5px] font-semibold text-ink transition-[opacity,border-color] duration-comp ease-ripple hover:border-accent-soft/60',
              dim && 'opacity-30',
            )}
            style={{ left: l.x, top: l.y }}
          >
            {l.count}
          </Link>
        )
      })}

      {/* category hubs */}
      {CATEGORIES.map((cat, i) => {
        const n = data.catTotals[cat]
        const on = selectedCat === cat
        const dim = selectedCat != null && !on
        const parts = SEVERITY_ORDER.map((sv) => ({
          value: data.ecos.reduce((a, e) => a + data.cells[cat][e].filter((f) => f.severity === sv).length, 0),
          color: sevColor(sv),
        }))
        return (
          <button
            key={cat} type="button" aria-pressed={on}
            aria-label={`${CATEGORY_META[cat].label}: ${n === 0 ? 'no exposed package signals detected' : `${n} ${n === 1 ? 'finding' : 'findings'}`}. ${on ? 'Selected' : 'Select to trace the attack path'}`}
            onClick={() => onSelectCat(cat)}
            className={cn(
              'absolute z-10 flex flex-col justify-center rounded-r3 border px-3.5 text-left transition-[opacity,border-color,background,transform,box-shadow] duration-comp ease-ripple',
              on ? 'scale-[1.035] border-accent-soft/55 bg-elevated shadow-[0_12px_34px_-16px_rgb(var(--c-accent)/.6)]' : 'border-white/[.09] bg-card hover:border-white/[.2] hover:bg-elevated',
              dim && 'opacity-55', n === 0 && !on && 'border-dashed',
            )}
            style={{ left: 0, top: g.hubY[i] - HUB_H / 2, width: g.hubW, height: HUB_H }}
          >
            <span className="flex items-start justify-between gap-2">
              <span className={cn('text-[12.5px] font-medium leading-tight', n === 0 ? 'text-ink-3' : 'text-ink')}>{g.compact ? CATEGORY_META[cat].short : CATEGORY_META[cat].label}</span>
              <span className={cn('tnum text-[22px] font-semibold leading-none tracking-[-0.03em]', n === 0 && 'text-ink-3')}>{n}</span>
            </span>
            <span className="mt-2.5 block">
              {n > 0 ? <MicroBar parts={parts} height={4} /> : <span className="block h-1 rounded-full bg-white/[.05]" />}
            </span>
          </button>
        )
      })}

      {/* ecosystems */}
      {data.ecos.map((eco, j) => {
        const n = data.ecoTotals[eco]
        const hit = finding?.ecosystem === eco
        return (
          <Link
            key={eco} to={`/ecosystems/${eco}`}
            aria-label={`${ECOSYSTEM_META[eco].label}: ${n} ${n === 1 ? 'finding' : 'findings'}. Open ecosystem`}
            className={cn(
              'absolute z-10 flex items-center justify-center gap-2 rounded-r3 border transition-[border-color,background] duration-comp ease-ripple hover:border-white/[.22] hover:bg-elevated',
              g.compact ? 'flex-col gap-1 px-1' : 'px-3', hit ? 'border-accent-soft/55 bg-elevated' : 'border-white/[.09] bg-card',
            )}
            style={{ left: g.x1, top: g.ecoY[j] - g.ecoH / 2, width: g.ecoW, height: g.ecoH }}
          >
            <EcosystemMark ecosystem={eco} size={g.compact ? 16 : 18} />
            <span className={cn('leading-tight', g.compact ? 'text-center' : '')}>
              <span className="block text-[12.5px] font-medium">{ECOSYSTEM_META[eco].label}</span>
              <span className="tnum block text-[11.5px] text-ink-3">{n}</span>
            </span>
          </Link>
        )
      })}
    </div>
  )
}
