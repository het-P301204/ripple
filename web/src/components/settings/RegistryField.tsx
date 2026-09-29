import { RotateCcw } from 'lucide-react'
import type { Ecosystem, Health } from '@/types/scan'
import { DEFAULT_REGISTRIES, isPlainHttp } from '@/lib/settings'
import { EcosystemMark } from '@/components/ui/EcosystemPill'
import { Input } from '@/components/ui/Input'
import { Field, describedBy } from './controls'
import { cn } from '@/lib/cn'

const NAME: Record<Ecosystem, string> = { npm: 'npm registry', pypi: 'PyPI', go: 'Go module proxy', rust: 'crates.io' }
const WHAT: Record<Ecosystem, string> = {
  npm: 'Used for package-lock.json and yarn.lock lookups.',
  pypi: 'Used for requirements.txt, Pipfile.lock and pyproject.toml lookups.',
  go: 'Used for go.mod and go.sum lookups.',
  rust: 'Used for Cargo.lock lookups.',
}

type Conn = { tone: 'ok' | 'warn' | 'idle'; text: string }

function connectivity(eco: Ecosystem, url: string, health: Health | null, apiOnline: boolean | null): Conn {
  if (apiOnline === false || !health) return { tone: 'idle', text: 'Server offline — connectivity can’t be checked.' }
  const h = health.registries?.[eco]
  if (!h) return { tone: 'idle', text: 'Connectivity not reported.' }
  const stale = h.url.replace(/\/+$/, '') !== url.trim().replace(/\/+$/, '')
  const suffix = stale ? ' (checked against the saved URL)' : ''
  if (h.state === 'ok') return { tone: 'ok', text: `Reachable from this server${suffix}.` }
  if (h.state === 'unreachable') return { tone: 'warn', text: `Not reachable from this server${suffix}. Live scans will fall back to local analysis.` }
  return { tone: 'idle', text: `Not checked${suffix}. RIPPLE only contacts registries during live scans.` }
}

export function RegistryField({
  eco, value, onChange, error, health, apiOnline,
}: {
  eco: Ecosystem
  value: string
  onChange: (v: string) => void
  error?: string
  health: Health | null
  apiOnline: boolean | null
}) {
  const id = `reg-${eco}`
  const isDefault = value.trim().replace(/\/+$/, '') === DEFAULT_REGISTRIES[eco]
  const conn = connectivity(eco, value, health, apiOnline)
  return (
    <Field
      id={id}
      label={<span className="inline-flex items-center gap-2"><EcosystemMark ecosystem={eco} size={15} /> {NAME[eco]}</span>}
      action={
        <button
          type="button" disabled={isDefault} onClick={() => onChange(DEFAULT_REGISTRIES[eco])}
          aria-label={`Reset ${NAME[eco]} to default`}
          className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] text-ink-3 transition-colors duration-micro hover:bg-white/[.06] hover:text-ink disabled:pointer-events-none disabled:opacity-35"
        >
          <RotateCcw size={12} aria-hidden /> Reset to default
        </button>
      }
      help={
        <>
          {WHAT[eco]}{' '}
          <span className="inline-flex items-center gap-1.5 align-middle">
            <span
              aria-hidden
              className={cn('inline-block h-1.5 w-1.5 rounded-full', conn.tone === 'ok' && 'bg-ok', conn.tone === 'warn' && 'bg-amber', conn.tone === 'idle' && 'bg-ink-4')}
            />
            <span className={cn(conn.tone === 'warn' && 'text-amber')}>{conn.text}</span>
          </span>
          {isPlainHttp(value) && !error && <span className="mt-1 block text-amber">This URL uses plain http, so registry responses could be tampered with in transit.</span>}
        </>
      }
      error={error}
    >
      <Input
        id={id} mono type="url" inputMode="url" spellCheck={false} autoComplete="off"
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={DEFAULT_REGISTRIES[eco]}
        aria-invalid={!!error || undefined} aria-describedby={describedBy(id, !!error)}
        className="aria-[invalid=true]:!border-sev-critical/50"
      />
    </Field>
  )
}
