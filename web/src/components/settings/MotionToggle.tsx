import { Gauge, Zap } from 'lucide-react'
import { useMotionSetting } from '@/lib/perf'
import { Card } from '@/components/ui/Card'
import { Switch } from '@/components/ui/Input'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'

/** Settings card: "Reduce animations". Persisted locally (localStorage), defaults on for low-power devices. */
export function MotionToggle() {
  const { setting, os, set } = useMotionSetting()
  return (
    <section id="performance" tabIndex={-1} aria-labelledby="performance-title" className="scroll-mt-[calc(var(--topbar-h)+20px)] outline-none">
      <Card radius={4} className="p-5 md:p-7">
        <header className="mb-5 flex items-start gap-3.5">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-r2 border border-white/[.08] bg-white/[.035] text-accent-soft"><Gauge size={18} /></span>
          <div className="min-w-0">
            <h2 id="performance-title" className="text-[16px] font-semibold tracking-[-0.015em]">Performance</h2>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">Trade decoration for responsiveness on slower machines.</p>
          </div>
        </header>
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h3 id="lbl-reduce-motion" className="text-[13.5px] font-medium text-ink">Reduce animations</h3>
            <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-ink-3">
              Turns off ambient and looping effects, shortens transitions and skips motion-based entrances. Saved in this browser.
              {os && <span className="text-ink-2"> Your system already requests reduced motion, so it stays on.</span>}
            </p>
          </div>
          <Switch id="reduce-motion" label="Reduce animations" checked={setting || os} onChange={(v) => { if (!os) set(v) }} />
        </div>
      </Card>
    </section>
  )
}

/** Compact topbar button that flips the same setting. */
export function MotionQuickToggle({ className }: { className?: string }) {
  const { reduced, os, set } = useMotionSetting()
  const label = reduced ? 'Animations reduced. Click to enable full animations' : 'Reduce animations'
  return (
    <Tooltip content={os ? 'Reduced motion is requested by your system' : label} side="bottom">
      <button
        type="button" aria-pressed={reduced} aria-label="Reduce animations" disabled={os}
        onClick={() => set(!reduced)}
        className={cn(
          'grid h-10 w-10 place-items-center rounded-r2 transition-colors hover:bg-white/[.06] disabled:cursor-not-allowed disabled:opacity-50',
          reduced ? 'text-accent-soft' : 'text-ink-3 hover:text-ink', className,
        )}
      >
        <Zap size={18} />
      </button>
    </Tooltip>
  )
}
