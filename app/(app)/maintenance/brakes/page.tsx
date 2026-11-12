import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { DueBadge } from '@/components/maintenance/due-badge'
import { calcDateDue, sortByUrgency } from '@/lib/maintenance'

export default async function BrakesMaintenancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id').eq('id', user!.id).single()

  const { data: assets } = await admin
    .from('assets')
    .select('id, unit_number, name, make, model, year, status, last_brake_service_date, last_brake_service_mileage, next_brake_inspection_date')
    .eq('company_id', profile!.company_id)
    .neq('status', 'retired')
    .order('unit_number')

  const rows = (assets ?? []).map((a) => {
    const due = calcDateDue(a.next_brake_inspection_date)
    return { ...a, due, status: due.status, daysUntil: due.daysUntil }
  })
  const sorted = sortByUrgency(rows)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/maintenance" className="text-sm text-gray-500 hover:text-gray-700">← Maintenance</Link>
        <span className="text-gray-300">/</span>
        <h1 className="rp-title">Brakes</h1>
      </div>

      <div className="rp-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="rp-table w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3">Unit #</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">Vehicle</th>
                <th className="text-left px-4 py-3">Next Inspection</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Last Service</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.map((a) => (
                <ClickableRow key={a.id} href={`/assets/${a.id}`}>
                  <td className="px-4 py-3 font-semibold text-gray-900">
                    <Link href={`/assets/${a.id}`} className="hover:text-blue-600">{a.unit_number}</Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">
                    {[a.year, a.make, a.model].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-4 py-3">
                    {a.next_brake_inspection_date ? (
                      <div className="flex items-center gap-2">
                        <DueBadge status={a.due.status} />
                        <span className="text-xs text-gray-500">{a.due.label}</span>
                      </div>
                    ) : <span className="text-gray-400 text-xs">Not set</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                    {a.last_brake_service_date
                      ? new Date(a.last_brake_service_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/assets/${a.id}/maintenance/brakes`} className="text-xs font-medium text-blue-600 hover:text-blue-800">Record →</Link>
                  </td>
                </ClickableRow>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
