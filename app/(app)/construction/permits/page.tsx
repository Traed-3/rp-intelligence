import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { fmtDate } from '@/lib/construction'
import {
  loadPermitGraph, boardPermits, computeAlerts, loadHashEnteredAt, type EnrichedPermit,
} from '@/lib/permits-data'
import { PERMIT_STATUS_VALUES, PERMIT_TYPES, PULLED_BY } from '@/lib/permits'
import { PermitStatusSelect } from '@/components/construction/permit-status-select'
import { PermitRequirementSelect } from '@/components/construction/permit-requirement-select'
import { updatePermitStatus, setPermitRequirement } from './actions'
import { FileCheck2, MapPin, LayoutList } from 'lucide-react'

const th = 'text-left px-3 py-3 font-medium text-gray-500 whitespace-nowrap'

type SearchParams = {
  status?: string; jurisdiction?: string; pulled_by?: string; type?: string; alert?: string
}

// A permit's row tint. Green once it's in hand; red when blocked/rejected.
function rowTint(status: string): string {
  if (['Permit In-Hand', 'Inspection Scheduled', 'Complete'].includes(status)) return 'bg-green-50/60'
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

  // Filters
  if (sp.status) rows = rows.filter(p => p.status === sp.status)
  if (sp.type) rows = rows.filter(p => p.permit_type === sp.type)
  if (sp.pulled_by) rows = rows.filter(p => p.pulled_by === sp.pulled_by)
  if (sp.jurisdiction) rows = rows.filter(p => p.jurisdiction?.id === sp.jurisdiction)

  // sort: soonest due first, undated last
  rows = [...rows].sort((a, b) => {
    if (a.daysUntilDue == null) return 1
    if (b.daysUntilDue == null) return -1
    return a.daysUntilDue - b.daysUntilDue
  })

  const jurisdictions = [...graph.jurisdictions].sort((a, b) => a.name.localeCompare(b.name))
  const qs = (patch: Partial<SearchParams>) => {
    const merged: Record<string, string> = {}
    for (const [k, v] of Object.entries(sp)) if (v) merged[k] = v as string
    for (const [k, v] of Object.entries(patch)) { if (v) merged[k] = v; else delete merged[k] }
    const s = new URLSearchParams(merged).toString()
    return s ? `/construction/permits?${s}` : '/construction/permits'
  }

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
      </div>

      <div className="rp-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center">
            <FileCheck2 className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No permits match.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="rp-table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className={th}>Permit ID</th>
                  <th className={th}>Site</th>
                  <th className={`${th} hidden md:table-cell`}>Jurisdiction</th>
                  <th className={`${th} hidden sm:table-cell`}>Type</th>
                  <th className={`${th} hidden lg:table-cell`}>Pulled By</th>
                  <th className={th}>Status</th>
                  <th className={`${th} hidden lg:table-cell`}>Work Date</th>
                  <th className={`${th} hidden md:table-cell`}>Due Date</th>
                  <th className={th}>Due In</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(p => (
                  <ClickableRow key={p.id} href={p.site ? `/construction/permits/sites/${p.site.id}` : '/construction/permits'} className={rowTint(p.status)}>
                    <td className="px-3 py-2.5 font-mono text-xs font-semibold text-gray-900 whitespace-nowrap">{p.permit_key ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-gray-900">{p.site?.site_number ?? '—'}</span>
                      {p.site?.brand && <div className="text-[11px] text-gray-400">{p.site.brand}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 hidden md:table-cell">{p.jurisdiction?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 hidden sm:table-cell">{p.permit_type}</td>
                    <td className="px-3 py-2.5 text-gray-600 hidden lg:table-cell">{p.pulled_by}</td>
                    <td className="px-3 py-2.5">
                      {p.requirement_status === 'Unknown'
                        ? <PermitRequirementSelect id={p.id} requirement={p.requirement_status} action={setPermitRequirement} />
                        : <PermitStatusSelect id={p.id} status={p.status} action={updatePermitStatus} />}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 hidden lg:table-cell whitespace-nowrap">{fmtDate(p.project?.scheduled_work_date)}</td>
                    <td className="px-3 py-2.5 text-gray-600 hidden md:table-cell whitespace-nowrap">{fmtDate(p.dueDate)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{daysBadge(p.daysUntilDue)}</td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Due Date is always the scheduled work date minus 28 days. Changing a status writes a dated entry to the permit’s history.
      </p>
    </div>
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
