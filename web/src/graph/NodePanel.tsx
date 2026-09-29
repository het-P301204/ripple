import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { ArrowUpRight, X } from 'lucide-react'
import type { Finding, Resolution } from '@/types/scan'
import { useScanIndex } from '@/hooks/useScan'
import { SeverityBadge, SeverityDot } from '@/components/ui/SeverityBadge'
import { EcosystemPill } from '@/components/ui/EcosystemPill'
import { CopyButton } from '@/components/ui/CopyButton'
import { Badge } from '@/components/ui/Badge'
import { SeverityRing } from '@/charts/SeverityRing'
import { EASE } from '@/lib/motion'
import { cn } from '@/lib/cn'
import type { GNode, GraphModel } from './types'

const RESOLUTION: Record<Resolution, string> = {
  exact: 'Exact version', hashed: 'Hash-pinned', range: 'Version range', vcs: 'VCS source', local: 'Local path', unknown: 'Unknown',
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-[12px] text-ink-3">{k}</dt>
      <dd className="min-w-0 text-right text-[12.5px] text-ink-2">{children}</dd>
    </div>
  )
}

function PkgList({
  title, ids, model, onFocus, empty,
}: { title: string; ids: string[]; model: GraphModel; onFocus: (id: string) => void; empty: string }) {
  const [all, setAll] = useState(false)
  const shown = all ? ids : ids.slice(0, 6)
  return (
    <section aria-label={title}>
      <h3 className="flex items-center justify-between text-[12px] font-medium text-ink-2">
        {title} <span className="tnum text-ink-3">{ids.length}</span>
      </h3>
      {ids.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-ink-3">{empty}</p>
      ) : (
        <ul className="mt-1.5 space-y-0.5">
          {shown.map((id) => {
            const n = model.nodes.get(id)
            if (!n) return null
            return (
              <li key={id}>
                <button
                  type="button" onClick={() => onFocus(id)}
                  className="group flex w-full items-center gap-2.5 rounded-r2 px-2 py-1.5 text-left transition-colors duration-micro hover:bg-white/[.06]"
                >
                  <SeverityDot severity={n.severity} />
                  <span className="mono min-w-0 flex-1 truncate text-[12.5px] text-ink group-hover:text-white">{n.name}</span>
                  <span className="mono shrink-0 text-[11px] text-ink-3">{n.version}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {ids.length > 6 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 px-2 text-[12px] font-medium text-accent-soft hover:text-white">
          {all ? 'Show fewer' : `Show all ${ids.length}`}
        </button>
      )}
    </section>
  )
}

/**
 * Right-hand detail panel (bottom sheet on mobile): identity, severity, risk, ecosystem, resolution, top findings,
 * and dependency / dependent lists that re-focus the graph.
 */
export function NodePanel({
  node, model, mobile, onClose, onFocus,
}: { node: GNode; model: GraphModel; mobile: boolean; onClose: () => void; onFocus: (id: string) => void }) {
  const reduced = !!useReducedMotion()
  const { findingsByPackage } = useScanIndex()
  const closeRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pkg = node.pkg
  const findings: Finding[] = useMemo(
    () => [...(findingsByPackage.get(node.id) ?? [])].sort((a, b) => b.risk_score - a.risk_score),
    [findingsByPackage, node.id],
  )
  const deps = model.out.get(node.id) ?? []
  const dependents = model.inn.get(node.id) ?? []
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0 }, [node.id])

  const initial = reduced ? { opacity: 0 } : mobile ? { opacity: 0, y: 36 } : { opacity: 0, x: 28 }
  const exit = reduced ? { opacity: 0 } : mobile ? { opacity: 0, y: 36 } : { opacity: 0, x: 28 }
  const types = [
    node.direct ? 'Direct' : 'Transitive',
    node.dev ? 'Dev' : null,
  ].filter(Boolean) as string[]

  return (
    <motion.aside
      aria-label={`Details for ${node.name}`}
      initial={initial} animate={{ opacity: 1, x: 0, y: 0 }} exit={exit} transition={{ duration: 0.34, ease: EASE }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
      className={cn(
        'pointer-events-auto absolute z-30 flex flex-col overflow-hidden border border-white/[.1] bg-elevated shadow-pop',
        mobile ? 'inset-x-2 bottom-2 max-h-[62%] rounded-r4' : 'bottom-3 right-3 top-3 w-[344px] rounded-r4',
      )}
    >
      {mobile && <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-white/[.16]" />}
      <div className="flex items-start gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <h2 className="mono min-w-0 break-all text-[15px] font-semibold leading-snug tracking-[-0.01em]">{node.name}</h2>
            <CopyButton value={node.name} label="Copy package name" className="shrink-0" />
          </div>
          <p className="mono mt-0.5 text-[12px] text-ink-3">{node.version}</p>
        </div>
        <button
          ref={closeRef} type="button" onClick={onClose} aria-label="Close details"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-r2 text-ink-3 transition-colors duration-micro hover:bg-white/[.07] hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5">
        <div className="flex items-center gap-3.5 rounded-r3 border border-white/[.07] bg-black/20 p-3.5">
          <SeverityRing severity={node.severity} value={node.risk} size={48} stroke={3.5} label={`Risk ${node.risk} of 100`} />
          <div className="min-w-0">
            <SeverityBadge severity={node.severity} />
            <p className="mt-1.5 text-[12px] text-ink-3">Risk <span className="tnum text-ink-2">{node.risk}</span> / 100</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {types.map((t) => <Badge key={t}>{t}</Badge>)}
          {node.internal && <Badge tone="magenta">Internal-looking</Badge>}
          {pkg && pkg.public_status === 'not_found' && <Badge tone="amber">Not on public registry</Badge>}
        </div>

        <dl className="divide-y divide-white/[.05]">
          <Row k="Ecosystem"><EcosystemPill ecosystem={node.eco} /></Row>
          {pkg && <Row k="Resolution">{RESOLUTION[pkg.resolution]}{pkg.spec && pkg.spec !== pkg.version ? <span className="mono ml-1.5 text-ink-3">{pkg.spec}</span> : null}</Row>}
          {pkg && <Row k="Registry"><span className="mono break-all">{pkg.registry}</span></Row>}
          {pkg && <Row k="Declared in"><span className="mono break-all">{pkg.source_file}</span></Row>}
          <Row k="Depth"><span className="tnum">{node.depth}</span></Row>
        </dl>

        <section aria-label="Findings">
          <h3 className="flex items-center justify-between text-[12px] font-medium text-ink-2">
            Findings <span className="tnum text-ink-3">{findings.length}</span>
          </h3>
          {findings.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-ink-3">No exposed package signals detected.</p>
          ) : (
            <ul className="mt-1.5 space-y-0.5">
              {findings.slice(0, 4).map((f) => (
                <li key={f.id}>
                  <Link
                    to={`/findings/${f.id}`}
                    className="group flex items-start gap-2.5 rounded-r2 px-2 py-2 transition-colors duration-micro hover:bg-white/[.06]"
                  >
                    <span className="mt-1.5"><SeverityDot severity={f.severity} /></span>
                    <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink-2 group-hover:text-ink">{f.title}</span>
                    <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-ink-4 group-hover:text-accent-soft" aria-hidden />
                  </Link>
                </li>
              ))}
              {findings.length > 4 && <li className="px-2 pt-1 text-[12px] text-ink-3">and {findings.length - 4} more</li>}
            </ul>
          )}
        </section>

        <PkgList title="Depends on" ids={deps} model={model} onFocus={onFocus} empty="No dependencies resolved." />
        <PkgList title="Required by" ids={dependents} model={model} onFocus={onFocus} empty={node.direct ? 'Declared directly by your project.' : 'No dependents resolved.'} />
      </div>
    </motion.aside>
  )
}
