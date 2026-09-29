import { cn } from '@/lib/cn'
import { useReducedMotion } from '@/lib/perf'

/**
 * RIPPLE mark: a central node with concentric rings that slowly expand and fade.
 * Not a spinner — one ring holds still, two drift outward twice and then rest (no perpetual repaint of the sidebar).
 */
export function LogoMark({ size = 28, animated = true, className }: { size?: number; animated?: boolean; className?: string }) {
  const reduced = useReducedMotion()
  const live = animated && !reduced
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden className={cn('shrink-0 overflow-visible', className)}>
      <defs>
        <radialGradient id="lm-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#C4B5FD" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="7" stroke="#8B5CF6" strokeOpacity=".8" strokeWidth="1.7" />
      <circle cx="16" cy="16" r="11.5" stroke="#8B5CF6" strokeOpacity=".32" strokeWidth="1.4" />
      {live && (
        <>
          <circle cx="16" cy="16" r="7" stroke="#A78BFA" strokeWidth="1.2" style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: 'logo-ring 3.6s cubic-bezier(0.22,1,0.36,1) 0.4s 2 both' }} />
          <circle cx="16" cy="16" r="7" stroke="#F472B6" strokeWidth="1" style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: 'logo-ring 3.6s cubic-bezier(0.22,1,0.36,1) 2.2s 2 both' }} />
        </>
      )}
      <circle cx="16" cy="16" r="3" fill="url(#lm-core)" />
    </svg>
  )
}

/** Mark + wordmark. */
export function Logo({ size = 28, animated = true, className, wordmark = true }: { size?: number; animated?: boolean; className?: string; wordmark?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={size} animated={animated} />
      {wordmark && <span className="text-[15px] font-semibold tracking-[.22em] text-ink">RIPPLE</span>}
    </span>
  )
}
