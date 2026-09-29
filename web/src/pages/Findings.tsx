import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Download, FileJson, FileSpreadsheet, FileText, ScanSearch } from 'lucide-react'
import type { Category, Ecosystem, Finding, Severity } from '@/types/scan'
import { useScan, useScanIndex } from '@/hooks/useScan'
import { CATEGORY_META, ECOSYSTEMS, SEVERITY_ORDER } from '@/lib/meta'
import { plural } from '@/lib/format'
import type { ExportFormat } from '@/lib/store'
import { NoScanEmptyState } from '@/components/NoScanEmptyState'
import { useScanModal } from '@/components/scan/ScanModalContext'
import { Button } from '@/components/ui/Button'
import { Dropdown, type MenuItem } from '@/components/ui/Dropdown'
import { SearchInput, Select } from '@/components/ui/Input'
import { Segmented } from '@/components/ui/Segmented'
import { SkeletonCards, Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/States'
import { PageHeader } from '@/components/ui/PageHeader'
import { Kbd } from '@/components/ui/Kbd'
import { EcosystemFilter, SeverityTiles } from '@/components/findings/FindingFilters'
import { FindingListItem } from '@/components/findings/FindingListItem'
import { CATEGORY_TAB } from '@/components/findings/labels'
import { useUrlParams } from '@/components/findings/useUrlParams'

const PAGE = 20
type SortKey = 'risk' | 'confidence' | 'package'
const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'risk', label: 'Sort by risk' },
  { value: 'confidence', label: 'Sort by confidence' },
  { value: 'package', label: 'Sort by package' },
]

const pick = <T extends string>(v: string | null, allowed: readonly T[]): T | null => (v && (allowed as readonly string[]).includes(v) ? (v as T) : null)

