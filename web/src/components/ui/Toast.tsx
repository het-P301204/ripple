import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { tween } from '@/lib/motion'

type ToastTone = 'success' | 'error' | 'info'
interface ToastItem { id: number; tone: ToastTone; title: string; detail?: string }
interface ToastApi {
  toast: (t: { tone?: ToastTone; title: string; detail?: string; duration?: number }) => void
  success: (title: string, detail?: string) => void
  error: (title: string, detail?: string) => void
  info: (title: string, detail?: string) => void
}

const Ctx = createContext<ToastApi | null>(null)
let seq = 0

/** Wrap the app once. Use `useToast()` anywhere below. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const reduced = !!useReducedMotion()
  const dismiss = useCallback((id: number) => setItems((s) => s.filter((t) => t.id !== id)), [])
  const toast = useCallback<ToastApi['toast']>(({ tone = 'info', title, detail, duration = 4200 }) => {
    const id = ++seq
    setItems((s) => [...s.slice(-3), { id, tone, title, detail }])
    window.setTimeout(() => dismiss(id), duration)
  }, [dismiss])
  const api = useMemo<ToastApi>(() => ({
    toast,
    success: (title, detail) => toast({ tone: 'success', title, detail }),
    error: (title, detail) => toast({ tone: 'error', title, detail, duration: 6000 }),
    info: (title, detail) => toast({ tone: 'info', title, detail }),
  }), [toast])
  const Icon = { success: CheckCircle2, error: AlertTriangle, info: Info }
  const color = { success: 'text-ok', error: 'text-sev-critical', info: 'text-accent-soft' }
  return (
    <Ctx.Provider value={api}>
      {children}
      <div aria-live="polite" aria-relevant="additions" role="status" className="pointer-events-none fixed bottom-4 right-4 z-[110] flex w-[min(92vw,360px)] flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map((t) => {
            const I = Icon[t.tone]
            return (
              <motion.div
                key={t.id} layout={!reduced} role={t.tone === 'error' ? 'alert' : undefined}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1, transition: tween(0.28) }}
                exit={{ opacity: 0, transition: { duration: 0.16 } }}
                className="pointer-events-auto flex items-start gap-3 rounded-r3 border border-white/[.1] bg-elevated p-3.5 shadow-pop"
              >
                <I size={18} className={cn('mt-0.5 shrink-0', color[t.tone])} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink">{t.title}</p>
                  {t.detail && <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{t.detail}</p>}
                </div>
                <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="grid h-6 w-6 place-items-center rounded-md text-ink-3 hover:bg-white/[.06] hover:text-ink">
                  <X size={14} />
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastApi {
  const c = useContext(Ctx)
  if (!c) throw new Error('useToast must be used inside <ToastProvider>')
  return c
}
