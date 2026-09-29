import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { CloudOff, FileOutput, Globe2, HardDrive, Info, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import type { Ecosystem, Settings as SettingsT } from '@/types/scan'
import { useScan } from '@/hooks/useScan'
import { ECOSYSTEMS } from '@/lib/meta'
import {
  CACHE_PRESETS, DEFAULT_SETTINGS, LIMITS, hasErrors, loadSettings, normalizeSettings, persistSettings,
  settingsEqual, validateSettings, type SettingsSource,
} from '@/lib/settings'
import { ApiError } from '@/lib/api'
import { EASE } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Input'
import { Mono } from '@/components/ui/CopyButton'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { Tooltip } from '@/components/ui/Tooltip'
import { Field, RadioSegmented, SettingRow, describedBy } from '@/components/settings/controls'
import { NumInput } from '@/components/settings/NumInput'
import { RegistryField } from '@/components/settings/RegistryField'
import { SaveBar } from '@/components/settings/SaveBar'
import { SectionNav, type SectionDef } from '@/components/settings/SectionNav'
import { TagInput } from '@/components/settings/TagInput'
import { MotionToggle } from '@/components/settings/MotionToggle'
import { ThresholdControl } from '@/components/settings/ThresholdControl'
import '@/components/settings/settings.css'

const SECTIONS: SectionDef[] = [
  { id: 'registries', label: 'Registries', icon: <Globe2 size={16} /> },
  { id: 'scanner', label: 'Scanner', icon: <SlidersHorizontal size={16} /> },
  { id: 'output', label: 'Output', icon: <FileOutput size={16} /> },
  { id: 'about', label: 'About', icon: <Info size={16} /> },
]

const FORMATS: Array<{ value: SettingsT['output']['default_format']; label: string; blurb: string }> = [
  { value: 'rich', label: 'Rich', blurb: 'A colour terminal report with tables, risk bar and top findings.' },
  { value: 'json', label: 'JSON', blurb: 'The complete scan result for scripts and dashboards.' },
  { value: 'sarif', label: 'SARIF', blurb: 'SARIF 2.1.0 for GitHub code scanning and other CI tools.' },
  { value: 'csv', label: 'CSV', blurb: 'One row per finding, ready for a spreadsheet.' },
]

/** Count of individual settings that differ between two snapshots. */
function countChanges(a: SettingsT, b: SettingsT): number {
  let n = 0
  ECOSYSTEMS.forEach((k) => { if (a.registries[k].trim() !== b.registries[k].trim()) n++ })
  const sa = a.scanner, sb = b.scanner
  ;(['max_edit_distance', 'rate_limit_rps', 'timeout_s', 'cache_ttl_s'] as const).forEach((k) => { if (sa[k] !== sb[k]) n++ })
  ;(['critical', 'high', 'medium', 'low'] as const).forEach((k) => { if (sa.thresholds[k] !== sb.thresholds[k]) n++ })
  if (JSON.stringify(sa.internal_scopes) !== JSON.stringify(sb.internal_scopes)) n++
  if (a.output.default_format !== b.output.default_format) n++
  return n
}

function SettingsCard({ id, icon, title, description, children }: { id: string; icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} tabIndex={-1} aria-labelledby={`${id}-title`} className="scroll-mt-[calc(var(--topbar-h)+20px)] outline-none">
      <Card radius={4} className="p-5 md:p-7">
        <header className="mb-6 flex items-start gap-3.5">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-r2 border border-white/[.08] bg-white/[.035] text-accent-soft">{icon}</span>
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-[16px] font-semibold tracking-[-0.015em]">{title}</h2>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{description}</p>
          </div>
        </header>
        {children}
      </Card>
    </section>
  )
}

