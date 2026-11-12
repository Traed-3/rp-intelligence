import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { DueBadge } from '@/components/maintenance/due-badge'
import { calcDateDue, sortByUrgency } from '@/lib/maintenance'

export default async function RegistrationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id').eq('id', user!.id).single()

  const { data: assets } = await admin
    .from('assets')
    .select('id, unit_number, name, make, model, year, status, registration_due_date')
    .eq('company_id', profile!.company_id)
    .neq('status', 'retired')
    .order('unit_number')

  type Row = { id: string; unit_number: string; vehicleLabel: string; type: string; date: string | null; status: ReturnType<typeof calcDateDue>['status']; daysUntil: number | null; due: ReturnType<typeof calcDateDue> }
  const rows: Row[] = []

  for (const a of assets ?? []) {
    const label = [a.year, a.make, a.model].filter(Boolean).join(' ') || a.name || ''
    const reg = calcDateDue(a.registration_due_date)
    rows.push({ id: a.id, unit_number: a.unit_number, vehicleLabel: label, type: 'Registration / Tag', date: a.registration_due_date, status: reg.status, daysUntil: reg.daysUntil, due: reg })
  }

  const filtered = rows.filter(r => r.date)
  const sorted = sortByUrgency(filtered)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/maintenance" className="text-sm text-gray-500 hover:text-gray-700">← Maintenance</Link>
        <span className="text-gray-300">/</span>
        <h1 className="rp-title">Registrations</h1>
      </div>

      <div className="rp-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="rp-table w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3">Unit #</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">Vehicle</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Due Date</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">No registration or insurance dates set. Edit an asset to add them.</td></tr>
              ) : sorted.map((r, i) => (
                <ClickableRow key={i} href={`/assets/${r.id}`}>
                  <td className="px-4 py-3 font-semibold text-gray-900">
                    <Link href={`/assets/${r.id}`} className="hover:text-blue-600">{r.unit_number}</Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{r.vehicleLabel || '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{r.type}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {r.date ? new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </td>
                  <td className="px-4 py-3"><DueBadge status={r.due.status} label={r.due.label} /></td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/assets/${r.id}/edit`} className="text-xs font-medium text-blue-600 hover:text-blue-800">Update →</Link>
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
