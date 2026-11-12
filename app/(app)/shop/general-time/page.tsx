import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { GeneralTimeForm } from './general-time-form'
import { logGeneralTime } from '../labor-actions'

export default async function GeneralTimePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('id, company_id').eq('id', user!.id).single()

  const { data: empStatus } = await admin
    .from('employee_statuses')
    .select('clock_status')
    .eq('profile_id', profile!.id)
    .maybeSingle()

  const isClockedIn = empStatus?.clock_status === 'clocked_in'

  // Fetch open tickets + recent general entries in parallel
  const [{ data: openTickets }, { data: recent }] = await Promise.all([
    admin
      .from('repair_tickets')
      .select('id, ticket_number, title, assets(unit_number)')
      .eq('company_id', profile!.company_id)
      .not('status', 'in', '(completed,closed,deferred)')
      .order('updated_at', { ascending: false })
      .limit(50),
    admin
      .from('labor_entries')
      .select('id, entry_type, description, total_minutes, started_at')
      .eq('profile_id', profile!.id)
      .neq('entry_type', 'ticket')
      .order('started_at', { ascending: false })
      .limit(10),
  ])

  const tickets = (openTickets ?? []).map(t => ({
    id: t.id,
    ticket_number: t.ticket_number,
    title: t.title,
    unit_number: (t as any).assets?.unit_number ?? null,
  }))

  const TYPE_LABELS: Record<string, string> = {
    general_shop:            'General Shop Work',
    mowing_225:              'Mowing — 225',
    mowing_861:              'Mowing — 861',
    general_maintenance_225: 'General Maintenance — 225',
    general_maintenance_861: 'General Maintenance — 861',
    dispenser_purging:       'Dispenser Purging',
    special_assignment:      'Special Assignment',
    break:                   'Break',
    lunch:                   'Lunch',
    other:                   'Other',
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-sm mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="rp-title">Log Shop Time</h1>
          <Link href="/shop" className="text-sm text-blue-600">← Shop</Link>
        </div>

        {!isClockedIn && (
          <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            ⚠️ You are not clocked in. Clock in first.
          </div>
        )}

        <div className="rp-card p-5 mb-5">
          <GeneralTimeForm
            action={logGeneralTime}
            disabled={!isClockedIn}
            openTickets={tickets}
          />
        </div>

        {/* Recent entries */}
        {recent && recent.length > 0 && (
          <div className="rp-card p-5">
            <h2 className="font-semibold text-gray-900 text-sm mb-3">Recent Entries</h2>
            <div className="space-y-2">
              {recent.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="font-medium text-gray-800">
                      {TYPE_LABELS[e.entry_type] ?? e.entry_type.replace(/_/g, ' ')}
                    </p>
                    {e.description && <p className="text-xs text-gray-500">{e.description}</p>}
                  </div>
                  <span className="font-semibold text-gray-900 shrink-0 ml-2">
                    {e.total_minutes != null
                      ? e.total_minutes < 60
                        ? `${e.total_minutes}m`
                        : `${Math.floor(e.total_minutes / 60)}h ${e.total_minutes % 60}m`
                      : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