export default function Findings() {
  const { scan, loading, exportScan, exporting } = useScan()
  const { sortedFindings } = useScanIndex()
  const { openScan } = useScanModal()
  const url = useUrlParams()
  const searchRef = useRef<HTMLInputElement>(null)
  const [limit, setLimit] = useState(PAGE)

  const severity = pick<Severity>(url.get('severity'), SEVERITY_ORDER)
  const category = pick<Category>(url.get('category'), Object.keys(CATEGORY_META) as Category[])
  const ecosystem = pick<Ecosystem>(url.get('ecosystem'), ECOSYSTEMS)
  const sort = pick<SortKey>(url.get('sort'), ['risk', 'confidence', 'package']) ?? 'risk'
  const q = url.get('q') ?? ''

  // "/" jumps to search, like most list UIs
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // reset "show more" whenever the filter set changes
  const filterKey = `${severity}|${category}|${ecosystem}|${q}|${sort}`
  useEffect(() => setLimit(PAGE), [filterKey])

  const { filtered, sevCounts, catCounts, ecoCounts } = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const sev: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    const cat: Record<Category, number> = { dependency_confusion: 0, typosquatting: 0, suspicious_metadata: 0, registry_exposure: 0 }
    const eco: Partial<Record<Ecosystem, number>> = {}
    const out: Finding[] = []
    for (const f of sortedFindings) {
      const mQ = !needle || `${f.package} ${f.title} ${f.summary} ${f.rule_id} ${CATEGORY_META[f.category].label}`.toLowerCase().includes(needle)
      const mS = !severity || f.severity === severity
      const mC = !category || f.category === category
      const mE = !ecosystem || f.ecosystem === ecosystem
      if (mQ && mC && mE) sev[f.severity]++
      if (mQ && mS && mE) cat[f.category]++
      if (mQ && mS && mC) eco[f.ecosystem] = (eco[f.ecosystem] ?? 0) + 1
      if (mQ && mS && mC && mE) out.push(f)
    }
    if (sort === 'confidence') out.sort((a, b) => b.confidence - a.confidence || b.risk_score - a.risk_score)
    else if (sort === 'package') out.sort((a, b) => a.package.localeCompare(b.package) || b.risk_score - a.risk_score)
    return { filtered: out, sevCounts: sev, catCounts: cat, ecoCounts: eco }
  }, [sortedFindings, severity, category, ecosystem, q, sort])

  const ecosystemsInScan = useMemo(() => ECOSYSTEMS.filter((e) => scan?.ecosystems.some((x) => x.ecosystem === e) || scan?.findings.some((f) => f.ecosystem === e)), [scan])
  const anyInfo = useMemo(() => !!scan?.findings.some((f) => f.severity === 'info'), [scan])

  if (loading && !scan) {
    return (
      <>
        <PageHeader title="Findings" subtitle="Every signal RIPPLE identified, ranked by risk." />
        <SkeletonCards count={5} height={92} className="xl:grid-cols-5" />
        <div className="mt-8 space-y-3" role="status" aria-label="Loading findings">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[148px] w-full rounded-r3" />)}
        </div>
      </>
    )
  }
  if (!scan) {
    return (
      <>
        <PageHeader title="Findings" subtitle="Every signal RIPPLE identified, ranked by risk." />
        <NoScanEmptyState title="No findings yet" description="Run a scan, or load the demo dataset to see how RIPPLE ranks supply-chain signals." />
      </>
    )
  }

  const set = (patch: Record<string, string | null>) => url.set(patch)
  const filtersActive = !!(severity || category || ecosystem || q)
  const clear = () => set({ severity: null, category: null, ecosystem: null, q: null })
  const visible = filtered.slice(0, limit)
  const remaining = filtered.length - visible.length
  const total = scan.findings.length

  const exportItems: MenuItem[] = ([
    ['json', 'JSON', 'Full scan result', <FileJson size={16} key="j" />],
    ['csv', 'CSV', 'One row per finding', <FileSpreadsheet size={16} key="c" />],
    ['sarif', 'SARIF', 'For code-scanning tools', <FileText size={16} key="s" />],
  ] as const).map(([id, label, hint, icon]) => ({ id, label, hint, icon, onSelect: () => void exportScan(id as ExportFormat) }))

  return (
    <>
      <PageHeader
        eyebrow={scan.project}
        title="Findings"
        subtitle={
          total
            ? <>{filtersActive ? <>Showing <span className="tnum text-ink-2">{filtered.length}</span> of {plural(total, 'finding')}</> : <>{plural(total, 'signal')} across {plural(ecosystemsInScan.length, 'ecosystem')}</>}, ranked by {sort === 'risk' ? 'risk' : sort === 'confidence' ? 'detection confidence' : 'package name'}.</>
            : 'Every signal RIPPLE identified, ranked by risk.'
        }
        actions={
          <>
            <Dropdown
              items={exportItems}
              trigger={({ ref, props }) => (
                <Button ref={ref} variant="secondary" loading={!!exporting} leading={<Download size={16} />} {...props}>Export</Button>
              )}
            />
            <Button variant="primary" leading={<ScanSearch size={16} />} onClick={() => openScan()}>Rescan</Button>
          </>
        }
      />

      {total === 0 ? (
        <div className="rounded-r4 border border-hair bg-card shadow-card">
          <EmptyState title="No exposed package signals detected" description="RIPPLE found nothing worth flagging in this scan. Rescan after your next dependency update." />
        </div>
      ) : (
        <>
          <SeverityTiles counts={sevCounts} value={severity} onChange={(v) => set({ severity: v })} showInfo={anyInfo} />

          <div className="mt-8">
            <Segmented<'all' | Category>
              variant="tabs" ariaLabel="Filter by category"
              value={category ?? 'all'} onChange={(v) => set({ category: v === 'all' ? null : v })}
              options={[
                { value: 'all', label: 'All', count: Object.values(catCounts).reduce((a, b) => a + b, 0) },
                ...(Object.keys(CATEGORY_TAB) as Category[]).map((c) => ({ value: c, label: CATEGORY_TAB[c], count: catCounts[c] })),
              ]}
              className="w-full"
            />
          </div>

          <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
            <SearchInput
              ref={searchRef} value={q} onChange={(v) => set({ q: v })} shortcut="/"
              placeholder="Search package, title or rule" aria-label="Search findings" className="lg:max-w-[340px]"
            />
            <EcosystemFilter value={ecosystem} onChange={(e) => set({ ecosystem: e })} ecosystems={ecosystemsInScan} counts={ecoCounts} />
            <div className="w-full sm:w-52 lg:ml-auto">
              <Select
                aria-label="Sort findings" value={sort} options={SORTS}
                onChange={(e) => set({ sort: e.target.value === 'risk' ? null : e.target.value })}
              />
            </div>
          </div>

          <div className="mb-3 mt-6 flex min-h-[28px] flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[12.5px] text-ink-3">
            <p role="status" aria-live="polite">
              {filtered.length === 0 ? 'No matches' : <>Showing <span className="tnum text-ink-2">{visible.length}</span> of {plural(filtered.length, 'finding')}</>}
              {filtersActive && (
                <button type="button" onClick={clear} className="ml-3 rounded-md font-medium text-accent-soft hover:text-white">Clear filters</button>
              )}
            </p>
            <div className="flex items-center gap-4">
              <AnimatePresence>
                {category === 'typosquatting' && (
                  <motion.span initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                    <Link to="/typosquatting" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-soft hover:text-white">
                      View typosquatting map <ArrowRight size={14} aria-hidden />
                    </Link>
                  </motion.span>
                )}
              </AnimatePresence>
              <span className="hidden items-center gap-1.5 md:inline-flex"><Kbd>/</Kbd> search</span>
            </div>
          </div>

          {filtered.length > 0 ? (
            <ul role="list" className="relative space-y-3">
              <AnimatePresence initial mode="popLayout">
                {visible.map((f, i) => <FindingListItem key={f.id} finding={f} index={i % PAGE} />)}
              </AnimatePresence>
            </ul>
          ) : (
            <div className="rounded-r4 border border-hair bg-card shadow-card">
              <EmptyState
                compact title="No findings match these filters"
                description="Try a broader search, or remove a filter to see more signals."
                action={<Button variant="secondary" onClick={clear}>Clear filters</Button>}
              />
            </div>
          )}

          {remaining > 0 && (
            <div className="mt-6 flex justify-center">
              <Button variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>
                Show {Math.min(PAGE, remaining)} more <span className="tnum text-ink-3">· {remaining} remaining</span>
              </Button>
            </div>
          )}
        </>
      )}
    </>
  )
}
