import { Link } from 'react-router-dom'
import { CloudOff, Download, FileJson, FileSpreadsheet, FileText, Menu, ScanSearch, Settings, ShieldCheck } from 'lucide-react'
import { useRipple, type ExportFormat } from '@/lib/store'
import { Button } from '@/components/ui/Button'
import { Dropdown, type MenuItem } from '@/components/ui/Dropdown'
import { Tooltip } from '@/components/ui/Tooltip'
import { Badge } from '@/components/ui/Badge'
import { useScanModal } from '@/components/scan/ScanModalContext'
import { LogoMark } from '@/components/brand/Logo'
import { MotionQuickToggle } from '@/components/settings/MotionToggle'

/** Page-independent top bar: scan context, offline indicator, Scan, Export, Settings. Hamburger on mobile. */
export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { scan, offline, exporting, exportScan } = useRipple()
  const { openScan } = useScanModal()

  const items: MenuItem[] = ([
    ['json', 'JSON', 'Full result', <FileJson size={16} key="j" />],
    ['sarif', 'SARIF', 'CI code scanning', <ShieldCheck size={16} key="s" />],
    ['csv', 'CSV', 'Findings table', <FileSpreadsheet size={16} key="c" />],
    ['pdf', 'PDF-ready', 'Print report', <FileText size={16} key="p" />],
  ] as Array<[ExportFormat, string, string, JSX.Element]>).map(([id, label, hint, icon]) => ({
    id, label, hint, icon, onSelect: () => void exportScan(id),
  }))

  return (
    <div className="sticky top-0 z-20 border-b border-hair bg-bg/95">
      <div className="flex h-[var(--topbar-h)] items-center gap-3 px-4 md:px-8">
        <Button icon variant="ghost" className="lg:hidden" aria-label="Open navigation" onClick={onMenu}><Menu size={20} /></Button>
        <Link to="/" aria-label="RIPPLE home" className="rounded-r1 lg:hidden"><LogoMark size={24} animated={false} /></Link>

        {scan && (
          <div className="hidden min-w-0 items-center gap-2.5 text-[13px] md:flex">
            <span className="mono truncate text-ink-2">{scan.project}</span>
            <Badge tone={scan.mode === 'demo' ? 'amber' : 'neutral'}>{scan.mode === 'demo' ? 'Demo' : scan.mode === 'live' ? 'Live' : 'Offline scan'}</Badge>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {offline && (
            <Tooltip content="RIPPLE’s local server isn’t reachable, so you’re working from the bundled demo dataset.">
              <span className="hidden sm:inline-flex"><Badge tone="amber" icon={<CloudOff size={12} />}>Offline demo</Badge></span>
            </Tooltip>
          )}
          <Button variant="primary" leading={<ScanSearch size={16} />} onClick={() => openScan()}>Scan</Button>
          <Dropdown
            items={items}
            trigger={({ ref, props }) => (
              <Button ref={ref} variant="secondary" loading={!!exporting} leading={<Download size={16} />} {...props}>
                <span className="hidden sm:inline">Export</span>
              </Button>
            )}
          />
          <MotionQuickToggle />
          <Tooltip content="Settings" side="bottom">
            <Link to="/settings" aria-label="Settings" className="grid h-10 w-10 place-items-center rounded-r2 text-ink-3 transition-colors hover:bg-white/[.06] hover:text-ink">
              <Settings size={18} />
            </Link>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
