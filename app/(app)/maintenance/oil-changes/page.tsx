import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { DueBadge } from '@/components/maintenance/due-badge'
import { calcOilChangeDue, sortByUrgency } from '@/lib/maintenance'

export default async function OilChangesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin.from('profiles').select('company_id').eq('id', user!.id).single()

  const { data: assets } = await admin
    .from('assets')
    .select('id, unit_number, name, make, model, year, status, current_mileage, next_oil_change_mileage, last_oil_change_date, last_oil_change_mileage, oil_change_interval_miles')
    .eq('company_id', profile!.company_id)
    .neq('status', 'retired')
    .order('unit_number')

  const rows = (assets ?? []).map((a) => {
    const due = calcOilChangeDue(a.current_mileage, a.next_oil_change_mileage)
    return { ...a, due }
  })

  const sorted = sortByUrgency(rows.map(r => ({ ...r, status: r.due.status, daysUntil: r.due.daysUntil })))

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/maintenance" className="text-sm text-gray-500 hover:text-gray-700">← Maintenance</Link>
        <span className="text-gray-300">/</span>
        <h1 className="rp-title">Oil Changes</h1>
      </div>

      <div className="rp-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="rp-table w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3">Unit #</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">Vehicle</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Current Mi</th>
                <th className="text-right px-4 py-3">Next Due Mi</th>
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
                    <DueBadge status={a.due.status} label={a.due.label} />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {a.current_mileage != null ? a.current_mileage.toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {a.next_oil_change_mileage != null ? a.next_oil_change_mileage.toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                    {a.last_oil_change_date
                      ? new Date(a.last_oil_change_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/assets/${a.id}/maintenance/oil-change`} className="text-xs font-medium text-blue-600 hover:text-blue-800">
                      Record →
                    </Link>
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
