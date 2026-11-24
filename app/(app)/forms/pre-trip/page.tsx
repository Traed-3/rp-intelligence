import Link from 'next/link'
import { Truck, Caravan } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireFieldSurveys } from '@/lib/construction-guard'
import { type PretripRow, kindLabel, fmtDate, pretripItems, remarkItems } from '@/lib/pretrip'
import { createInspection } from './actions'

export const dynamic = 'force-dynamic'
const STATUS: Record<string, string> = { draft: 'rp-stage rp-stage-needs-scheduled', complete: 'rp-stage rp-stage-complete' }

export default async function PretripListPage() {
  const profile = await requireFieldSurveys()
  const admin = createAdminClient()
  // Techs see the inspections they did; the construction office roles see everyone's.
  const q = admin.from('pretrip_inspections').select('*').eq('company_id', profile.company_id)
  const { data } = await (profile.fullAccess ? q : q.eq('created_by', profile.id)).order('inspection_date', { ascending: false }).order('created_at', { ascending: false }).limit(100)
  const rows = (data ?? []) as PretripRow[]

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto overflow-x-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="rp-title">Pre-Trip Inspection</h1>
          <p className="text-sm text-gray-500 mt-0.5">Daily truck and trailer walk-around (Non CDL). Mark each line OK, Remark or N/A, then finish to get the PDF.</p>
        </div>
        <Link href="/forms" className="text-sm text-gray-500 hover:text-gray-700">← Forms</Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        {(['vehicle', 'trailer'] as const).map(kind => {
          const Icon = kind === 'vehicle' ? Truck : Caravan
          return (
            <form key={kind} action={createInspection}>
              <input type="hidden" name="kind" value={kind} />
              <button className="rp-card rp-card-link w-full p-4 flex items-center gap-3 text-left">
                <span className="rounded-lg p-2 bg-primary/10 text-primary"><Icon className="w-5 h-5" /></span>
                <span>
                  <span className="block font-semibold text-gray-900">New {kindLabel(kind).toLowerCase()} inspection</span>
                  <span className="block text-xs text-gray-500">{pretripItems(kind).length} lines · {kind === 'vehicle' ? 'outside, engine compartment, lights, gauges, tag' : 'tires, frame, jack, coupler, lights, tag'}</span>
                </span>
              </button>
            </form>
          )
        })}
      </div>

      <div className="rp-card overflow-hidden">
        <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide bg-foreground text-background">{profile.fullAccess ? 'Inspections' : 'My inspections'}</div>
        {!rows.length ? <p className="p-4 text-sm text-gray-400">No inspections yet. Start one above.</p> : (
          <ul className="divide-y divide-gray-100">
            {rows.map(r => {
              const flagged = remarkItems(r).length
              return (
                <li key={r.id}>
                  <Link href={`/forms/pre-trip/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS[r.status] ?? 'bg-gray-200'}`}>{r.status === 'complete' ? 'done' : 'draft'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-900 truncate">{kindLabel(r.kind)} {r.unit_number ?? '(no number yet)'}{r.equipment ? ` · ${r.equipment}` : ''}</span>
                      <span className="block text-xs text-gray-500">{fmtDate(r.inspection_date)} · {r.checked_by ?? 'driver'}{flagged ? <span className="text-amber-700 font-semibold"> · {flagged} need{flagged === 1 ? 's' : ''} attention</span> : r.status === 'complete' ? ' · all OK' : ''}</span>
                    </span>
                    <span className="text-xs text-blue-600">Open →</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
