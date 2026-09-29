import type { ReactNode } from 'react'
import { Check, Eye, Minus, PackageSearch, Type } from 'lucide-react'
import type { Package, PackageStatus } from '@/types/scan'
import { SEVERITY_META, sevColor } from '@/lib/meta'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui/Badge'
import { Tooltip } from '@/components/ui/Tooltip'

type SignalKind = 'confusion' | 'typosquat' | 'metadata'
type SignalState = 'flagged' | 'clear' | 'unknown'

const ICON: Record<SignalKind, (p: { size: number }) => ReactNode> = {
  confusion: ({ size }) => <PackageSearch size={size} />,
  typosquat: ({ size }) => <Type size={size} />,
  metadata: ({ size }) => <Eye size={size} />,
}
const NAME: Record<SignalKind, string> = { confusion: 'Dependency confusion', typosquat: 'Typosquatting', metadata: 'Suspicious metadata' }

function describe(kind: SignalKind, state: SignalState, p: Package): string {
  if (state === 'flagged') {
    if (kind === 'confusion') return 'Dependency confusion candidate: an internal-looking name a public registry could shadow.'
    if (kind === 'typosquat') return 'Typosquatting candidate: this name sits one keystroke from a popular package.'
    return 'Suspicious metadata: install scripts, a fresh registration or maintainer churn.'
  }
  if (state === 'unknown') return 'Registry metadata was not available, so this check could not run.'
  if (kind === 'confusion') return p.internal_looking ? 'Looks internal, but no shadowing risk was found.' : 'Not an internal-looking name.'
  if (kind === 'typosquat') return 'No close match to a popular package.'
  return 'No suspicious metadata signals.'
}

/** Status icon for one detector on a package row: flagged (severity-tinted), clear, or unknown. Explained by tooltip. */
export function SignalCell({ kind, pkg }: { kind: SignalKind; pkg: Package }) {
  const flagged = kind === 'confusion' ? pkg.confusion : kind === 'typosquat' ? pkg.typosquat : pkg.metadata_flag
  const state: SignalState = flagged ? 'flagged' : kind === 'metadata' && !pkg.metadata ? 'unknown' : 'clear'
  const text = describe(kind, state, pkg)
  return (
    <Tooltip content={text}>
      <span
        tabIndex={0} role="img" aria-label={`${NAME[kind]}: ${state === 'flagged' ? 'flagged' : state === 'clear' ? 'clear' : 'unavailable'}`}
        className={cn('inline-grid h-8 w-8 place-items-center rounded-r1 border transition-colors duration-micro', state !== 'flagged' && 'border-transparent text-ink-4')}
        style={state === 'flagged' ? { background: SEVERITY_META[pkg.severity].bg, borderColor: SEVERITY_META[pkg.severity].border, color: sevColor(pkg.severity) } : undefined}
      >
        {state === 'flagged' ? ICON[kind]({ size: 15 }) : state === 'clear' ? <Check size={14} /> : <Minus size={14} />}
      </span>
    </Tooltip>
  )
}

const STATUS_LABEL: Record<PackageStatus, string> = { clean: 'Clean', flagged: 'Flagged', unverified: 'Unverified' }

/** Package status pill: clean (green), flagged (severity triad), unverified (neutral). */
export function StatusPill({ pkg }: { pkg: Package }) {
  if (pkg.status === 'flagged') {
    const m = SEVERITY_META[pkg.severity]
    return (
      <span
        className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[11.5px] font-medium leading-none"
        style={{ background: m.bg, borderColor: m.border, color: m.text }}
      >
        {STATUS_LABEL.flagged}
      </span>
    )
  }
  return <Badge tone={pkg.status === 'clean' ? 'ok' : 'neutral'}>{STATUS_LABEL[pkg.status]}</Badge>
}

/** Risk cell: severity-coloured bar + number. */
export function RiskCell({ pkg }: { pkg: Package }) {
  return (
    <div className="flex items-center gap-3" role="img" aria-label={`Risk ${pkg.risk_score} out of 100, ${pkg.severity}`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/[.06]" aria-hidden>
        <div className="h-full rounded-full transition-[width] duration-page ease-ripple" style={{ width: `${Math.max(3, pkg.risk_score)}%`, background: sevColor(pkg.severity) }} />
      </div>
      <span className="tnum w-7 text-right text-[13.5px] font-semibold">{pkg.risk_score}</span>
    </div>
  )
}
