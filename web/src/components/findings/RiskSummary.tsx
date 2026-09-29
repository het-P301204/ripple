import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { Info } from 'lucide-react'
import type { Finding } from '@/types/scan'
import { CATEGORY_META } from '@/lib/meta'
import { fmtDate, fmtPercent } from '@/lib/format'
import { EASE } from '@/lib/motion'
import { RadialScore } from '@/components/ui/Progress'
import { SeverityBadge } from '@/components/ui/SeverityBadge'
import { Tooltip } from '@/components/ui/Tooltip'
import { CopyButton } from '@/components/ui/CopyButton'

function Hint({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip content={text}>
      <button type="button" aria-label={`About ${label}`} className="grid h-5 w-5 place-items-center rounded-full text-ink-4 transition-colors hover:text-ink-2">
        <Info size={13} />
      </button>
    </Tooltip>
  )
}

/** Risk summary card: animated radial "94/100", confidence meter, rule id, category, detection time. */
export function RiskSummary({ finding: f }: { finding: Finding }) {
  const reduced = !!useReducedMotion()
  return (
    <section aria-label="Risk summary" className="relative overflow-hidden rounded-r4 border border-white/[.08] bg-card p-6 shadow-card">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(70% 55% at 50% 0%, rgb(var(--c-accent) / .10), transparent 70%)' }} />
      <div className="relative flex flex-col items-center">
        <p className="eyebrow self-start">Risk summary</p>
        <div className="mt-3">
          <RadialScore value={f.risk_score} size={212} duration={1.1}>
            {(n) => (
              <div className="flex flex-col items-center">
                <span className="flex items-baseline">
                  <span className="text-[54px] font-semibold leading-none tracking-[-0.05em]" style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(n)}</span>
                  <span className="ml-0.5 text-[18px] font-medium text-ink-3">/100</span>
                </span>
                <span className="mt-2 flex items-center gap-1 text-[10.5px] font-semibold tracking-[.2em] text-ink-3">
                  RISK SCORE
                  <Hint label="risk score" text="A 0–100 score for this finding. It is the sum of the risk drivers listed below, each weighted by how much it raises the chance of a successful supply-chain compromise. Above 70 is high." />
                </span>
                <span className="mt-2"><SeverityBadge severity={f.severity} /></span>
              </div>
            )}
          </RadialScore>
        </div>
      </div>

      <dl className="relative mt-6 space-y-4 border-t border-white/[.06] pt-5 text-[13px]">
        <div>
          <dt className="flex items-center justify-between text-ink-3">
            <span className="inline-flex items-center gap-1">
              Confidence
              <Hint label="confidence" text="How sure RIPPLE is that the signal is real, based on how much registry evidence backs it. High risk with lower confidence is worth verifying by hand; missing registry data lowers confidence." />
            </span>
            <span className="tnum text-[14px] font-semibold text-ink">{fmtPercent(f.confidence)}</span>
          </dt>
          <dd className="mt-2">
            <div
              role="progressbar" aria-label="Detection confidence" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f.confidence * 100)}
              className="h-1.5 overflow-hidden rounded-full bg-white/[.06]"
            >
              <motion.div
                className="h-full rounded-full" style={{ background: 'linear-gradient(90deg, rgb(var(--c-accent)), rgb(var(--c-magenta-soft)))', transformOrigin: 'left', width: `${f.confidence * 100}%` }}
                initial={{ scaleX: reduced ? 1 : 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.9, delay: 0.3, ease: EASE }}
              />
            </div>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-3">Rule</dt>
          <dd className="mono flex items-center gap-1 text-[12.5px] text-ink"><span>{f.rule_id}</span><CopyButton value={f.rule_id} label="Copy rule id" /></dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-3">Category</dt>
          <dd className="text-right text-ink-2">{CATEGORY_META[f.category].label}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-3">Detected</dt>
          <dd className="text-right text-ink-2">{fmtDate(f.detected_at)}</dd>
        </div>
      </dl>
    </section>
  )
}
