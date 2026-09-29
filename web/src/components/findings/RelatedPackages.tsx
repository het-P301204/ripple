import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Type } from 'lucide-react'
import type { Finding, Package } from '@/types/scan'
import { useScan, useScanIndex } from '@/hooks/useScan'
import { SeverityDot } from '@/components/ui/SeverityBadge'
import { LinkButton } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

const LIMIT = 6

function PkgLink({ p }: { p: Package }) {
  const to = p.finding_ids[0] ? `/findings/${encodeURIComponent(p.finding_ids[0])}` : `/packages?q=${encodeURIComponent(p.name)}`
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-r2 border border-transparent px-3 py-2.5 transition-colors duration-micro hover:border-white/[.07] hover:bg-white/[.03]"
    >
      <SeverityDot severity={p.severity} className="h-2 w-2" />
      <span className="mono min-w-0 flex-1 truncate text-[13px] text-ink">{p.name}</span>
      <span className="mono text-[12px] text-ink-3">{p.version}</span>
      <ArrowUpRight size={14} className="text-ink-4 transition-colors group-hover:text-accent-soft" aria-hidden />
    </Link>
  )
}

function Column({ title, items, total, unnamed, empty }: { title: string; items: Package[]; total: number; unnamed?: number; empty: string }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-ink-2">
        {title} <span className="tnum rounded-full bg-white/[.05] px-2 py-0.5 text-[11px] text-ink-3">{total}</span>
      </h3>
      {items.length ? (
        <ul role="list" className="-mx-1">
          {items.slice(0, LIMIT).map((p) => <li key={p.id}><PkgLink p={p} /></li>)}
          {total > LIMIT && <li className="px-3 pt-1.5 text-[12px] text-ink-3">+{total - LIMIT} more</li>}
        </ul>
      ) : (
        <p className="rounded-r2 border border-dashed border-white/[.08] px-3 py-3 text-[12.5px] text-ink-3">
          {unnamed ? `${unnamed} package${unnamed === 1 ? '' : 's'} depend on this.` : empty}
        </p>
      )}
    </div>
  )
}

/** Dependencies / dependents of the flagged package, plus the lookalike link for typosquats. */
export function RelatedPackages({ finding: f, className }: { finding: Finding; className?: string }) {
  const { scan } = useScan()
  const { packageById } = useScanIndex()
  const pkg = packageById.get(f.package_id)

  const { deps, dependents } = useMemo(() => {
    if (!pkg || !scan) return { deps: [] as Package[], dependents: [] as Package[] }
    const deps = pkg.dependencies.map((id) => packageById.get(id)).filter((x): x is Package => !!x)
    const ids = new Set<string>()
    scan.packages.forEach((p) => { if (p.dependencies.includes(pkg.id)) ids.add(p.id) })
    scan.edges.forEach((e) => { if (e.target === pkg.id) ids.add(e.source) })
    const dependents = [...ids].map((id) => packageById.get(id)).filter((x): x is Package => !!x)
    return { deps, dependents }
  }, [pkg, scan, packageById])

  const original = f.related_package
  // the lookalike map is keyed by the popular (original) package; either side of a pair can carry the finding
  const groups = scan?.lookalikes ?? []
  const mapKey =
    groups.find((g) => g.original === f.package)?.original ??
    groups.find((g) => g.original === original)?.original ??
    groups.find((g) => g.candidates.some((c) => c.name === f.package))?.original ??
    original ?? f.package

  return (
    <div className={cn('space-y-5', className)}>
      {f.category === 'typosquatting' && (
        <div className="flex flex-col gap-4 rounded-r3 border border-accent/20 bg-accent/[.05] p-4 sm:flex-row sm:items-center">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-r2 border border-accent/25 bg-accent/10 text-accent-soft"><Type size={17} aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium text-ink">Lookalike analysis</p>
            <p className="mt-0.5 text-[12.5px] text-ink-3">
              {original
                ? <>Compare <span className="mono text-ink-2">{f.package}</span> with <span className="mono text-ink-2">{original}</span> and the other names one keystroke away.</>
                : 'See every lookalike of this name and how each mutation was derived.'}
            </p>
          </div>
          <LinkButton to={`/typosquatting/${encodeURIComponent(mapKey)}`} variant="secondary" size="sm" trailing={<ArrowUpRight size={14} />}>
            View typosquatting map
          </LinkButton>
        </div>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <Column title="Depends on" items={deps} total={deps.length || pkg?.dependencies.length || 0} empty="No dependencies recorded for this package." />
        <Column
          title="Depended on by" items={dependents} total={dependents.length || pkg?.dependents_count || 0}
          unnamed={dependents.length ? 0 : pkg?.dependents_count} empty="Nothing else in this scan depends on it."
        />
      </div>
      <Link to={`/packages?q=${encodeURIComponent(f.package)}`} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-soft hover:text-white">
        Open in package explorer <ArrowUpRight size={14} aria-hidden />
      </Link>
    </div>
  )
}
