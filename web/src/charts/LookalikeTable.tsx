import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import type { LookalikeCandidate, LookalikeGroup } from '@/types/scan'
import { SEVERITY_RANK } from '@/lib/meta'
import { fmtDate, fmtNumber, fmtPercent } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui/Badge'
import { Segmented } from '@/components/ui/Segmented'
import { SeverityBadge } from '@/components/ui/SeverityBadge'
import { Table, TableContainer, TBody, Td, Th, THead, Tr } from '@/components/ui/Table'
import { CharDiff } from './CharDiff'
import { mutationInfo } from './lookalike'

type SortKey = 'name' | 'severity' | 'similarity' | 'distance' | 'registered' | 'downloads' | 'score'
type Filter = 'all' | 'registered' | 'unregistered'

const value = (c: LookalikeCandidate, k: SortKey): number | string => {
  switch (k) {
    case 'name': return c.name
    case 'severity': return SEVERITY_RANK[c.severity]
    case 'similarity': return c.similarity
    case 'distance': return c.distance
    case 'registered': return c.registered_at ? Date.parse(c.registered_at) : 0
    case 'downloads': return c.weekly_downloads ?? -1
    case 'score': return c.suspicion_score
  }
}

function SortTh({ k, label, sort, dir, onSort, align }: { k: SortKey; label: string; sort: SortKey; dir: 'asc' | 'desc'; onSort: (k: SortKey) => void; align?: 'left' | 'right' }) {
  const active = sort === k
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <Th align={align} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button" onClick={() => onSort(k)}
        className={cn('inline-flex items-center gap-1 rounded-md py-1 uppercase tracking-[.09em] transition-colors hover:text-ink', active && 'text-ink')}
      >
        {label} <Icon size={12} aria-hidden className={active ? 'text-accent-soft' : 'text-ink-4'} />
      </button>
    </Th>
  )
}

/** Every lookalike of the selected original, sortable, with a registered / unregistered toggle. */
export function LookalikeTable({
  group, selected, onSelect,
}: { group: LookalikeGroup; selected: string | null; onSelect: (name: string) => void }) {
  const [sort, setSort] = useState<SortKey>('score')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [filter, setFilter] = useState<Filter>('all')

  const counts = useMemo(() => ({
    all: group.candidates.length,
    registered: group.candidates.filter((c) => c.registered).length,
    unregistered: group.candidates.filter((c) => !c.registered).length,
  }), [group])

  const rows = useMemo(() => {
    const list = group.candidates.filter((c) => filter === 'all' || (filter === 'registered') === c.registered)
    const sign = dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      const x = value(a, sort), y = value(b, sort)
      const cmp = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)
      return cmp * sign || b.suspicion_score - a.suspicion_score || a.name.localeCompare(b.name)
    })
  }, [group, sort, dir, filter])

  const onSort = (k: SortKey) => {
    if (k === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSort(k); setDir(k === 'name' || k === 'distance' ? 'asc' : 'desc') }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em]">All lookalikes of <span className="mono">{group.original}</span></h3>
        <Segmented<Filter>
          size="sm" ariaLabel="Registration status"
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'registered', label: 'Registered', count: counts.registered },
            { value: 'unregistered', label: 'Unregistered', count: counts.unregistered },
          ]}
          value={filter} onChange={setFilter}
        />
      </div>
      <TableContainer>
        <Table aria-label={`Lookalikes of ${group.original}`}>
          <THead>
            <Tr className="h-11 hover:bg-transparent">
              <SortTh k="name" label="Lookalike" sort={sort} dir={dir} onSort={onSort} />
              <SortTh k="severity" label="Severity" sort={sort} dir={dir} onSort={onSort} />
              <SortTh k="similarity" label="Similarity" sort={sort} dir={dir} onSort={onSort} />
              <SortTh k="distance" label="Edits" sort={sort} dir={dir} onSort={onSort} align="right" />
              <SortTh k="registered" label="Registered" sort={sort} dir={dir} onSort={onSort} />
              <SortTh k="downloads" label="Weekly" sort={sort} dir={dir} onSort={onSort} align="right" />
              <SortTh k="score" label="Score" sort={sort} dir={dir} onSort={onSort} align="right" />
            </Tr>
          </THead>
          <TBody>
            {rows.length === 0 && (
              <Tr className="hover:bg-transparent"><Td colSpan={7} className="py-10 text-center text-ink-3">No {filter} lookalikes for this package.</Td></Tr>
            )}
            {rows.map((c) => (
              <Tr key={c.name} selected={selected === c.name} onClick={() => onSelect(c.name)}>
                <Td label="Lookalike">
                  <button
                    type="button" aria-pressed={selected === c.name} onClick={(e) => { e.stopPropagation(); onSelect(c.name) }}
                    className="flex flex-col items-start gap-0.5 rounded-md text-left"
                  >
                    <span className="text-[13.5px] font-medium"><CharDiff original={group.original} candidate={c.name} /></span>
                    <span className="text-[11.5px] text-ink-3">{mutationInfo(c.mutation).label}</span>
                  </button>
                </Td>
                <Td label="Severity"><SeverityBadge severity={c.severity} size="sm" /></Td>
                <Td label="Similarity"><span className="tnum">{fmtPercent(c.similarity)}</span></Td>
                <Td label="Edits" align="right"><span className="tnum">{c.distance}</span></Td>
                <Td label="Registered">
                  {c.registered_at ? <span className="text-ink-2">{fmtDate(c.registered_at, false)}</span> : <Badge>Unregistered</Badge>}
                </Td>
                <Td label="Weekly downloads" align="right"><span className="tnum text-ink-2">{c.weekly_downloads != null ? fmtNumber(c.weekly_downloads) : '—'}</span></Td>
                <Td label="Score" align="right"><span className="tnum font-medium">{c.suspicion_score}</span></Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableContainer>
    </div>
  )
}
