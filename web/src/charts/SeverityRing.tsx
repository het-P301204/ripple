import type { ReactNode } from 'react'
import type { Severity } from '@/types/scan'
import { SEVERITY_META } from '@/lib/meta'

/**
 * Small ring gauge coloured by severity. `value` (0..max) fills the arc; children/value render in the centre.
 * Under reduced motion the global rule collapses the stroke transition.
 */
export function SeverityRing({
  severity, value, max = 100, size = 44, stroke = 3.5, children, label,
}: { severity: Severity; value: number; max?: number; size?: number; stroke?: number; children?: ReactNode; label?: string }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const f = Math.max(0, Math.min(1, max > 0 ? value / max : 0))
  const col = `rgb(${SEVERITY_META[severity].rgb})`
  return (
    <span
      role="img"
      aria-label={label ?? `Score ${value} of ${max}, ${SEVERITY_META[severity].label}`}
      className="relative inline-grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - f)} style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center">
        {children ?? <span className="tnum font-semibold leading-none" style={{ fontSize: Math.max(10, size * 0.32) }}>{Math.round(value)}</span>}
      </span>
    </span>
  )
}
