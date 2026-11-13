import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireFieldSurveys } from '@/lib/construction-guard'
import { type AccidentRow, ACCIDENT_INTRO, fmtDate, accidentFlags } from '@/lib/accident'
import { createReport } from './actions'

export const dynamic = 'force-dynamic'
const STATUS: Record<string, string> = { draft: 'rp-stage rp-stage-needs-scheduled', complete: 'rp-stage rp-stage-complete' }

export default async function AccidentListPage() {
  const profile = await requireFieldSurveys()
  const admin = createAdminClient()
  // Techs see the reports they filed; the construction office roles see everyone's.
  const q = admin.from('accident_reports').select('*').eq('company_id', profile.company_id)
  const { data } = await (profile.fullAccess ? q : q.eq('created_by', profile.id)).order('accident_date', { ascending: false }).order('created_at', { ascending: false }).limit(100)
  const rows = (data ?? []) as AccidentRow[]

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto overflow-x-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="rp-title">Accident Report</h1>
          <p className="text-sm text-gray-500 mt-0.5">Work vehicle accident report. Call management first, then fill this out the same day. Submitting emails the PDF to the office.</p>
        </div>
        <Link href="/forms" className="text-sm text-gray-500 hover:text-gray-700">← Forms</Link>
      </div>

      <div className="rp-card p-4 mb-4 border-amber-200 bg-amber-50/60 text-sm text-amber-900">{ACCIDENT_INTRO}</div>

      <form action={createReport} className="mb-5">
        <button className="rp-card rp-card-link w-full sm:w-auto p-4 flex items-center gap-3 text-left">
          <span className="rounded-lg p-2 bg-primary/10 text-primary"><TriangleAlert className="w-5 h-5" /></span>
          <span>
            <span className="block font-semibold text-gray-900">New accident report</span>
            <span className="block text-xs text-gray-500">What happened, other vehicle, property, police, injuries, photos, signature</span>
          </span>
        </button>
      </form>

      <div className="rp-card overflow-hidden">
        <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide bg-foreground text-background">{profile.fullAccess ? 'Reports' : 'My reports'}</div>
        {!rows.length ? <p className="p-4 text-sm text-gray-400">No accident reports.</p> : (
          <ul className="divide-y divide-gray-100">
            {rows.map(r => {
              const flags = accidentFlags(r)
              return (
                <li key={r.id}>
                  <Link href={`/forms/accident/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS[r.status] ?? 'bg-gray-200'}`}>{r.status === 'complete' ? 'submitted' : 'draft'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-900 truncate">{r.unit_number ? `Truck ${r.unit_number}` : '(no truck number yet)'}{r.location ? ` · ${r.location}` : ''}</span>
                      <span className="block text-xs text-gray-500">{fmtDate(r.accident_date)} · {r.employee_name ?? 'driver'}{flags.length ? <span className="text-amber-700 font-semibold"> · {flags.join(', ')}</span> : null}</span>
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
