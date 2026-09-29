import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/** Read/patch URL search params (replace-style, so filtering never spams history). Empty/null values delete the key. */
export function useUrlParams() {
  const [params, setParams] = useSearchParams()
  const get = useCallback((k: string) => params.get(k), [params])
  const set = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            if (v == null || v === '') next.delete(k)
            else next.set(k, v)
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )
  return { params, get, set }
}
