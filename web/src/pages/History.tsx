import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { CloudOff, Download, FileJson, FileSpreadsheet, FolderOpen, Loader2, MoreHorizontal, ScanSearch, ShieldCheck, Trash2, FlaskConical } from 'lucide-react'
import type { ScanHistoryEntry } from '@/types/scan'
import { useScan } from '@/hooks/useScan'
import { api } from '@/lib/api'
import { downloadBlob, fmtDate } from '@/lib/format'
import { toCSV, toJSON, toSARIF } from '@/lib/exporters'
import { SEVERITY_META, sevColor } from '@/lib/meta'
import { EASE } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Dropdown, type MenuItem } from '@/components/ui/Dropdown'
import { EcosystemPill } from '@/components/ui/EcosystemPill'
import { EmptyState } from '@/components/ui/States'
import { ProgressRing } from '@/components/ui/Progress'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/Table'
import { Tooltip } from '@/components/ui/Tooltip'
import { useToast } from '@/components/ui/Toast'
import { useScanModal } from '@/components/scan/ScanModalContext'
import { RiskTrend } from '@/components/history/RiskTrend'
import { DeleteScanModal } from '@/components/history/DeleteScanModal'
import { entryFromScan, fmtScanDay, modeLabel, modeTone } from '@/components/history/helpers'
import { fmtNumber } from '@/lib/format'

type ExportFmt = 'json' | 'sarif' | 'csv'
const EXT: Record<ExportFmt, [string, string]> = { json: ['json', 'application/json'], sarif: ['sarif', 'application/sarif+json'], csv: ['csv', 'text/csv'] }

