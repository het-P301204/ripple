import type { Ecosystem } from '@/types/scan'
import { ECOSYSTEM_META } from '@/lib/meta'
import { cn } from '@/lib/cn'

/** Small custom marks for each registry ecosystem (16px grid, currentColor-friendly). */
export function EcosystemMark({ ecosystem, size = 14, className }: { ecosystem: Ecosystem; size?: number; className?: string }) {
  const c = ECOSYSTEM_META[ecosystem].color
  const common = { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, className } as const
  switch (ecosystem) {
    case 'npm':
      return (
        <svg {...common} fill="none">
          <rect x="1.5" y="3" width="13" height="10" rx="2.2" fill={c} fillOpacity=".16" stroke={c} strokeWidth="1.2" />
          <path d="M4.6 10.6V5.6h3v5M7.6 5.6h2.6v3.1M10.2 8.7v1.9" stroke={c} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'pypi':
      return (
        <svg {...common} fill="none">
          <path d="M8 1.8c-2.6 0-2.4 1.1-2.4 1.1v1.2H8v.5H4.3S2 4.4 2 8s2 3.5 2 3.5h1.2V9.9s-.1-2 2-2h3s1.9 0 1.9-1.8V3.5S12.4 1.8 8 1.8Z" fill={c} fillOpacity=".2" stroke={c} strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M8 14.2c2.6 0 2.4-1.1 2.4-1.1v-1.2H8v-.5h3.7S14 11.6 14 8s-2-3.5-2-3.5h-1.2v1.6s.1 2-2 2h-3s-1.9 0-1.9 1.8v2.6S3.6 14.2 8 14.2Z" fill={c} fillOpacity=".1" stroke={c} strokeWidth="1.1" strokeLinejoin="round" />
        </svg>
      )
    case 'go':
      return (
        <svg {...common} fill="none">
          <path d="M2 6.2h4M1 8.2h3.2M2.6 10.2h3" stroke={c} strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="10.2" cy="8.4" r="3.4" fill={c} fillOpacity=".16" stroke={c} strokeWidth="1.2" />
          <circle cx="9.2" cy="7.9" r=".7" fill={c} /><circle cx="11.4" cy="7.9" r=".7" fill={c} />
        </svg>
      )
    case 'rust':
      return (
        <svg {...common} fill="none">
          <circle cx="8" cy="8" r="4.2" fill={c} fillOpacity=".14" stroke={c} strokeWidth="1.2" />
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i * Math.PI) / 4
            return <line key={i} x1={8 + Math.cos(a) * 5} y1={8 + Math.sin(a) * 5} x2={8 + Math.cos(a) * 6.6} y2={8 + Math.sin(a) * 6.6} stroke={c} strokeWidth="1.4" strokeLinecap="round" />
          })}
          <path d="M6.6 10.4V5.9h1.7a1.2 1.2 0 0 1 0 2.4H6.6M8.2 8.3l1.3 2.1" stroke={c} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
  }
}

/** Ecosystem pill: mark + label. */
export function EcosystemPill({ ecosystem, className, compact }: { ecosystem: Ecosystem; className?: string; compact?: boolean }) {
  const m = ECOSYSTEM_META[ecosystem]
  return (
    <span
      title={m.registry}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/[.08] bg-white/[.035] px-2.5 text-[11.5px] font-medium leading-none text-ink-2',
        compact && 'px-2', className,
      )}
    >
      <EcosystemMark ecosystem={ecosystem} />
      {!compact && m.label}
    </span>
  )
}
