import { useState } from 'react'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { FlaskConical, Lock, ScanSearch } from 'lucide-react'
import { ECOSYSTEMS, ECOSYSTEM_META } from '@/lib/meta'
import { EASE } from '@/lib/motion'
import { Button } from '@/components/ui/Button'
import { EcosystemMark } from '@/components/ui/EcosystemPill'
import { useScanModal } from '@/components/scan/ScanModalContext'
import { NetworkBackdrop } from './NetworkBackdrop'

/** No-scan landing: the thesis, two CTAs, and what RIPPLE can read. Not a dashboard. */
export function Landing() {
  const { openScan } = useScanModal()
  const reduced = !!useReducedMotion()
  const [burst, setBurst] = useState(0)

  const go = (demo: boolean) => {
    setBurst((b) => b + 1)
    window.setTimeout(() => openScan({ demo }), reduced ? 0 : 240)
  }
  const rise = (i: number) => reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, delay: 0.03 + i * 0.05, ease: EASE } }

  return (
    <div className="relative -mx-5 md:-mx-8">
      <div className="pointer-events-none absolute inset-x-0 -top-14 h-[640px] overflow-hidden md:-top-16">
        <NetworkBackdrop burst={burst} className="h-full w-full" />
      </div>

      <section className="relative px-5 pb-16 pt-14 md:px-8 md:pb-24 md:pt-24">
        <motion.p {...rise(0)} className="eyebrow mb-5 flex items-center gap-2.5">
          <span className="h-px w-8 bg-accent-soft/60" aria-hidden /> Software supply-chain scanner
        </motion.p>
        <motion.h1 {...rise(1)} className="max-w-[16ch] text-[40px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[52px] md:text-[64px]">
          Map your software supply-chain attack surface.
        </motion.h1>
        <motion.p {...rise(2)} className="mt-6 max-w-xl text-[16px] leading-relaxed text-ink-2 md:text-[17px]">
          Analyze lockfiles for dependency confusion, typosquatting, and package-risk signals.
        </motion.p>
        <motion.div {...rise(3)} className="mt-9 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="lg" leading={<ScanSearch size={18} />} onClick={() => go(false)}>Start New Scan</Button>
          <Button variant="secondary" size="lg" leading={<FlaskConical size={18} />} onClick={() => go(true)}>Load Demo Dataset</Button>
        </motion.div>
        <motion.p {...rise(4)} className="mt-6 flex items-center gap-2 text-[12.5px] text-ink-3">
          <Lock size={13} aria-hidden /> Read-only. RIPPLE never installs, runs, or publishes a package.
        </motion.p>
      </section>

      <section className="relative px-5 pb-6 md:px-8" aria-label="Supported ecosystems">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {ECOSYSTEMS.map((e, i) => {
            const m = ECOSYSTEM_META[e]
            return (
              <motion.div
                key={e}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.25 + i * 0.04, ease: EASE }}
                className="group rounded-r3 border border-hair bg-card p-5 shadow-card transition-[border-color,transform] duration-comp ease-ripple hover:-translate-y-0.5 hover:border-white/[.14]"
              >
                <div className="flex items-center justify-between">
                  <div className="grid h-10 w-10 place-items-center rounded-r2 border border-white/[.08] bg-white/[.03]"><EcosystemMark ecosystem={e} size={22} /></div>
                  <span className="mono text-[11px] text-ink-4">{m.registry}</span>
                </div>
                <h3 className="mt-4 text-[16px] font-semibold tracking-[-0.02em]">{m.label}</h3>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {m.lockfiles.map((f) => (
                    <li key={f} className="mono rounded-md border border-white/[.07] bg-black/25 px-2 py-1 text-[11.5px] text-ink-2">{f}</li>
                  ))}
                </ul>
              </motion.div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
