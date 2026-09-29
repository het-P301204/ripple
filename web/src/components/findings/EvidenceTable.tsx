import type { ReactNode } from 'react'
import type { Finding } from '@/types/scan'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui/Badge'
import { CopyButton } from '@/components/ui/CopyButton'
import { PUBLIC_STATUS_LABEL } from './labels'

interface Row { label: string; value: ReactNode; mono?: boolean; copy?: string }

/** Label / value evidence table. Finding-specific evidence first, then the standard fields. Mono values get a copy affordance on hover. */
export function EvidenceTable({ finding: f }: { finding: Finding }) {
  const base: Row[] = [
    { label: 'Package', value: f.package, mono: true, copy: f.package },
    { label: 'Version', value: f.version, mono: true, copy: f.version },
    { label: 'Registry', value: f.registry, mono: true, copy: f.registry },
    { label: 'Resolution type', value: f.resolution_type, mono: true },
    {
      label: 'Public registration',
      value: (
        <Badge tone={f.public_status === 'registered' ? 'ok' : f.public_status === 'not_found' ? 'amber' : 'neutral'}>
          {PUBLIC_STATUS_LABEL[f.public_status] ?? f.public_status}
        </Badge>
      ),
    },
    { label: 'Dependency source', value: f.dependency_source, mono: true, copy: f.dependency_source },
    { label: 'Detected', value: fmtDate(f.detected_at) },
  ]
  const seen = new Set(base.map((r) => r.label.toLowerCase()))
  const extra: Row[] = f.evidence
    .filter((e) => !seen.has(e.label.toLowerCase()))
    .map((e) => ({ label: e.label, value: e.value, mono: e.mono, copy: e.mono ? e.value : undefined }))
  const rows = [...extra, ...base]
  return (
    <dl className="overflow-hidden rounded-r3 border border-white/[.06] bg-black/20">
      {rows.map((r, i) => (
        <div
          key={r.label + i}
          className={cn('group grid grid-cols-1 gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[210px_minmax(0,1fr)] sm:items-center', i > 0 && 'border-t border-white/[.05]')}
        >
          <dt className="text-[12.5px] text-ink-3">{r.label}</dt>
          <dd className={cn('flex min-w-0 items-center gap-1 text-[13.5px] text-ink', r.mono && 'mono text-[13px]')}>
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{r.value}</span>
            {r.copy && (
              <CopyButton value={r.copy} label={`Copy ${r.label.toLowerCase()}`} className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100" />
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
