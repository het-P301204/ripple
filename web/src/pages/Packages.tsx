import { Fragment, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { ArrowDown, ArrowUp, ChevronRight, PackageOpen } from 'lucide-react'
import type { Ecosystem, Package, Severity } from '@/types/scan'
import { useScan, useScanIndex } from '@/hooks/useScan'
import { ECOSYSTEMS, ECOSYSTEM_META, SEVERITY_META, SEVERITY_ORDER } from '@/lib/meta'
import { plural } from '@/lib/format'
import { cn } from '@/lib/cn'
import { tween } from '@/lib/motion'
import { NoScanEmptyState } from '@/components/NoScanEmptyState'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { EcosystemPill } from '@/components/ui/EcosystemPill'
import { SearchInput, Select } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import { Segmented } from '@/components/ui/Segmented'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/States'
import { Table, Td, Th, THead, Tr } from '@/components/ui/Table'
import { EcosystemFilter } from '@/components/findings/FindingFilters'
import { useUrlParams } from '@/components/findings/useUrlParams'
import { PackageDetail } from '@/components/packages/PackageDetail'
import { Pagination } from '@/components/packages/Pagination'
import { RangeSlider } from '@/components/packages/RangeSlider'
import { RiskCell, SignalCell, StatusPill } from '@/components/packages/PackageSignals'

const PAGE_SIZE = 25
type SortKey = 'package' | 'version' | 'ecosystem' | 'registry' | 'risk' | 'confusion' | 'typosquat' | 'metadata' | 'status'
type Dir = 'asc' | 'desc'
const SORT_KEYS: SortKey[] = ['package', 'version', 'ecosystem', 'registry', 'risk', 'confusion', 'typosquat', 'metadata', 'status']
const DESC_FIRST: SortKey[] = ['risk', 'confusion', 'typosquat', 'metadata', 'status']
const defaultDir = (k: SortKey): Dir => (DESC_FIRST.includes(k) ? 'desc' : 'asc')
const STATUS_RANK = { flagged: 2, unverified: 1, clean: 0 } as const
const COLS = 10

const host = (p: Package) => (p.registry || '').replace(/^https?:\/\//, '').split('/')[0]
const insecure = (p: Package) => (p.registry_source ?? p.registry ?? '').startsWith('http://')

function compare(a: Package, b: Package, k: SortKey): number {
  switch (k) {
    case 'package': return a.name.localeCompare(b.name)
    case 'version': return a.version.localeCompare(b.version, undefined, { numeric: true })
    case 'ecosystem': return ECOSYSTEM_META[a.ecosystem].label.localeCompare(ECOSYSTEM_META[b.ecosystem].label)
    case 'registry': return host(a).localeCompare(host(b))
    case 'risk': return a.risk_score - b.risk_score
    case 'confusion': return Number(a.confusion) - Number(b.confusion)
    case 'typosquat': return Number(a.typosquat) - Number(b.typosquat)
    case 'metadata': return Number(a.metadata_flag) - Number(b.metadata_flag)
    case 'status': return STATUS_RANK[a.status] - STATUS_RANK[b.status]
  }
}

const pick = <T extends string>(v: string | null, allowed: readonly T[]): T | null => (v && (allowed as readonly string[]).includes(v) ? (v as T) : null)

const MOBILE_SORTS: Array<{ value: string; label: string }> = [
  { value: 'risk:desc', label: 'Highest risk first' },
  { value: 'risk:asc', label: 'Lowest risk first' },
  { value: 'package:asc', label: 'Name A to Z' },
  { value: 'package:desc', label: 'Name Z to A' },
  { value: 'ecosystem:asc', label: 'Ecosystem' },
  { value: 'status:desc', label: 'Flagged first' },
]

function SortTh({ k, label, className, align, sortKey, dir, onSort }: {
  k: SortKey; label: string; className?: string; align?: 'left' | 'center' | 'right'; sortKey: SortKey; dir: Dir; onSort: (k: SortKey) => void
}) {
  const active = sortKey === k
  return (
    <Th align={align} className={className} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button" onClick={() => onSort(k)} aria-label={`Sort by ${label}`}
        className={cn('inline-flex items-center gap-1 rounded-md py-1 uppercase tracking-[.09em] transition-colors duration-micro hover:text-ink', active && 'text-ink')}
      >
        {label}
        {active ? (dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />) : <ArrowDown size={12} aria-hidden className="opacity-0" />}
      </button>
    </Th>
  )
}

export default function Packages() {
  const { scan, loading } = useScan()
  const { findingsByPackage, packageById } = useScanIndex()
  const url = useUrlParams()
  const reduced = !!useReducedMotion()
  const [range, setRange] = useState<[number, number]>([0, 100])
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  const q = url.get('q') ?? ''
  const eco = pick<Ecosystem>(url.get('ecosystem'), ECOSYSTEMS)
  const sev = pick<Severity>(url.get('severity'), SEVERITY_ORDER)
  const sortKey = pick<SortKey>(url.get('sort'), SORT_KEYS) ?? 'risk'
  const dir: Dir = pick<Dir>(url.get('dir'), ['asc', 'desc']) ?? defaultDir(sortKey)

  const filterKey = `${q}|${eco}|${sev}|${sortKey}|${dir}|${range[0]}-${range[1]}`
  useEffect(() => setPage(1), [filterKey])

  const dependentsOf = useMemo(() => {
    const m = new Map<string, string[]>()
    scan?.packages.forEach((p) => p.dependencies.forEach((d) => {
      const arr = m.get(d)
      if (arr) arr.push(p.name)
      else m.set(d, [p.name])
    }))
    return m
  }, [scan])

  const filtered = useMemo(() => {
    if (!scan) return []
    const needle = q.trim().toLowerCase()
    const out = scan.packages.filter((p) =>
      (!eco || p.ecosystem === eco) &&
      (!sev || p.severity === sev) &&
      p.risk_score >= range[0] && p.risk_score <= range[1] &&
      (!needle || `${p.name} ${p.version} ${host(p)} ${ECOSYSTEM_META[p.ecosystem].label}`.toLowerCase().includes(needle)),
    )
    const sign = dir === 'asc' ? 1 : -1
    return out.sort((a, b) => sign * compare(a, b, sortKey) || b.risk_score - a.risk_score || a.name.localeCompare(b.name))
  }, [scan, q, eco, sev, range, sortKey, dir])

  const ecosystemsInScan = useMemo(() => ECOSYSTEMS.filter((e) => scan?.packages.some((p) => p.ecosystem === e)), [scan])

  if (!scan) {
    return (
      <>
        <PageHeader title="Packages" subtitle="Every dependency RIPPLE resolved, with its registry, risk and detector signals." />
        {loading ? (
          <div className="overflow-hidden rounded-r3 border border-hair bg-card shadow-card"><SkeletonRows rows={10} /></div>
        ) : (
          <NoScanEmptyState title="No packages to explore" description="Load a scan to browse its dependency inventory." />
        )}
      </>
    )
  }

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const cur = Math.min(page, pages)
  const rows = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE)
  const filtersActive = !!(q || eco || sev || range[0] > 0 || range[1] < 100)
  const clear = () => { url.set({ q: null, ecosystem: null, severity: null }); setRange([0, 100]) }
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const setSort = (k: SortKey, d: Dir) => url.set({ sort: k === 'risk' && d === 'desc' ? null : k, dir: k === 'risk' && d === 'desc' ? null : d })
  const onSort = (k: SortKey) => setSort(k, k === sortKey ? (dir === 'asc' ? 'desc' : 'asc') : defaultDir(k))

  return (
    <>
      <PageHeader
        eyebrow={scan.project}
        title="Packages"
        subtitle={
          filtersActive
            ? <>Showing <span className="tnum text-ink-2">{filtered.length}</span> of {plural(scan.packages.length, 'package')}.</>
            : <>{plural(scan.packages.length, 'package')} across {plural(ecosystemsInScan.length, 'ecosystem')}, with registry, risk and detector signals for each.</>
        }
      />

      {/* filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchInput value={q} onChange={(v) => url.set({ q: v })} placeholder="Search packages" aria-label="Search packages" className="lg:max-w-[340px]" />
        <EcosystemFilter value={eco} onChange={(e) => url.set({ ecosystem: e })} ecosystems={ecosystemsInScan} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-4">
        <Segmented<'all' | Severity>
          size="sm" ariaLabel="Filter by severity" value={sev ?? 'all'} onChange={(v) => url.set({ severity: v === 'all' ? null : v })}
          options={[{ value: 'all', label: 'All' }, ...SEVERITY_ORDER.map((s) => ({ value: s, label: SEVERITY_META[s].label }))]}
        />
        <div className="flex min-w-[260px] items-center gap-3">
          <span className="shrink-0 text-[12.5px] text-ink-3">Risk</span>
          <RangeSlider value={range} onChange={setRange} labelMin="Minimum risk score" labelMax="Maximum risk score" className="w-44 sm:w-52" />
          <span className="tnum w-[68px] shrink-0 text-[12.5px] text-ink-2" aria-live="polite">{range[0]} – {range[1]}</span>
        </div>
        <div className="w-full sm:w-52 md:hidden">
          <Select
            aria-label="Sort packages" value={`${sortKey}:${dir}`}
            options={MOBILE_SORTS.some((o) => o.value === `${sortKey}:${dir}`) ? MOBILE_SORTS : [...MOBILE_SORTS, { value: `${sortKey}:${dir}`, label: `Sorted by ${sortKey}` }]}
            onChange={(e) => { const [k, d] = e.target.value.split(':'); setSort(k as SortKey, d as Dir) }}
          />
        </div>
        {filtersActive && <button type="button" onClick={clear} className="rounded-md text-[13px] font-medium text-accent-soft hover:text-white">Clear filters</button>}
      </div>

      {/* table */}
      <div className="mt-6 overflow-hidden rounded-r3 border border-hair bg-card shadow-card">
        {scan.packages.length === 0 ? (
          <EmptyState glyph={<PackageOpen size={40} className="text-ink-4" aria-hidden />} compact title="No packages were parsed" description="The lockfiles in this scan didn’t contain any resolvable dependencies." />
        ) : filtered.length === 0 ? (
          <EmptyState
            compact title="No packages match these filters" description="Widen the risk range or clear a filter to see more of the inventory."
            action={<Button variant="secondary" onClick={clear}>Clear filters</Button>}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="md:min-w-[860px]">
                <THead>
                  <Tr className="hover:bg-transparent">
                    <SortTh sortKey={sortKey} dir={dir} onSort={onSort} k="package" label="Package" className="!px-4" />
                    <SortTh sortKey={sortKey} dir={dir} onSort={onSort} k="version" label="Version" className="!px-3" />
                    <SortTh sortKey={sortKey} dir={dir} onSort={onSort} k="ecosystem" label="Ecosystem" className="!px-3" />
                    <SortTh sortKey={sortKey} dir={dir} onSort={onSort} k="registry" label="Registry" className="hidden !px-3 2xl:table-cell" />
                    <SortTh sortKey={sortKey} dir={dir} onSort={onSort} k="risk" label="Risk" className="!px-3" />
                    <SortTh sortKey={sortKey} dir={dir} onSort={onSort} k="confusion" label="Confusion" align="center" className="!px-2" />
                    <SortTh sortKey={sortKey} dir={dir} onSort={onSort} k="typosquat" label="Typosquat" align="center" className="!px-2" />
                    <SortTh sortKey={sortKey} dir={dir} onSort={onSort} k="metadata" label="Metadata" align="center" className="!px-2" />
                    <SortTh sortKey={sortKey} dir={dir} onSort={onSort} k="status" label="Status" className="!px-3" />
                    <Th className="w-10 !px-2"><span className="sr-only">Details</span></Th>
                  </Tr>
                </THead>
                <motion.tbody
                  key={`${filterKey}|${cur}`}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0.1 : 0.3 }}
                >
                  {rows.map((p) => {
                    const isOpen = open.has(p.id)
                    const detailId = `pd-${p.id}`
                    return (
                      <Fragment key={p.id}>
                        <Tr onClick={() => toggle(p.id)} selected={isOpen} className="group">
                          <Td className="!px-4 max-md:!px-0">
                            <div className="flex min-w-0 flex-col gap-1.5 py-1">
                              <div className="flex min-w-0 items-center gap-1">
                                <button
                                  type="button" aria-expanded={isOpen} aria-controls={isOpen ? detailId : undefined}
                                  aria-label={`${isOpen ? 'Collapse' : 'Expand'} details for ${p.name}`}
                                  onClick={(e) => { e.stopPropagation(); toggle(p.id) }}
                                  className="mono min-w-0 truncate rounded-md text-left text-[13.5px] font-medium text-ink transition-colors hover:text-accent-soft"
                                >
                                  {p.name}
                                </button>
                                <CopyButton
                                  value={p.name} label="Copy package name"
                                  className="shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
                                />
                              </div>
                              {(p.direct || p.dev) && (
                                <div className="flex gap-1.5">
                                  {p.direct && <Badge tone="accent" className="h-5 px-2 text-[10.5px]">direct</Badge>}
                                  {p.dev && <Badge className="h-5 px-2 text-[10.5px]">dev</Badge>}
                                </div>
                              )}
                            </div>
                          </Td>
                          <Td label="Version" className="!px-3 max-md:!px-0"><span className="mono text-[13px] text-ink-2">{p.version}</span></Td>
                          <Td label="Ecosystem" className="!px-3 max-md:!px-0">
                            <span className="md:hidden"><EcosystemPill ecosystem={p.ecosystem} /></span>
                            <span className="hidden md:inline-flex xl:hidden"><EcosystemPill ecosystem={p.ecosystem} compact /></span>
                            <span className="hidden xl:inline-flex"><EcosystemPill ecosystem={p.ecosystem} /></span>
                          </Td>
                          <Td label="Registry" className="hidden !px-3 max-md:!px-0 2xl:table-cell">
                            <span className={cn('mono block max-w-[150px] truncate text-[12.5px]', insecure(p) ? 'text-amber' : 'text-ink-3')} title={p.registry_source ?? p.registry}>
                              {insecure(p) && 'http · '}{host(p)}
                            </span>
                          </Td>
                          <Td label="Risk" className="!px-3 max-md:!px-0"><RiskCell pkg={p} /></Td>
                          <Td label="Confusion" align="center" className="!px-2 max-md:!px-0"><SignalCell kind="confusion" pkg={p} /></Td>
                          <Td label="Typosquatting" align="center" className="!px-2 max-md:!px-0"><SignalCell kind="typosquat" pkg={p} /></Td>
                          <Td label="Metadata" align="center" className="!px-2 max-md:!px-0"><SignalCell kind="metadata" pkg={p} /></Td>
                          <Td label="Status" className="!px-3 max-md:!px-0"><StatusPill pkg={p} /></Td>
                          <Td className="w-10 !px-2 max-md:!px-0 text-right">
                            <ChevronRight size={16} aria-hidden className={cn('ml-auto text-ink-3 transition-transform duration-comp ease-ripple', isOpen && 'rotate-90 text-ink-2')} />
                          </Td>
                        </Tr>
                        <AnimatePresence initial={false}>
                          {isOpen && (
                            <tr key="detail" id={detailId} className="border-b border-white/[.05] bg-black/20">
                              <td colSpan={COLS} className="p-0">
                                <motion.div
                                  initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                                  animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1, transition: tween(0.32) }}
                                  exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0, transition: tween(0.22) }}
                                  className="overflow-hidden"
                                >
                                  <div className="w-full px-5 py-5 md:px-6">
                                    <PackageDetail
                                      pkg={p}
                                      dependencies={p.dependencies.map((id) => packageById.get(id)?.name ?? id)}
                                      dependents={dependentsOf.get(p.id) ?? []}
                                      findings={findingsByPackage.get(p.id) ?? []}
                                    />
                                  </div>
                                </motion.div>
                              </td>
                            </tr>
                          )}
                        </AnimatePresence>
                      </Fragment>
                    )
                  })}
                </motion.tbody>
              </Table>
            </div>
            <Pagination page={cur} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
          </>
        )}
      </div>
    </>
  )
}
