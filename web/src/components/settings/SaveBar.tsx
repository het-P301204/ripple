import { AnimatePresence, motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { EASE } from '@/lib/motion'

/** "Unsaved changes" bar. Slides up from the bottom of the content area; Save is blocked while there are errors. */
export function SaveBar({
  open, changes, errorCount, saving, onSave, onDiscard,
}: { open: boolean; changes: number; errorCount: number; saving: boolean; onSave: () => void; onDiscard: () => void }) {
  const reduced = !!useReducedMotion()
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="region" aria-label="Unsaved changes"
          initial={reduced ? { opacity: 0 } : { y: 72, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduced ? { opacity: 0 } : { y: 72, opacity: 0 }}
          transition={{ duration: 0.34, ease: EASE }}
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-3 pb-4 lg:pl-[calc(var(--sidebar-w)+12px)]"
        >
          <div className="pointer-events-auto flex w-full max-w-[720px] flex-wrap items-center gap-x-4 gap-y-3 rounded-r4 border border-white/[.12] bg-elevated py-3 pl-5 pr-3 shadow-pop">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="relative grid h-2 w-2 place-items-center" aria-hidden>
                <span className="absolute h-2 w-2 rounded-full bg-amber" />
              </span>
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-ink">Unsaved changes</p>
                <p className="text-[12px] text-ink-3" role="status">
                  {errorCount > 0
                    ? `Fix ${errorCount} ${errorCount === 1 ? 'field' : 'fields'} to save.`
                    : <>{changes} {changes === 1 ? 'setting' : 'settings'} changed <span className="hidden sm:inline">· <Kbd>Ctrl</Kbd> <Kbd>S</Kbd> to save</span></>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onDiscard} disabled={saving}>Discard</Button>
              <Button variant="primary" onClick={onSave} loading={saving} disabled={errorCount > 0} leading={<Check size={15} aria-hidden />}>Save changes</Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
