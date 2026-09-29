import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { ScanModal } from './ScanModal'

export interface OpenScanOptions {
  /** jump straight into the animated demo pass */
  demo?: boolean
}
interface Ctx { openScan: (o?: OpenScanOptions) => void; closeScan: () => void; isOpen: boolean }
const C = createContext<Ctx | null>(null)

/** Hosts the single ScanModal instance. Call `useScanModal().openScan()` from any page. */
export function ScanModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [opts, setOpts] = useState<OpenScanOptions>({})
  const [nonce, setNonce] = useState(0)
  const openScan = useCallback((o: OpenScanOptions = {}) => { setOpts(o); setNonce((n) => n + 1); setOpen(true) }, [])
  const closeScan = useCallback(() => setOpen(false), [])
  const value = useMemo(() => ({ openScan, closeScan, isOpen: open }), [openScan, closeScan, open])
  return (
    <C.Provider value={value}>
      {children}
      <ScanModal key={nonce} open={open} onClose={closeScan} startWithDemo={!!opts.demo} />
    </C.Provider>
  )
}

export function useScanModal(): Ctx {
  const c = useContext(C)
  if (!c) throw new Error('useScanModal must be used inside <ScanModalProvider>')
  return c
}
