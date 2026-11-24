import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { fmtDate } from '@/lib/construction'
import {
  loadPermitGraph, boardPermits, computeAlerts, loadHashEnteredAt, type EnrichedPermit,
} from '@/lib/permits-data'
import {
  PERMIT_STATUS_VALUES, PERMIT_TYPES, PULLED_BY, PERMIT_BUCKETS, permitBucket, type PermitBucket,
} from '@/lib/permits'
import { PermitStatusSelect } from '@/components/construction/permit-status-select'
import { PermitRequirementSelect } from '@/components/construction/permit-requirement-select'
import { updatePermitStatus, setPermitRequirement } from './actions'
import { FileCheck2, MapPin, LayoutList, Hourglass, ClipboardCheck, CheckCircle2, AlertTriangle } from 'lucide-react'

const th = 'text-left px-3 py-3 font-medium text-gray-500 whitespace-nowrap'

type SearchParams = {
  status?: string; jurisdiction?: string; pulled_by?: string; type?: string; alert?: string; view?: string
}

// How each pile looks on the dashboard.
const BUCKET_LOOK: Record<PermitBucket, { icon: typeof Hourglass; num: string; ring: string; bar: string; chip: string }> = {
  waiting:    { icon: Hourglass,      num: 'text-amber-600',   ring: 'ring-amber-400',   bar: 'bg-amber-400',   chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  inspection: { icon: ClipboardCheck, num: 'text-blue-700',    ring: 'ring-blue-500',    bar: 'bg-blue-600',    chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  complete:   { icon: CheckCircle2,   num: 'text-emerald-600', ring: 'ring-emerald-500', bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}

// The newest line of a permit's notes — "where it stands" at a glance.
function latestNote(notes: string | null): string {
  if (!notes) return ''
  const lines = notes.split('\n').map(l => l.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}

// A permit's row tint. Green once it's in hand; red when blocked/rejected.
function rowTint(status: string): string {
  if (status === 'Complete') return ''
  if (['Permit In-Hand', 'Inspection Scheduled'].includes(status)) return 'bg-blue-50/40'
  if (['On Hold', 'Rejected'].includes(status)) return 'bg-red-50/60'
  return ''
}

function daysBadge(d: number | null) {
  if (d == null) return <span className="text-gray-400">—</span>
  if (d < 0) return <span className="text-red-600 font-semibold">{Math.abs(d)}d overdue</span>
  if (d <= 7) return <span className="text-amber-600 font-semibold">{d}d</span>
  return <span className="text-gray-600">{d}d</span>
}

export default async function PermitBoardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const { company_id } = await requireConstruction()
  const admin = createAdminClient()
  const graph = await loadPermitGraph(admin, company_id)

  // Alert view: show exactly the permits behind one dashboard alert.
  let rows: EnrichedPermit[]
  let heading = 'Permit Board'
  let subheading = 'Every required permit, one row each.'
  if (sp.alert) {
    const hashEnteredAt = await loadHashEnteredAt(admin, company_id)
    const alerts = computeAlerts(graph, { hashEnteredAt })
    const a = alerts.find(x => x.key === sp.alert)
    rows = a?.permits ?? []
    heading = a ? a.label : 'Permit Board'
    subheading = a?.description ?? subheading
  } else {
    rows = boardPermits(graph)
  }

  // Dashboard numbers come from every required permit (before any filter is applied),
  // so the tiles always show the whole picture.
  const all = boardPermits(graph)
  const byBucket: Record<PermitBucket, EnrichedPermit[]> = { waiting: [], inspection: [], complete: [] }
  for (const p of all) byBucket[permitBucket(p.status)].push(p)
  const total = all.length
  const subCounts = (list: EnrichedPermit[]) => {
    const m = new Map<string, number>()
    for (const p of list) m.set(p.status, (m.get(p.status) ?? 0) + 1)
    return PERMIT_STATUS_VALUES.filter(v => m.has(v)).map(v => `${m.get(v)} ${v.toLowerCase()}`).join(' · ')
  }
  const view = PERMIT_BUCKETS.some(b => b.key === sp.view) ? (sp.view as PermitBucket) : null

  // Alerts only ever cover permits that are still open.
  const openAlerts = sp.alert ? [] : computeAlerts(graph, { hashEnteredAt: await loadHashEnteredAt(admin, company_id) }).filter(a => a.count > 0)

  // Filters
  if (sp.status) rows = rows.filter(p => p.status === sp.status)
  if (sp.type) rows = rows.filter(p => p.permit_type === sp.type)
  if (sp.pulled_by) rows = rows.filter(p => p.pulled_by === sp.pulled_by)
  if (sp.jurisdiction) rows = rows.filter(p => p.jurisdiction?.id === sp.jurisdiction)
  if (view) rows = rows.filter(p => permitBucket(p.status) === view)

  // sort: soonest due first, undated last
  const byDue = (a: EnrichedPermit, b: EnrichedPermit) => {
    if (a.daysUntilDue == null && b.daysUntilDue == null) return (a.site?.site_number ?? '').localeCompare(b.site?.site_number ?? '')
    if (a.daysUntilDue == null) return 1
    if (b.daysUntilDue == null) return -1
    return a.daysUntilDue - b.daysUntilDue
  }
  const bySite = (a: EnrichedPermit, b: EnrichedPermit) => (a.site?.site_number ?? '').localeCompare(b.site?.site_number ?? '')
  const byDoneDesc = (a: EnrichedPermit, b: EnrichedPermit) =>
    String(b.date_completed ?? '').localeCompare(String(a.date_completed ?? '')) || bySite(a, b)
  const shown: Record<PermitBucket, EnrichedPermit[]> = {
    waiting: rows.filter(p => permitBucket(p.status) === 'waiting').sort(byDue),
    inspection: rows.filter(p => permitBucket(p.status) === 'inspection').sort(bySite),
    complete: rows.filter(p => permitBucket(p.status) === 'complete').sort(byDoneDesc),
  }

  const jurisdictions = [...graph.jurisdictions].sort((a, b) => a.name.localeCompare(b.name))
  const qs = (patch: Partial<SearchParams>) => {
    const merged: Record<string, string> = {}
    for (const [k, v] of Object.entries(sp)) if (v) merged[k] = v as string
    for (const [k, v] of Object.entries(patch)) { if (v) merged[k] = v; else delete merged[k] }
    const s = new URLSearchParams(merged).toString()
    return s ? `/construction/permits?${s}` : '/construction/permits'
  }
  const filtered = !!(sp.status || sp.type || sp.pulled_by || sp.jurisdiction || view)

  const siteCell = (p: EnrichedPermit) => (
    <td className="px-3 py-2.5">
      <span className="font-medium text-gray-900">{p.site?.site_number ?? '—'}</span>
      <div className="text-[11px] text-gray-400">{[p.site?.brand, (p.site as { city?: string | null } | null)?.city].filter(Boolean).join(' · ')}</div>
    </td>
  )
  const statusCell = (p: EnrichedPermit) => (
    <td className="px-3 py-2.5">
      {p.requirement_status === 'Unknown'
        ? <PermitRequirementSelect id={p.id} requirement={p.requirement_status} action={setPermitRequirement} />
        : <PermitStatusSelect id={p.id} status={p.status} action={updatePermitStatus} />}
    </td>
  )
  const href = (p: EnrichedPermit) => p.site ? `/construction/permits/sites/${p.site.id}` : '/construction/permits'
  const td = 'px-3 py-2.5 text-gray-600'

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="rp-title">
            {heading}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{subheading} · {rows.length} shown</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/construction/permits/jurisdictions" className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-700"><MapPin className="w-4 h-4" />Jurisdictions</Link>
          <Link href="/construction/permits/sites" className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-700"><LayoutList className="w-4 h-4" />Sites</Link>
          <Link href="/construction" className="text-gray-500 hover:text-gray-700">← Construction</Link>
        </div>
      </div>

      {/* Dashboard: the three piles, counted from every required permit */}
      {!sp.alert && (
        <>
          <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-3">
            {PERMIT_BUCKETS.map(b => {
              const look = BUCKET_LOOK[b.key]
              const n = byBucket[b.key].length
              const active = view === b.key
              return (
                <Link key={b.key} href={qs({ view: active ? undefined : b.key, status: undefined })}
                  className={`rp-card rp-card-link p-3 sm:p-4 ${active ? `ring-2 ${look.ring}` : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-gray-500 leading-tight">{b.label}</p>
                    <look.icon className={`w-5 h-5 shrink-0 hidden sm:block ${look.num}`} />
                  </div>
                  <p className={`text-3xl sm:text-4xl font-bold leading-none mt-2 tabular-nums ${look.num}`}>{n}</p>
                  <p className="text-xs text-gray-500 mt-2 hidden sm:block">{b.blurb}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 min-h-4 hidden sm:block">{b.key === 'complete' ? (total ? `${Math.round((n / total) * 100)}% of ${total} permits` : '') : subCounts(byBucket[b.key])}</p>
                </Link>
              )
            })}
          </div>

          {total > 0 && (
            <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 mb-4" role="img"
              aria-label={`${byBucket.waiting.length} waiting or in progress, ${byBucket.inspection.length} need final inspection, ${byBucket.complete.length} completed`}>
              {PERMIT_BUCKETS.map(b => byBucket[b.key].length > 0 && (
                <div key={b.key} className={BUCKET_LOOK[b.key].bar} style={{ width: `${(byBucket[b.key].length / total) * 100}%` }} />
              ))}
            </div>
          )}

          {/* Alerts — open permits only. Completed permits never show here. */}
          {openAlerts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
              <span className="inline-flex items-center gap-1 font-semibold text-gray-600"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" />Needs attention</span>
              {openAlerts.map(a => (
                <Link key={a.key} href={`/construction/permits?alert=${a.key}`} title={a.description}
                  className="px-2.5 py-1 rounded-full border border-amber-300 bg-amber-50 text-amber-800 font-semibold hover:border-amber-400">
                  {a.count} {a.label.toLowerCase()}
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
        {sp.alert && (
          <Link href="/construction/permits" className="px-2.5 py-1 rounded-full bg-primary text-primary-foreground font-semibold">← Back to full board</Link>
        )}
        <FilterGroup label="Status" current={sp.status} base={qs} param="status" options={PERMIT_STATUS_VALUES as readonly string[]} />
        <FilterGroup label="Type" current={sp.type} base={qs} param="type" options={PERMIT_TYPES as readonly string[]} />
        <FilterGroup label="Pulled by" current={sp.pulled_by} base={qs} param="pulled_by" options={PULLED_BY as readonly string[]} />
        <details className="relative inline-block">
          <summary className={`cursor-pointer list-none px-2.5 py-1 rounded-full border ${sp.jurisdiction ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-gray-600 border-gray-300'}`}>
            {sp.jurisdiction ? `Jurisdiction: ${jurisdictions.find(j => j.id === sp.jurisdiction)?.name ?? ''}` : 'Jurisdiction'}
          </summary>
          <div className="absolute z-10 mt-1 bg-card border border-gray-200 rounded-lg shadow-lg p-1 min-w-52 max-h-72 overflow-auto">
            <Link href={qs({ jurisdiction: undefined })} className="block px-2.5 py-1.5 rounded hover:bg-gray-50 text-gray-600">All</Link>
            {jurisdictions.map(j => (
              <Link key={j.id} href={qs({ jurisdiction: j.id })} className={`block px-2.5 py-1.5 rounded hover:bg-gray-50 ${sp.jurisdiction === j.id ? 'font-semibold text-blue-700' : 'text-gray-700'}`}>{j.name}</Link>
            ))}
          </div>
        </details>
        {filtered && !sp.alert && <Link href="/construction/permits" className="text-gray-500 hover:text-gray-700 underline">Clear</Link>}
      </div>

      {rows.length === 0 && (
        <div className="rp-card p-12 text-center">
          <FileCheck2 className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No permits match.</p>
        </div>
      )}

      {/* 1 — Waiting / in progress */}
      {shown.waiting.length > 0 && (
        <Section bucket="waiting" count={shown.waiting.length}>
          <thead>
            <tr>
              <th className={th}>Site</th>
              <th className={`${th} hidden md:table-cell`}>Jurisdiction</th>
              <th className={`${th} hidden sm:table-cell`}>Type</th>
              <th className={`${th} hidden lg:table-cell`}>Pulled By</th>
              <th className={th}>Status</th>
              <th className={`${th} hidden xl:table-cell`}>Where it stands</th>
              <th className={`${th} hidden lg:table-cell`}>Work Date</th>
              <th className={th}>Due In</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {shown.waiting.map(p => (
              <ClickableRow key={p.id} href={href(p)} className={rowTint(p.status)}>
                {siteCell(p)}
                <td className={`${td} hidden md:table-cell`}>{p.jurisdiction?.name ?? '—'}</td>
                <td className={`${td} hidden sm:table-cell`}>{p.permit_type}</td>
                <td className={`${td} hidden lg:table-cell`}>{p.pulled_by}</td>
                {statusCell(p)}
                <td className={`${td} hidden xl:table-cell max-w-xs`}><span className="line-clamp-2 text-xs" title={latestNote(p.notes)}>{latestNote(p.notes) || '—'}</span></td>
                <td className={`${td} hidden lg:table-cell whitespace-nowrap`}>{fmtDate(p.project?.scheduled_work_date)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{daysBadge(p.daysUntilDue)}</td>
              </ClickableRow>
            ))}
          </tbody>
        </Section>
      )}

      {/* 2 — Permit in hand, final inspection still owed */}
      {shown.inspection.length > 0 && (
        <Section bucket="inspection" count={shown.inspection.length}>
          <thead>
            <tr>
              <th className={th}>Site</th>
              <th className={`${th} hidden md:table-cell`}>Jurisdiction</th>
              <th className={`${th} hidden sm:table-cell`}>Type</th>
              <th className={th}>Permit #</th>
              <th className={`${th} hidden lg:table-cell`}>Issued</th>
              <th className={th}>Status</th>
              <th className={`${th} hidden md:table-cell`}>Inspection</th>
              <th className={`${th} hidden xl:table-cell`}>Where it stands</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {shown.inspection.map(p => (
              <ClickableRow key={p.id} href={href(p)} className={rowTint(p.status)}>
                {siteCell(p)}
                <td className={`${td} hidden md:table-cell`}>{p.jurisdiction?.name ?? '—'}</td>
                <td className={`${td} hidden sm:table-cell`}>{p.permit_type}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-gray-900 whitespace-nowrap">{(p.permit_number as string | null) ?? '—'}</td>
                <td className={`${td} hidden lg:table-cell whitespace-nowrap`}>{fmtDate(p.date_issued as string | null)}</td>
                {statusCell(p)}
                <td className={`${td} hidden md:table-cell whitespace-nowrap`}>{p.inspection_date ? fmtDate(p.inspection_date as string) : <span className="text-amber-600 font-semibold">Not scheduled</span>}</td>
                <td className={`${td} hidden xl:table-cell max-w-xs`}><span className="line-clamp-2 text-xs" title={latestNote(p.notes)}>{latestNote(p.notes) || '—'}</span></td>
              </ClickableRow>
            ))}
          </tbody>
        </Section>
      )}

      {/* 3 — Completed: plain rows, no due dates, no warnings */}
      {shown.complete.length > 0 && (
        <Section bucket="complete" count={shown.complete.length} collapsed={!view && !sp.alert && !sp.status}>
          <thead>
            <tr>
              <th className={th}>Site</th>
              <th className={`${th} hidden md:table-cell`}>Jurisdiction</th>
              <th className={`${th} hidden sm:table-cell`}>Type</th>
              <th className={`${th} hidden sm:table-cell`}>Permit #</th>
              <th className={`${th} hidden lg:table-cell`}>Pulled By</th>
              <th className={th}>Completed</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {shown.complete.map(p => (
              <ClickableRow key={p.id} href={href(p)}>
                {siteCell(p)}
                <td className={`${td} hidden md:table-cell`}>{p.jurisdiction?.name ?? '—'}</td>
                <td className={`${td} hidden sm:table-cell`}>{p.permit_type}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-gray-600 whitespace-nowrap hidden sm:table-cell">{(p.permit_number as string | null) ?? '—'}</td>
                <td className={`${td} hidden lg:table-cell`}>{p.pulled_by}</td>
                <td className={`${td} whitespace-nowrap`}>{fmtDate(p.date_completed as string | null)}</td>
                {statusCell(p)}
              </ClickableRow>
            ))}
          </tbody>
        </Section>
      )}

      <p className="text-xs text-gray-400 mt-3">
        Due Date is always the scheduled work date minus 28 days. Changing a status writes a dated entry to the permit’s history. Completed permits drop out of every alert.
      </p>
    </div>
  )
}

function Section({
  bucket, count, collapsed = false, children,
}: { bucket: PermitBucket; count: number; collapsed?: boolean; children: React.ReactNode }) {
  const meta = PERMIT_BUCKETS.find(b => b.key === bucket)!
  const look = BUCKET_LOOK[bucket]
  return (
    <details open={!collapsed} className="rp-card overflow-hidden mb-4 group">
      <summary className="rp-card-head cursor-pointer list-none select-none">
        <span className="flex items-center gap-2">
          <look.icon className={`w-4 h-4 ${look.num}`} />
          <span className="rp-card-title">{meta.label}</span>
          <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold tabular-nums ${look.chip}`}>{count}</span>
        </span>
        <span className="text-xs text-gray-400 group-open:hidden">Show</span>
        <span className="text-xs text-gray-400 hidden group-open:inline">Hide</span>
      </summary>
      <div className="overflow-x-auto">
        <table className="rp-table w-full text-sm">{children}</table>
      </div>
    </details>
  )
}

function FilterGroup({
  label, current, base, param, options,
}: {
  label: string; current?: string; base: (p: Record<string, string | undefined>) => string
  param: string; options: readonly string[]
}) {
  return (
    <details className="relative inline-block">
      <summary className={`cursor-pointer list-none px-2.5 py-1 rounded-full border ${current ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-gray-600 border-gray-300'}`}>
        {label}{current ? `: ${current}` : ''}
      </summary>
      <div className="absolute z-10 mt-1 bg-card border border-gray-200 rounded-lg shadow-lg p-1 min-w-44 max-h-72 overflow-auto">
        <Link href={base({ [param]: undefined })} className="block px-2.5 py-1.5 rounded hover:bg-gray-50 text-gray-600">All</Link>
        {options.map(o => (
          <Link key={o} href={base({ [param]: o })} className={`block px-2.5 py-1.5 rounded hover:bg-gray-50 ${current === o ? 'font-semibold text-blue-700' : 'text-gray-700'}`}>{o}</Link>
        ))}
      </div>
    </details>
  )
}
