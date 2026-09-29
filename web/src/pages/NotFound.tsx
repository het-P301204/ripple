import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { Compass, History, ShieldAlert } from 'lucide-react'
import { StateGlyph } from '@/components/ui/States'
import { LinkButton } from '@/components/ui/Button'
import { RippleRings } from '@/components/brand/RippleRings'
import { EASE } from '@/lib/motion'

/** 404. The glyph sits at the centre of the same ripple rings used on the overview hero. */
export default function NotFound() {
  const { pathname } = useLocation()
  const reduced = !!useReducedMotion()
  const path = pathname.length > 48 ? `${pathname.slice(0, 47)}…` : pathname
  return (
    <div className="relative mx-auto flex max-w-xl flex-col items-center overflow-hidden px-4 py-16 text-center md:py-24">
      <div className="relative grid h-[140px] w-[140px] place-items-center">
        <RippleRings size={420} rings={3} period={9} maxOpacity={0.3} color="rgb(var(--c-amber))" />
        <StateGlyph size={104} broken tone="amber" />
      </div>

      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
        className="relative flex flex-col items-center"
      >
        <p className="eyebrow mt-8">Error 404</p>
        <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.03em] md:text-[34px]">Nothing here</h1>
        <p className="mt-3 max-w-md text-[14px] leading-relaxed text-ink-3">
          That page doesn’t exist, or the finding it pointed to isn’t part of the loaded scan.
        </p>
        <p className="mono mt-4 max-w-full truncate rounded-r1 border border-white/[.07] bg-white/[.03] px-3 py-1.5 text-[12.5px] text-ink-3" title={pathname}>
          {path}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <LinkButton to="/" variant="primary" leading={<Compass size={16} aria-hidden />}>Back to overview</LinkButton>
          <LinkButton to="/findings" variant="secondary" leading={<ShieldAlert size={16} aria-hidden />}>Browse findings</LinkButton>
          <LinkButton to="/history" variant="ghost" leading={<History size={16} aria-hidden />}>Scan history</LinkButton>
        </div>
      </motion.div>
    </div>
  )
}
