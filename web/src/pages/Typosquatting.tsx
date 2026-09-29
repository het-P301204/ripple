import { useCallback, useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { ScanResult } from '@/types/scan'
import { useScan } from '@/hooks/useScan'
import { SEVERITY_META } from '@/lib/meta'
import { plural } from '@/lib/format'
import { NoScanEmptyState } from '@/components/NoScanEmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, StateGlyph } from '@/components/ui/States'
import { Skeleton } from '@/components/ui/Skeleton'
import { SeverityBadge } from '@/components/ui/SeverityBadge'
import { LookalikeDetail } from '@/charts/LookalikeDetail'
import { LookalikeSelector } from '@/charts/LookalikeSelector'
import { LookalikeTable } from '@/charts/LookalikeTable'
import { LookalikeTree } from '@/charts/LookalikeTree'
import { bySuspicion, sortGroups, worstSeverity } from '@/charts/lookalike'

const HEADER = {
  eyebrow: 'Typosquatting',
  title: 'Typosquatting',
  subtitle: 'Lookalike names one keystroke from popular packages.',
}

export default function Typosquatting() {
  const { scan, loading } = useScan()
  if (!scan) {
    return (
      <>
        <PageHeader {...HEADER} />
        {loading ? (
          <div className="grid gap-6 lg:grid-cols-[264px_1fr]" role="status" aria-label="Loading lookalikes">
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-r3" />)}</div>
            <Skeleton className="h-[460px] rounded-r5" />
          </div>
        ) : <NoScanEmptyState description="Load a scan to compare its package names against the popular packages they could be mistaken for." />}
      </>
    )
  }
  return <LookalikeView scan={scan} />
}

function LookalikeView({ scan }: { scan: ScanResult }) {
  const { pkg } = useParams<{ pkg: string }>()
  const [params, setParams] = useSearchParams()
  const groups = useMemo(() => sortGroups(scan.lookalikes), [scan.lookalikes])

  const eco = params.get('eco')
  const wanted = pkg ?? null
  const idx = wanted ? groups.findIndex((g) => g.original === wanted && (!eco || g.ecosystem === eco)) : 0
  const group = idx >= 0 ? groups[idx] : null

  const ordered = useMemo(() => (group ? bySuspicion(group.candidates) : []), [group])
  const cParam = params.get('c')
  const selectedName = group && ordered.some((c) => c.name === cParam) ? cParam : ordered[0]?.name ?? null
  const selected = ordered.find((c) => c.name === selectedName) ?? null

  const select = useCallback((name: string) => {
    const next = new URLSearchParams(params)
    next.set('c', name)
    setParams(next, { replace: true, preventScrollReset: true })
  }, [params, setParams])

  const registered = groups.reduce((a, g) => a + g.candidates.filter((c) => c.registered).length, 0)
  const total = groups.reduce((a, g) => a + g.candidates.length, 0)

  if (groups.length === 0) {
    return (
      <>
        <PageHeader {...HEADER} />
        <EmptyState
          glyph={<StateGlyph />} title="No lookalike names detected"
          description="None of the package names in this scan sit close enough to a popular package to be mistaken for it."
          action={<Link to="/findings" className="text-[13.5px] font-medium text-accent-soft hover:text-white">Review all findings</Link>}
        />
      </>
    )
  }

  // finding + graph presence of the selected lookalike (only when it is actually in the lockfile)
  const finding = group && selected ? scan.findings.find((f) => f.category === 'typosquatting' && f.package === selected.name && f.ecosystem === group.ecosystem) : undefined
  const inGraph = !!(group && selected && scan.packages.some((p) => p.name === selected.name && p.ecosystem === group.ecosystem))

  return (
    <>
      <PageHeader
        {...HEADER}
        meta={
          <>
            <span>{plural(groups.length, 'original package', 'original packages')}</span>
            <span>{plural(total, 'lookalike')}</span>
            <span>{registered} registered</span>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[264px_minmax(0,1fr)] lg:gap-8">
        <aside className="min-w-0"><LookalikeSelector groups={groups} activeIndex={idx} /></aside>

        <div className="min-w-0 space-y-6">
          {!group ? (
            <EmptyState
              compact glyph={<StateGlyph size={72} />} title={`No lookalike group for “${wanted}”`}
              description="That package has no tracked lookalikes in this scan. Choose one from the list."
              action={<Link to={`/typosquatting/${encodeURIComponent(groups[0].original)}`} className="text-[13.5px] font-medium text-accent-soft hover:text-white">Open {groups[0].original}</Link>}
            />
          ) : (
            <>
              <section aria-label={`Lookalikes of ${group.original}`} className="relative overflow-hidden rounded-r5 border border-white/[.08] bg-card shadow-card">
                <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(45% 60% at 50% 50%, rgb(var(--c-accent) / .08), transparent 72%)' }} />
                <div className="relative flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-5 md:px-6">
                  <div>
                    <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Lookalikes of <span className="mono">{group.original}</span></h2>
                    <p className="mt-1 text-[13px] text-ink-3">
                      {plural(group.candidates.length, 'candidate')} · {group.candidates.filter((c) => c.registered).length} registered on {group.ecosystem === 'pypi' ? 'PyPI' : group.ecosystem === 'npm' ? 'npm' : group.ecosystem === 'go' ? 'the Go proxy' : 'crates.io'}
                    </p>
                  </div>
                  <span className="flex items-center gap-2 text-[12px] text-ink-3">Worst <SeverityBadge severity={worstSeverity(group.candidates)} label={SEVERITY_META[worstSeverity(group.candidates)].label} size="sm" /></span>
                </div>
                {group.candidates.length === 0 ? (
                  <p className="relative px-6 py-16 text-center text-[14px] text-ink-3">No lookalike names found for <span className="mono">{group.original}</span>.</p>
                ) : (
                  <div className="relative"><LookalikeTree key={`${group.ecosystem}:${group.original}`} group={group} selected={selectedName} onSelect={select} /></div>
                )}
              </section>

              {selected && (
                <LookalikeDetail group={group} candidate={selected} scanAt={scan.created_at} findingId={finding?.id ?? null} inGraph={inGraph} />
              )}
              {group.candidates.length > 0 && <LookalikeTable group={group} selected={selectedName} onSelect={select} />}
            </>
          )}
        </div>
      </div>
    </>
  )
}
