import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { Download, ExternalLink, FileJson, FileSpreadsheet, FileText, Printer, ShieldCheck, Terminal } from 'lucide-react'
import type { ExportFormat } from '@/lib/store'
import { useScan } from '@/hooks/useScan'
import { fmtDate } from '@/lib/format'
import { EASE } from '@/lib/motion'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { NoScanEmptyState } from '@/components/NoScanEmptyState'
import { RadioSegmented } from '@/components/settings/controls'
import { ReportDocument, type ReportTheme } from '@/components/reports/ReportDocument'
import { CommandLine, ExportCard } from '@/components/reports/ExportCard'
import { SarifPreview } from '@/components/reports/SarifPreview'
import { TerminalPreview } from '@/components/reports/TerminalPreview'

/** Paper copy of the report, mounted as a direct child of <body>: it is the ONLY thing that prints. */
function PrintMount({ children }: { children: React.ReactNode }) {
  return createPortal(<div className="rp-print-root" data-testid="print-root">{children}</div>, document.body)
}

export default function Reports() {
  const { scan, exporting, exportScan, offline } = useScan()
  const reduced = !!useReducedMotion()
  const [view, setView] = useState<'report' | 'print'>('report')

  // Ctrl+P on this page prints the report too (the paper copy is always mounted), so name the PDF sensibly.
  useEffect(() => {
    if (!scan) return
    let prev = ''
    const before = () => { prev = document.title; document.title = `RIPPLE report - ${scan.project}` }
    const after = () => { if (prev) document.title = prev }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after) }
  }, [scan])

  const print = useCallback(() => window.print(), [])
  const busy = (f: ExportFormat) => exporting?.format === f

  if (!scan) {
    return (
      <>
        <PageHeader title="Reports" subtitle="Export findings for CI, auditors and teammates." />
        <NoScanEmptyState title="Nothing to report yet" description="Run a scan, or load the demo dataset, and its report appears here ready to export, print or hand to CI." />
      </>
    )
  }

  const theme: ReportTheme = view === 'print' ? 'paper' : 'dark'
  const doc = <ReportDocument scan={scan} theme={theme} />

  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Reports"
        subtitle="Preview the executive report, print it as a PDF, or export the raw findings for CI and auditors."
        meta={
          <>
            <Badge tone={scan.mode === 'demo' ? 'amber' : 'neutral'}>{scan.mode === 'demo' ? 'Demo dataset' : scan.mode === 'live' ? 'Live registries' : 'Offline analysis'}</Badge>
            <span className="mono text-ink-2">{scan.project}</span>
            <span>{fmtDate(scan.created_at)}</span>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_392px] xl:gap-8">
        {/* ------------------------------- export rail ------------------------------- */}
        <motion.aside
          aria-label="Export options" className="order-1 space-y-4 xl:order-2"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.08, ease: EASE }}
        >
          <ExportCard
            icon={<FileJson size={20} />} title="JSON" ext=".json" busy={busy('json')}
            description="The complete scan: every package, finding, evidence item and dependency edge. Best for scripts, dashboards and comparing scans."
            command="ripple export latest --format json -o ripple.json"
            actions={<Button variant="secondary" loading={busy('json')} disabled={!!exporting && !busy('json')} leading={<Download size={16} />} onClick={() => void exportScan('json')}>Download JSON</Button>}
          />
          <ExportCard
            icon={<ShieldCheck size={20} />} title="SARIF" ext=".sarif" busy={busy('sarif')}
            description="SARIF 2.1.0 — upload to GitHub code scanning, or any SARIF-aware CI, to surface findings on pull requests."
            command="ripple export latest --format sarif -o ripple.sarif"
            actions={<Button variant="secondary" loading={busy('sarif')} disabled={!!exporting && !busy('sarif')} leading={<Download size={16} />} onClick={() => void exportScan('sarif')}>Download SARIF</Button>}
          />
          <ExportCard
            icon={<FileSpreadsheet size={20} />} title="CSV" ext=".csv" busy={busy('csv')}
            description="One row per finding with severity, package, ecosystem and rule. Opens in any spreadsheet or ticketing import."
            command="ripple export latest --format csv -o ripple.csv"
            actions={<Button variant="secondary" loading={busy('csv')} disabled={!!exporting && !busy('csv')} leading={<Download size={16} />} onClick={() => void exportScan('csv')}>Download CSV</Button>}
          />
          <ExportCard
            icon={<FileText size={20} />} title="PDF-ready report" ext="print" busy={busy('pdf')}
            description="The report on the left with the app chrome stripped, A4 page breaks and a light print theme. Choose Save as PDF in the print dialog."
            command="ripple export latest --format html -o ripple-report.html" commandLabel="CLI equivalent (print-ready HTML)"
            actions={
              <>
                <Button variant="primary" leading={<Printer size={16} />} onClick={print}>Print / Save as PDF</Button>
                <Button variant="ghost" loading={busy('pdf')} disabled={!!exporting && !busy('pdf')} leading={<ExternalLink size={15} />} onClick={() => void exportScan('pdf')}>Open standalone</Button>
              </>
            }
          />

          <Card radius={3} className="p-5">
            <div className="flex items-start gap-3.5">
              <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-r2 border border-white/[.08] bg-white/[.035] text-accent-soft"><Terminal size={20} /></span>
              <div className="min-w-0">
                <h3 className="text-[14.5px] font-semibold tracking-[-0.01em]">Rich terminal report</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">The same summary in your terminal: risk bar, severity table and top findings. Add <span className="mono text-ink-2">--details 3</span> for full finding panels.</p>
              </div>
            </div>
            <div className="mt-4"><CommandLine command="ripple report latest" label="Run" /></div>
            <div className="mt-4"><TerminalPreview scan={scan} /></div>
            <p className="mt-2.5 text-[11.5px] text-ink-3">Static preview of this scan’s data.</p>
          </Card>

          <SarifPreview scan={scan} />

          {offline && (
            <p className="px-1 text-[12px] leading-relaxed text-ink-3">
              The RIPPLE server isn’t reachable, so exports are generated in your browser from the loaded scan.
            </p>
          )}
        </motion.aside>

        {/* ------------------------------- report preview ------------------------------- */}
        <div className="order-2 min-w-0 xl:order-1">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span id="lbl-view" className="text-[12.5px] font-medium text-ink-2">Preview</span>
              <RadioSegmented
                ariaLabelledBy="lbl-view" value={view} onChange={setView}
                options={[{ value: 'report', label: 'Report' }, { value: 'print', label: 'Print view' }]}
              />
            </div>
            <Button variant="secondary" size="sm" leading={<Printer size={15} />} onClick={print}>Print</Button>
          </div>

          <motion.div
            key={theme}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}
          >
            {theme === 'paper' ? (
              <div className="rp-sheet">{doc}</div>
            ) : (
              <Card radius={4} className="p-5 md:p-9">{doc}</Card>
            )}
          </motion.div>
          <p className="mt-3 px-1 text-[12px] text-ink-3">
            {view === 'print' ? 'This is how the printed page looks. Printing hides everything except the report.' : 'Switch to Print view to see the light, A4-ready layout.'}
          </p>
        </div>
      </div>

      <PrintMount><ReportDocument scan={scan} theme="paper" /></PrintMount>
    </>
  )
}