export default function History() {
  const { scan, history, apiOnline, ready, loadScan, deleteScan, refreshHistory } = useScan()
  const { openScan } = useScanModal()
  const navigate = useNavigate()
  const toast = useToast()
  const reduced = !!useReducedMotion()
  const [fetching, setFetching] = useState(true)
  const [opening, setOpening] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<ScanHistoryEntry | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let alive = true
    void refreshHistory().finally(() => { if (alive) setFetching(false) })
    return () => { alive = false }
  }, [refreshHistory])

  const offline = apiOnline === false
  // Server unreachable: show whatever this session actually has (the open scan) rather than nothing.
  const entries = useMemo<ScanHistoryEntry[]>(() => {
    if (history.length) return history
    return scan ? [entryFromScan(scan)] : []
  }, [history, scan])
  const currentId = scan?.id ?? null
  const showSkeleton = (!ready || fetching) && entries.length === 0

  const openEntry = useCallback(async (e: ScanHistoryEntry) => {
    if (opening) return
    if (e.id === currentId) { navigate('/'); return }
    setOpening(e.id)
    const s = await loadScan(e.id)
    setOpening(null)
    if (s) { toast.success('Attack surface mapped', `${s.project} is open.`); navigate('/') }
    else if (offline) toast.error('Couldn’t open that scan', 'The RIPPLE server isn’t reachable right now.')
  }, [opening, currentId, navigate, loadScan, toast, offline])

  const exportEntry = useCallback(async (e: ScanHistoryEntry, format: ExportFmt) => {
    const [ext, type] = EXT[format]
    const stamp = e.project.replace(/[^\w.-]+/g, '-')
    try {
      const { blob, filename } = await api.exportBlob(e.id, format)
      downloadBlob(blob, filename, blob.type || type)
      toast.success(`${format.toUpperCase()} exported`, `${e.findings} findings from ${e.project}.`)
      return
    } catch { /* server unreachable: fall through to what we hold in memory */ }
    if (scan && scan.id === e.id) {
      const data = format === 'json' ? toJSON(scan) : format === 'sarif' ? toSARIF(scan) : toCSV(scan)
      downloadBlob(data, `ripple-${stamp}.${ext}`, type)
      toast.success(`${format.toUpperCase()} exported`, `${e.findings} findings from ${e.project}.`)
    } else {
      toast.error('Couldn’t export that scan', 'The RIPPLE server isn’t reachable, and only the open scan is available offline.')
    }
  }, [scan, toast])

  const confirmDelete = useCallback(async () => {
    if (!toDelete) return
    setDeleting(true)
    await deleteScan(toDelete.id)
    setDeleting(false)
    setToDelete(null)
  }, [toDelete, deleteScan])

  const menuFor = (e: ScanHistoryEntry): MenuItem[] => [
    { id: 'open', label: 'Open scan', icon: <FolderOpen size={16} />, onSelect: () => void openEntry(e) },
    { id: 'json', label: 'Export JSON', icon: <FileJson size={16} />, hint: 'Full result', onSelect: () => void exportEntry(e, 'json') },
    { id: 'sarif', label: 'Export SARIF', icon: <ShieldCheck size={16} />, hint: 'CI', onSelect: () => void exportEntry(e, 'sarif') },
    { id: 'csv', label: 'Export CSV', icon: <FileSpreadsheet size={16} />, hint: 'Findings', onSelect: () => void exportEntry(e, 'csv') },
    { id: 'delete', label: <span className="text-sev-critical">Delete…</span>, icon: <Trash2 size={16} className="text-sev-critical" />, disabled: offline, onSelect: () => setToDelete(e) },
  ]

  return (
    <>
      <PageHeader
        eyebrow="History"
        title="Scan History"
        subtitle="Every scan this RIPPLE server has saved. Open one to reload its full attack surface."
        actions={<Button variant="primary" leading={<ScanSearch size={16} />} onClick={() => openScan()}>New scan</Button>}
      />

      {offline && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-r3 border border-amber/25 bg-amber/[.06] p-4">
          <CloudOff size={18} className="mt-0.5 shrink-0 text-amber" aria-hidden />
          <p className="text-[13.5px] leading-relaxed text-ink-3">
            <span className="font-medium text-ink">Server not reachable.</span> Showing the scans available in this session. Saved history returns when the RIPPLE server is running.
          </p>
        </div>
      )}

      {showSkeleton ? (
        <div className="overflow-hidden rounded-r3 border border-hair bg-card shadow-card"><SkeletonRows rows={6} /></div>
      ) : entries.length === 0 ? (
        <div className="rounded-r4 border border-hair bg-card shadow-card">
          <EmptyState
            title="No scans yet"
            description="Run a scan to map your attack surface. Every scan is saved here so you can compare risk over time."
            action={<Button variant="primary" leading={<ScanSearch size={16} />} onClick={() => openScan()}>Start Scan</Button>}
            secondary={<Button variant="secondary" leading={<FlaskConical size={16} />} onClick={() => openScan({ demo: true })}>Load Demo Dataset</Button>}
          />
        </div>
      ) : (
        <>
          <RiskTrend entries={entries} currentId={currentId} />

          <motion.div
            className="mt-6" initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.08, ease: EASE }}
          >
            {/* own container (not TableContainer) so 8 columns scroll sideways between 768 and ~1200px instead of clipping */}
            <div className="overflow-hidden rounded-r3 border border-hair bg-card shadow-card">
             <div className="overflow-x-auto">
              <Table aria-label="Saved scans" className="md:min-w-[920px]">
                <THead>
                  <Tr className="hover:bg-transparent">
                    <Th>Project</Th>
                    <Th align="right">Dependencies</Th>
                    <Th align="right">Findings</Th>
                    <Th>Risk</Th>
                    <Th>Mode</Th>
                    <Th>Ecosystems</Th>
                    <Th>Date</Th>
                    <Th className="w-14"><span className="sr-only">Actions</span></Th>
                  </Tr>
                </THead>
                <TBody>
                  {entries.map((e) => {
                    const current = e.id === currentId
                    const label = SEVERITY_META[e.risk_label]
                    return (
                      <Tr
                        key={e.id} selected={current} data-testid="history-row"
                        onClick={(ev) => { if (ev.currentTarget.contains(ev.target as Node)) void openEntry(e) }}
                      >
                        <Td>
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="min-w-0">
                              <button
                                type="button" onClick={(ev) => { ev.stopPropagation(); void openEntry(e) }}
                                aria-label={`Open ${e.project}, scanned ${fmtDate(e.created_at)}`}
                                className="mono flex max-w-[24ch] items-center gap-2 truncate rounded-md text-left text-[13.5px] font-medium text-ink hover:text-accent-soft"
                              >
                                <span className="truncate">{e.project}</span>
                                {opening === e.id && <Loader2 size={13} className="shrink-0 animate-spin text-accent-soft" aria-hidden />}
                              </button>
                              <div className="mono mt-0.5 truncate text-[11px] text-ink-3">{e.id}</div>
                            </div>
                            {current && <Badge tone="accent" className="shrink-0">Open now</Badge>}
                          </div>
                        </Td>
                        <Td label="Dependencies" align="right" className="tnum">{fmtNumber(e.dependencies)}</Td>
                        <Td label="Findings" align="right" className="tnum">{fmtNumber(e.findings)}</Td>
                        <Td label="Risk">
                          <div className="flex items-center gap-2.5">
                            <ProgressRing value={e.risk_score / 100} size={34} stroke={3.5} color={sevColor(e.risk_label)}>
                              <span className="tnum text-[11px] font-semibold" style={{ color: label.text }}>{e.risk_score}</span>
                            </ProgressRing>
                            <span className="text-[12px] font-medium" style={{ color: label.text }}>{label.label}</span>
                            <span className="sr-only">risk score {e.risk_score} out of 100</span>
                          </div>
                        </Td>
                        <Td label="Mode"><Badge tone={modeTone(e.mode)}>{modeLabel(e.mode)}</Badge></Td>
                        <Td label="Ecosystems">
                          <div className="flex max-w-[176px] flex-wrap gap-1.5">{e.ecosystems.map((x) => <EcosystemPill key={x} ecosystem={x} />)}</div>
                        </Td>
                        <Td label="Date" className="whitespace-nowrap">
                          <Tooltip content={fmtDate(e.created_at)}>
                            <time dateTime={e.created_at} className="text-[13px] text-ink-2">{fmtScanDay(e.created_at)}</time>
                          </Tooltip>
                        </Td>
                        <Td align="right" className="w-14 pr-4 max-md:!justify-end">
                          <Dropdown
                            items={menuFor(e)}
                            trigger={({ ref, props }) => (
                              <Button
                                ref={ref} icon size="sm" variant="ghost" aria-label={`Actions for ${e.project}`} {...props}
                                onClick={(ev) => { ev.stopPropagation(); (props.onClick as () => void)() }}
                              >
                                <MoreHorizontal size={18} />
                              </Button>
                            )}
                          />
                        </Td>
                      </Tr>
                    )
                  })}
                </TBody>
              </Table>
             </div>
            </div>
            <p className="mt-3 flex items-center gap-1.5 px-1 text-[12px] text-ink-3">
              <Download size={12} aria-hidden /> {entries.length} saved {entries.length === 1 ? 'scan' : 'scans'} · newest first
            </p>
          </motion.div>
        </>
      )}

      <DeleteScanModal entry={toDelete} busy={deleting} onCancel={() => setToDelete(null)} onConfirm={() => void confirmDelete()} />
    </>
  )
}
