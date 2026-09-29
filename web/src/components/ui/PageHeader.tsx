import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { CountUp } from './CountUp'
import { Card } from './Card'

/** Page title block: eyebrow, title, subtitle, meta row and a primary action slot. */
export function PageHeader({
  title, subtitle, actions, meta, eyebrow, className,
}: { title: string; subtitle?: ReactNode; actions?: ReactNode; meta?: ReactNode; eyebrow?: ReactNode; className?: string }) {
  return (
    <header className={cn('flex flex-col gap-4 pb-6 pt-2 sm:flex-row sm:items-end sm:justify-between md:pb-8', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] md:text-[30px]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-ink-3">{subtitle}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-ink-3">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Titled group of content on a page. */
export function Section({
  title, description, action, children, className,
}: { title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('mt-10 first:mt-0', className)}>
      {(title || action) && (
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            {title && <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>}
            {description && <p className="mt-1 text-[13px] text-ink-3">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export interface StatCardProps {
  label: string
  value: number | string
  /** one-line description under the number */
  description?: string
  /** small contextual line (e.g. "12 of 187") */
  context?: ReactNode
  /** tiny visual indicator: <Sparkline/>, <MicroBar/>, icon… shown top-right */
  indicator?: ReactNode
  icon?: ReactNode
  to?: string
  delay?: number
  accent?: string
}

/** Key-metric card: label, big number (count-up), description, context, indicator. Optional link. */
export function StatCard({ label, value, description, context, indicator, icon, to, delay = 0, accent }: StatCardProps) {
  const reduced = !!useReducedMotion()
  const body = (
    <Card
      interactive={!!to}
      radius={3}
      className="group flex h-full flex-col overflow-hidden p-5"
      style={accent ? ({ ['--stat-accent' as string]: accent } as React.CSSProperties) : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-ink-3">
          {icon}
          <span className="eyebrow !normal-case !tracking-[.02em] text-[12.5px]">{label}</span>
        </div>
        {to && <ArrowUpRight size={15} className="text-ink-4 opacity-0 transition-opacity duration-comp group-hover:opacity-100" aria-hidden />}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="text-[34px] font-semibold leading-none tracking-[-0.035em]">
          {typeof value === 'number' ? <CountUp value={value} duration={0.9} delay={delay} /> : value}
        </div>
        {indicator && <div className="pb-1">{indicator}</div>}
      </div>
      {description && <p className="mt-3 text-[13px] leading-snug text-ink-2">{description}</p>}
      {context && <div className="mt-auto pt-2 text-[12px] text-ink-3">{context}</div>}
    </Card>
  )
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }} className="h-full"
    >
      {to ? <Link to={to} className="block h-full rounded-r3" aria-label={`${label}: ${value}`}>{body}</Link> : body}
    </motion.div>
  )
}
