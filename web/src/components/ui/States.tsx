import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './Button'

/** Small animated network/ripple glyph used by empty + error states. `broken` shows a severed link. */
export function StateGlyph({ tone = 'accent', broken, size = 96 }: { tone?: 'accent' | 'danger' | 'amber'; broken?: boolean; size?: number }) {
  const reduced = useReducedMotion()
  const col = tone === 'danger' ? '#F0506E' : tone === 'amber' ? '#F59E0B' : '#A78BFA'
  const nodes: Array<[number, number]> = [[22, 66], [74, 70], [80, 28], [30, 26]]
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden className="overflow-visible">
      {[0, 1, 2].map((i) => (
        <circle
          key={i} cx="50" cy="50" r="38" stroke={col} strokeWidth="1"
          style={{
            transformBox: 'fill-box', transformOrigin: 'center', opacity: reduced ? 0.12 : 0,
            animation: reduced ? undefined : `net-pulse 5s cubic-bezier(0.22,1,0.36,1) ${i * 1.6}s 2 both`,
          }}
        />
      ))}
      <circle cx="50" cy="50" r="24" stroke={col} strokeOpacity=".22" strokeWidth="1" />
      {nodes.map(([x, y], i) => (
        <g key={i}>
          <line x1="50" y1="50" x2={x} y2={y} stroke={col} strokeOpacity={broken && i === 1 ? 0.18 : 0.35} strokeWidth="1" strokeDasharray={broken && i === 1 ? '2 4' : undefined} />
          <circle cx={x} cy={y} r="3" fill="#111316" stroke={col} strokeOpacity=".7" strokeWidth="1.2" />
        </g>
      ))}
      <circle cx="50" cy="50" r="6.5" fill={col} fillOpacity=".16" stroke={col} strokeWidth="1.4" />
      <circle cx="50" cy="50" r="2.4" fill={col} />
    </svg>
  )
}

/** Empty state: glyph, title, description, optional actions. */
export function EmptyState({
  title, description, action, secondary, glyph, compact, className,
}: { title: string; description?: ReactNode; action?: ReactNode; secondary?: ReactNode; glyph?: ReactNode; compact?: boolean; className?: string }) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={cn('flex flex-col items-center text-center', compact ? 'px-6 py-10' : 'px-6 py-16 md:py-24', className)}
    >
      {glyph ?? <StateGlyph size={compact ? 72 : 96} />}
      <h2 className={cn('mt-5 font-semibold tracking-[-0.02em]', compact ? 'text-[16px]' : 'text-[20px]')}>{title}</h2>
      {description && <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-3">{description}</p>}
      {(action || secondary) && <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{action}{secondary}</div>}
    </motion.div>
  )
}

export type ErrorVariant = 'registry' | 'lockfile' | 'server' | 'generic'

const COPY: Record<ErrorVariant, { title: string; body: (eco?: string) => string; tone: 'danger' | 'amber' }> = {
  registry: {
    title: 'Registry unavailable',
    body: (eco = 'PyPI') => `RIPPLE couldn’t retrieve metadata from ${eco}. Your local lockfile analysis is still available.`,
    tone: 'amber',
  },
  lockfile: {
    title: 'Unsupported lockfile',
    body: () => 'We couldn’t identify this dependency format. Supported: npm, PyPI, Go, Rust',
    tone: 'danger',
  },
  server: {
    title: 'Registry query interrupted',
    body: () => 'RIPPLE’s local server isn’t responding, so live scans are paused. The bundled demo dataset still works.',
    tone: 'amber',
  },
  generic: { title: 'Something went wrong', body: () => 'RIPPLE couldn’t complete that request. Try again in a moment.', tone: 'danger' },
}

/** Error state with brief-mandated copy per variant. Never render raw errors: pass a `detail` string that is already user-safe. */
export function ErrorState({
  variant = 'generic', ecosystem, detail, onRetry, secondary, compact, className,
}: { variant?: ErrorVariant; ecosystem?: string; detail?: string; onRetry?: () => void; secondary?: ReactNode; compact?: boolean; className?: string }) {
  const c = COPY[variant]
  return (
    <EmptyState
      compact={compact}
      className={className}
      glyph={<StateGlyph tone={c.tone} broken size={compact ? 72 : 96} />}
      title={c.title}
      description={
        <>
          {c.body(ecosystem)}
          {detail && <span className="mt-2 block text-[13px] text-ink-4">{detail}</span>}
        </>
      }
      action={onRetry && <Button variant="secondary" leading={<RefreshCw size={15} />} onClick={onRetry}>Retry</Button>}
      secondary={secondary}
    />
  )
}
