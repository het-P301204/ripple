import type { ReactNode } from 'react'
import { FlaskConical, ScanSearch } from 'lucide-react'
import { Button } from './ui/Button'
import { EmptyState } from './ui/States'
import { useScanModal } from './scan/ScanModalContext'

/**
 * Shown by every scan-dependent page when no ScanResult is loaded.
 * Offers "Start New Scan" and "Load Demo Dataset" (first-class flow).
 */
export function NoScanEmptyState({
  title = 'No scan loaded', description = 'Analyze a lockfile, or explore RIPPLE with the bundled demo dataset.', extra,
}: { title?: string; description?: ReactNode; extra?: ReactNode }) {
  const { openScan } = useScanModal()
  return (
    <EmptyState
      title={title}
      description={description}
      action={<Button variant="primary" leading={<ScanSearch size={16} />} onClick={() => openScan()}>Start New Scan</Button>}
      secondary={<Button variant="secondary" leading={<FlaskConical size={16} />} onClick={() => openScan({ demo: true })}>Load Demo Dataset</Button>}
      className={extra ? 'pb-6' : undefined}
    />
  )
}
