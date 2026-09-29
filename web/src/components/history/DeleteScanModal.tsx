import { useRef } from 'react'
import { Trash2 } from 'lucide-react'
import type { ScanHistoryEntry } from '@/types/scan'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { fmtDate } from '@/lib/format'

/**
 * Rounded, focus-trapped confirmation. Focus lands on "Keep scan" (the safe choice);
 * Esc and the backdrop cancel unless the delete is in flight.
 */
export function DeleteScanModal({
  entry, busy, onCancel, onConfirm,
}: { entry: ScanHistoryEntry | null; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  // keep the last entry around so the exit animation doesn't flash empty copy
  const last = useRef<ScanHistoryEntry | null>(null)
  if (entry) last.current = entry
  const e = entry ?? last.current
  return (
    <Modal open={!!entry} onClose={onCancel} title="Delete scan" hideClose dismissible={!busy} className="max-w-md">
      <div className="p-6 md:p-7" data-testid="delete-modal">
        <span aria-hidden className="grid h-11 w-11 place-items-center rounded-r2 border border-sev-critical/25 bg-sev-critical/10 text-sev-critical"><Trash2 size={20} /></span>
        <h2 className="mt-5 text-[18px] font-semibold tracking-[-0.02em]">Delete this scan?</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-3">
          <span className="mono text-ink-2">{e?.project}</span> from {e ? fmtDate(e.created_at) : ''} will be removed from this server’s history. Reports you’ve already exported aren’t affected. This can’t be undone.
        </p>
        <div className="mt-7 flex flex-wrap justify-end gap-2.5">
          <Button variant="secondary" data-autofocus onClick={onCancel} disabled={busy}>Keep scan</Button>
          <Button variant="danger" leading={<Trash2 size={15} aria-hidden />} loading={busy} onClick={onConfirm}>Delete scan</Button>
        </div>
      </div>
    </Modal>
  )
}
