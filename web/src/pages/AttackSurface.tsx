import { useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import type { Category, Finding, ScanResult } from '@/types/scan'
import { useScan, useScanIndex } from '@/hooks/useScan'
import { CATEGORY_META } from '@/lib/meta'
import { plural } from '@/lib/format'
import { NoScanEmptyState } from '@/components/NoScanEmptyState'
import { PageHeader, Section } from '@/components/ui/PageHeader'
import { EmptyState, StateGlyph } from '@/components/ui/States'
import { Skeleton } from '@/components/ui/Skeleton'
import { AttackConstellation } from '@/charts/AttackConstellation'
import { AttackPath } from '@/charts/AttackPath'
import { ExposedList } from '@/charts/ExposedList'
import { SurfaceMatrix } from '@/charts/SurfaceMatrix'
import { CATEGORIES, buildSurface, topFindings } from '@/charts/surface'

const HEADER = {
  eyebrow: 'Attack surface',
  title: 'Attack Surface',
  subtitle: 'Where exposure exists, and how it would reach your build.',
}

export default function AttackSurface() {
  const { scan, loading } = useScan()
  if (!scan) {
    return (
      <>
        <PageHeader {...HEADER} />
        {loading ? (
          <div className="grid gap-6 xl:grid-cols-[1fr_340px]" role="status" aria-label="Mapping the attack surface">
            <Skeleton className="h-[440px] rounded-r5" /><Skeleton className="h-[440px] rounded-r5" />
          </div>
        ) : <NoScanEmptyState description="Load a scan to see where exposure concentrates across categories and ecosystems." />}
      </>
    )
  }
  return <SurfaceView scan={scan} />
}

function SurfaceView({ scan }: { scan: ScanResult }) {
  const { findingById, packageById } = useScanIndex()
  const [params, setParams] = useSearchParams()
  const burst = useRef(0)
  const data = useMemo(() => buildSurface(scan), [scan])

  const catParam = params.get('category') as Category | null
  const finding = params.get('finding') ? findingById.get(params.get('finding')!) ?? null : null
  const selCat: Category | null = finding ? finding.category : catParam && CATEGORIES.includes(catParam) ? catParam : null
  const inCat = useMemo(() => (selCat ? topFindings(scan, selCat) : []), [scan, selCat])
  const shownFinding: Finding | null = finding ?? inCat[0] ?? null
  const all = useMemo(() => topFindings(scan), [scan])

  const setSel = useCallback((cat: Category | null, findingId: string | null) => {
    const next = new URLSearchParams(params)
    if (cat) next.set('category', cat); else next.delete('category')
    if (findingId) next.set('finding', findingId); else next.delete('finding')
    burst.current += 1
    setParams(next, { replace: true, preventScrollReset: true })
  }, [params, setParams])

  if (data.total === 0) {
    return (
      <>
        <PageHeader {...HEADER} />
        <EmptyState
          glyph={<StateGlyph />} title="No exposed package signals detected"
          description="RIPPLE found no dependency confusion, typosquatting, suspicious metadata or registry exposure in this scan."
        />
      </>
    )
  }

  const worstCrit = scan.summary.severity_counts.critical
  return (
    <>
      <PageHeader
        {...HEADER}
        meta={
          <>
            <span>{plural(data.total, 'signal')}</span>
            <span>{plural(data.ecos.length, 'ecosystem')}</span>
            {worstCrit > 0 && <span>{worstCrit} critical</span>}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Exposure map" className="relative overflow-hidden rounded-r5 border border-white/[.08] bg-card shadow-card">
          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(50% 60% at 30% 40%, rgb(var(--c-accent) / .07), transparent 72%)' }} />
          <div className="relative px-5 pt-5 md:px-6">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Exposure map</h2>
            <p className="mt-1 text-[13px] text-ink-3">Categories on the left, the ecosystems they reach on the right. Select a category to trace how it would reach your build.</p>
          </div>
          <div className="relative px-5 pb-6 pt-5 md:px-6">
            <AttackConstellation
              data={data} selectedCat={selCat} finding={shownFinding && selCat ? shownFinding : null} burst={burst.current}
              onSelectCat={(c) => (selCat === c && !finding ? setSel(null, null) : setSel(c, null))}
            />
          </div>
          <AnimatePresence initial={false}>
            {selCat && (
              <AttackPath
                key="path" category={selCat} finding={shownFinding} scan={scan}
                pkg={shownFinding ? packageById.get(shownFinding.package_id) : undefined}
                extra={Math.max(0, inCat.length - 1)}
                onClear={() => setSel(null, null)}
              />
            )}
          </AnimatePresence>
        </section>

        <aside aria-label="Most exposed packages" className="overflow-hidden rounded-r5 border border-white/[.08] bg-card shadow-card">
          <ExposedList
            findings={selCat ? inCat : all} total={selCat ? inCat.length : all.length} category={selCat}
            selectedId={shownFinding && selCat ? shownFinding.id : null}
            onSelect={(f) => setSel(f.category, f.id)}
          />
        </aside>
      </div>

      <Section className="mt-12" title="By ecosystem" description="How many signals each registry contributes to each category. Select a cell to open those findings.">
        <SurfaceMatrix data={data} />
      </Section>
      <p className="sr-only">{CATEGORIES.map((c) => `${CATEGORY_META[c].label}: ${data.catTotals[c]}`).join('. ')}</p>
    </>
  )
}
