import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import type { Ecosystem, EcosystemSummary } from '@/types/scan'
import { useScan } from '@/hooks/useScan'
import { ECOSYSTEMS, ECOSYSTEM_META } from '@/lib/meta'
import { plural } from '@/lib/format'
import { EASE } from '@/lib/motion'
import { NoScanEmptyState } from '@/components/NoScanEmptyState'
import { EcosystemMark } from '@/components/ui/EcosystemPill'
import { PageHeader } from '@/components/ui/PageHeader'
import { Segmented } from '@/components/ui/Segmented'
import { Skeleton, SkeletonCards } from '@/components/ui/Skeleton'
import { EcosystemCompare } from '@/components/ecosystems/EcosystemCompare'
import { EcosystemPanel } from '@/components/ecosystems/EcosystemPanel'

const isEco = (v: string | undefined): v is Ecosystem => !!v && (ECOSYSTEMS as string[]).includes(v)

export default function Ecosystems() {
  const { eco: param } = useParams<{ eco: string }>()
  const { scan, loading } = useScan()
  const navigate = useNavigate()
  const reduced = !!useReducedMotion()

  const summaries = useMemo(() => {
    const m: Partial<Record<Ecosystem, EcosystemSummary>> = {}
    scan?.ecosystems.forEach((e) => { m[e.ecosystem] = e })
    return m
  }, [scan])

  const first = ECOSYSTEMS.find((e) => (summaries[e]?.total ?? 0) > 0) ?? 'npm'
  const [tab, setTab] = useState<Ecosystem>(isEco(param) ? param : first)

  // follow real route changes (deep links, back/forward, links from other pages)
  useEffect(() => { if (isEco(param)) setTab(param) }, [param])
  // when there is no explicit route param, land on the first ecosystem that has packages once the scan is known
  useEffect(() => { if (!isEco(param)) setTab(first) }, [param, first])

  const select = (e: Ecosystem) => {
    setTab(e)
    // Keep the URL in sync without a route change: a real navigation would replay the whole-page transition
    // and remount the tab indicator. Falls back to router navigation if the History API is unavailable.
    const to = `/ecosystems/${e}`
    try {
      if (window.location.pathname !== to) window.history.replaceState(window.history.state, '', to)
    } catch {
      navigate(to, { replace: true })
    }
  }

  if (loading && !scan) {
    return (
      <>
        <PageHeader title="Ecosystems" subtitle="Exposure across each package registry." />
        <Skeleton className="h-[92px] w-full rounded-r3" />
        <div className="mt-8"><SkeletonCards count={4} /></div>
      </>
    )
  }
  if (!scan) {
    return (
      <>
        <PageHeader title="Ecosystems" subtitle="Exposure across each package registry." />
        <NoScanEmptyState title="No ecosystems to compare" description="Load a scan to see npm, PyPI, Go and Rust side by side." />
      </>
    )
  }

  const active = ECOSYSTEMS.filter((e) => (summaries[e]?.total ?? 0) > 0).length
  return (
    <>
      <PageHeader
        eyebrow={scan.project}
        title="Ecosystems"
        subtitle={`${plural(active, 'registry', 'registries')} in scope. Compare exposure by ecosystem, then open one for its findings and riskiest packages.`}
      />

      <EcosystemCompare summaries={summaries} active={tab} onSelect={select} />

      <div className="mt-8">
        <Segmented<Ecosystem>
          variant="tabs" ariaLabel="Ecosystem" value={tab} onChange={select}
          options={ECOSYSTEMS.map((e) => ({
            value: e,
            label: <span className="inline-flex items-center gap-2"><EcosystemMark ecosystem={e} size={14} />{ECOSYSTEM_META[e].label}</span>,
            count: summaries[e]?.total ?? 0,
            ariaLabel: `${ECOSYSTEM_META[e].label}, ${plural(summaries[e]?.total ?? 0, 'dependency', 'dependencies')}`,
          }))}
          className="w-full"
        />
      </div>

      <div className="mt-6" role="tabpanel" aria-label={`${ECOSYSTEM_META[tab].label} details`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.34, ease: EASE } }}
            exit={{ opacity: 0, transition: { duration: 0.14 } }}
          >
            <EcosystemPanel eco={tab} summary={summaries[tab]} scan={scan} />
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}