export default function SettingsPage() {
  const { scan, health, apiOnline } = useScan()
  const toast = useToast()
  const reduced = !!useReducedMotion()
  const [saved, setSaved] = useState<SettingsT | null>(null)
  const [draft, setDraft] = useState<SettingsT>(DEFAULT_SETTINGS)
  const [source, setSource] = useState<SettingsSource>('default')
  const [saving, setSaving] = useState(false)
  const [tried, setTried] = useState(false)
  const draftRef = useRef(draft)
  draftRef.current = draft

  useEffect(() => {
    let alive = true
    void loadSettings().then((r) => {
      if (!alive) return
      setSaved(r.settings); setDraft(r.settings); setSource(r.source)
    })
    return () => { alive = false }
  }, [])

  const errors = useMemo(() => validateSettings(draft), [draft])
  const errorCount =
    Object.keys(errors.registries).length + (errors.rate_limit_rps ? 1 : 0) + (errors.timeout_s ? 1 : 0) + (errors.cache_ttl_s ? 1 : 0) + (errors.thresholds ? 1 : 0)
  const dirty = !!saved && !settingsEqual(draft, saved)
  const changes = saved ? countChanges(draft, saved) : 0

  const patch = useCallback((fn: (d: SettingsT) => SettingsT) => setDraft((d) => fn(d)), [])
  const setScanner = <K extends keyof SettingsT['scanner']>(k: K, v: SettingsT['scanner'][K]) =>
    patch((d) => ({ ...d, scanner: { ...d.scanner, [k]: v } }))

  const save = useCallback(async () => {
    const d = draftRef.current
    if (hasErrors(validateSettings(d))) { setTried(true); return }
    setSaving(true)
    try {
      const r = await persistSettings(normalizeSettings(d))
      setSaved(r.settings); setDraft(r.settings); setSource(r.source === 'local' ? 'local' : 'server'); setTried(false)
      if (r.source === 'server') toast.success('Settings saved', 'They apply to your next scan.')
      else toast.success('Saved locally', 'The RIPPLE server isn’t reachable, so these are stored in this browser.')
    } catch (e) {
      toast.error('Couldn’t save settings', e instanceof ApiError ? e.message : undefined)
    } finally { setSaving(false) }
  }, [toast])

  const discard = useCallback(() => { if (saved) { setDraft(saved); setTried(false) } }, [saved])

  // Ctrl/Cmd+S saves while there are unsaved changes; warn before closing the tab with pending edits.
  useEffect(() => {
    if (!dirty) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save() }
    }
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', onUnload)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload) }
  }, [dirty, save])

  const showErr = <T,>(v: T | undefined) => (tried || dirty ? v : undefined)
  const fmt = FORMATS.find((f) => f.value === draft.output.default_format) ?? FORMATS[0]
  const cachePresets = CACHE_PRESETS.some((p) => p.value === draft.scanner.cache_ttl_s)
    ? CACHE_PRESETS
    : [...CACHE_PRESETS, { value: draft.scanner.cache_ttl_s, label: `Custom (${draft.scanner.cache_ttl_s}s)` }].sort((a, b) => a.value - b.value)
  const ratePct = ((Math.min(LIMITS.rate.max, Math.max(LIMITS.rate.min, draft.scanner.rate_limit_rps)) - LIMITS.rate.min) / (LIMITS.rate.max - LIMITS.rate.min)) * 100

  const storedLocally = source === 'local' || (apiOnline === false && source === 'default')

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        subtitle="Registries, scanner behaviour and output. Changes apply to your next scan; scans you’ve already run are never altered."
        meta={
          <>
            {storedLocally ? (
              <Tooltip content="RIPPLE’s local server isn’t reachable, so settings are stored in this browser and will sync the next time you save while it’s running.">
                <span tabIndex={0} className="inline-flex items-center gap-1.5 rounded-md text-amber outline-none">
                  {source === 'local' ? <HardDrive size={13} aria-hidden /> : <CloudOff size={13} aria-hidden />}
                  {source === 'local' ? 'Saved locally' : 'Server offline · using defaults'}
                </span>
              </Tooltip>
            ) : (
              <span className="inline-flex items-center gap-1.5"><ShieldCheck size={13} aria-hidden /> Stored by your local RIPPLE server</span>
            )}
          </>
        }
      />

      <div className="grid gap-10 pb-16 lg:grid-cols-[176px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)]">
        <SectionNav sections={SECTIONS} />

        {!saved ? (
          <div className="space-y-6" role="status" aria-label="Loading settings">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-r4 border border-hair bg-card p-7">
                <div className="flex items-center gap-3.5"><Skeleton className="h-10 w-10 rounded-r2" /><div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-64" /></div></div>
                <Skeleton className="mt-6 h-10 w-full rounded-r2" /><Skeleton className="mt-4 h-10 w-full rounded-r2" />
              </div>
            ))}
          </div>
        ) : (
          <motion.div
            className="min-w-0 max-w-[880px] space-y-6"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }}
          >
            {/* ------------------------------ Registries ------------------------------ */}
            <SettingsCard id="registries" icon={<Globe2 size={18} />} title="Registry settings" description="Where RIPPLE looks up public package records. Only GET requests are ever sent, and only during live scans.">
              <div className="space-y-6">
                {ECOSYSTEMS.map((eco: Ecosystem) => (
                  <RegistryField
                    key={eco} eco={eco} value={draft.registries[eco]} health={health} apiOnline={apiOnline}
                    error={showErr(errors.registries[eco])}
                    onChange={(v) => patch((d) => ({ ...d, registries: { ...d.registries, [eco]: v } }))}
                  />
                ))}
              </div>
            </SettingsCard>

            {/* ------------------------------- Scanner -------------------------------- */}
            <SettingsCard id="scanner" icon={<SlidersHorizontal size={18} />} title="Scanner settings" description="How aggressively RIPPLE looks for lookalikes, how politely it queries registries, and what counts as critical.">
              <SettingRow
                id="lbl-distance" title="Typosquatting distance"
                description="How many single-character edits away from a popular package still counts as a lookalike."
              >
                <RadioSegmented
                  ariaLabelledBy="lbl-distance" describedById="distance-help"
                  value={draft.scanner.max_edit_distance} onChange={(v) => setScanner('max_edit_distance', v)}
                  options={[{ value: 1, label: '1 edit' }, { value: 2, label: '2 edits' }, { value: 3, label: '3 edits' }]}
                />
                <p id="distance-help" className="mt-2 text-[12px] leading-relaxed text-ink-3">
                  {draft.scanner.max_edit_distance === 1 && 'Catches one-keystroke variants such as requets. Fewest false positives.'}
                  {draft.scanner.max_edit_distance === 2 && 'Recommended. Also catches swapped or doubled characters such as reqquests.'}
                  {draft.scanner.max_edit_distance === 3 && 'Broadest net. Expect more candidates to review, especially for short package names.'}
                </p>
              </SettingRow>

              <SettingRow title="Rate limit" id="lbl-rate" description="Maximum registry requests per second across all ecosystems. Lower it for shared networks or private mirrors.">
                <Field id="rate" label={<span className="sr-only">Rate limit in requests per second</span>} error={showErr(errors.rate_limit_rps)}>
                  <div className="flex items-center gap-4">
                    <input
                      type="range" className="rp-range min-w-0 flex-1" aria-labelledby="lbl-rate" aria-valuetext={`${draft.scanner.rate_limit_rps} requests per second`}
                      min={LIMITS.rate.min} max={LIMITS.rate.max} step={0.5}
                      value={Math.min(LIMITS.rate.max, Math.max(LIMITS.rate.min, draft.scanner.rate_limit_rps))}
                      style={{ ['--pct' as string]: `${ratePct}%` }}
                      onChange={(e) => setScanner('rate_limit_rps', e.target.valueAsNumber)}
                    />
                    <NumInput
                      id="rate" className="w-[118px] shrink-0" suffix="req/s" step={0.5} min={LIMITS.rate.min} max={LIMITS.rate.max}
                      value={draft.scanner.rate_limit_rps} onChange={(n) => setScanner('rate_limit_rps', n)}
                      invalid={!!showErr(errors.rate_limit_rps)} describedById={errors.rate_limit_rps ? 'rate-err' : undefined}
                    />
                  </div>
                </Field>
              </SettingRow>

              <SettingRow title="Request timeout" description="How long RIPPLE waits for a single registry response before recording it as unavailable.">
                <Field id="timeout" label={<span className="sr-only">Timeout in seconds</span>} error={showErr(errors.timeout_s)}>
                  <NumInput
                    id="timeout" className="max-w-[160px]" suffix="sec" step={1} min={LIMITS.timeout.min} max={LIMITS.timeout.max}
                    value={draft.scanner.timeout_s} onChange={(n) => setScanner('timeout_s', n)}
                    invalid={!!showErr(errors.timeout_s)} describedById={errors.timeout_s ? 'timeout-err' : undefined}
                  />
                </Field>
              </SettingRow>

              <SettingRow title="Cache duration" description="How long registry answers are reused from ~/.ripple/cache before being fetched again.">
                <Field id="cache" label={<span className="sr-only">Cache duration</span>} error={showErr(errors.cache_ttl_s)}>
                  <Select
                    id="cache" value={String(draft.scanner.cache_ttl_s)} onChange={(e) => setScanner('cache_ttl_s', Number(e.target.value))}
                    options={cachePresets.map((p) => ({ value: String(p.value), label: p.label }))}
                    aria-describedby={errors.cache_ttl_s ? 'cache-err' : undefined}
                  />
                </Field>
              </SettingRow>

              <div className="border-t border-white/[.05] py-5">
                <h3 id="lbl-thresholds" className="text-[13.5px] font-medium tracking-normal text-ink">Risk thresholds</h3>
                <p className="mb-2 mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-3">
                  Minimum score for each severity. Drag a handle, use the arrow keys (Shift for ±5), or type an exact value. Handles can’t cross.
                </p>
                <ThresholdControl
                  value={draft.scanner.thresholds} onChange={(t) => setScanner('thresholds', t)}
                  scan={scan} labelledBy="lbl-thresholds" error={showErr(errors.thresholds)}
                />
              </div>

              <SettingRow title="Internal scopes and prefixes" id="lbl-scopes" description="Names that belong to your organisation. RIPPLE treats matching packages as internal and checks whether a public registry could shadow them.">
                <Field id="scopes" label={<span className="sr-only">Internal scopes and prefixes</span>} help={<>Scopes such as <Mono>@acme</Mono> and prefixes such as <Mono>acme-</Mono>. Press Enter or comma to add.</>}>
                  <TagInput
                    id="scopes" value={draft.scanner.internal_scopes} onChange={(v) => setScanner('internal_scopes', v)}
                    placeholder="@acme, acme-" describedById="scopes-help"
                  />
                </Field>
              </SettingRow>
            </SettingsCard>

            {/* -------------------------------- Output -------------------------------- */}
            <SettingsCard id="output" icon={<FileOutput size={18} />} title="Output" description="The format the CLI uses when you don’t pass --format.">
              <SettingRow id="lbl-format" title="Default report format" description="The dashboard export menu always offers every format.">
                <RadioSegmented
                  ariaLabelledBy="lbl-format" describedById="format-help"
                  value={draft.output.default_format} onChange={(v) => patch((d) => ({ ...d, output: { default_format: v } }))}
                  options={FORMATS.map((f) => ({ value: f.value, label: f.label }))}
                />
                <p id="format-help" className="mt-2 text-[12px] leading-relaxed text-ink-3">{fmt.blurb}</p>
                <div className="mt-3 rounded-r2 border border-white/[.06] bg-black/25 px-3.5 py-2.5">
                  <Mono block copy={`ripple report latest --format ${fmt.value}`} className="text-[12.5px] text-ink-2">
                    <span className="text-ink-4">$ </span>ripple report latest --format {fmt.value}
                  </Mono>
                </div>
              </SettingRow>
            </SettingsCard>

            <MotionToggle />

            {/* -------------------------------- About --------------------------------- */}
            <SettingsCard id="about" icon={<Info size={18} />} title="About" description="This RIPPLE installation.">
              <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <AboutItem label="Version"><Mono>{health?.version ?? scan?.version ?? '—'}</Mono></AboutItem>
                <AboutItem label="Mode">
                  <Badge tone={health?.mode === 'live' ? 'accent' : 'neutral'}>{health ? (health.mode === 'live' ? 'Live registries' : 'Offline analysis') : 'Unknown'}</Badge>
                </AboutItem>
                <AboutItem label="Server">
                  {apiOnline === false ? <Badge tone="amber" icon={<CloudOff size={12} />}>Not reachable</Badge> : apiOnline ? <Badge tone="ok">Running locally</Badge> : <span className="text-ink-3">Checking…</span>}
                </AboutItem>
                <AboutItem label="Data location"><Mono>~/.ripple</Mono></AboutItem>
              </dl>
              <div className="mt-6 flex items-start gap-3 rounded-r3 border border-accent/20 bg-accent/[.05] p-4">
                <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent-soft" aria-hidden />
                <div>
                  <p className="text-[13.5px] font-medium text-ink">Read-only by design</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
                    RIPPLE sends GET and HEAD requests only. It never registers, publishes, installs or executes a package, and it never modifies your lockfiles. Use it for authorised security assessment of software you’re responsible for.
                  </p>
                </div>
              </div>
            </SettingsCard>
          </motion.div>
        )}
      </div>

      <SaveBar open={dirty} changes={changes} errorCount={errorCount} saving={saving} onSave={() => void save()} onDiscard={discard} />
    </>
  )
}

function AboutItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={cn('min-w-0')}>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1.5 text-[13.5px] text-ink">{children}</dd>
    </div>
  )
}
