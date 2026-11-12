import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { StatusSelector } from './status-selector'
import { updateStatus } from '../actions'

const STATUS_OPTIONS = [
  { value: 'at_shop',             label: 'At Shop',             icon: '🏭' },
  { value: 'working_on_ticket',   label: 'Working on Ticket',   icon: '🔧' },
  { value: 'waiting_parts',       label: 'Waiting on Parts',    icon: '⏳' },
  { value: 'parts_run',           label: 'Parts Run',           icon: '🚗' },
  { value: 'cleaning_shop',       label: 'Cleaning Shop',       icon: '🧹' },
  { value: 'helping_employee',    label: 'Helping Employee',    icon: '👥' },
  { value: 'general_maintenance', label: 'General Maintenance', icon: '⚙️' },
  { value: 'break',               label: 'Break',               icon: '☕' },
  { value: 'lunch',               label: 'Lunch',               icon: '🍽️' },
  { value: 'meeting',             label: 'Meeting',             icon: '📋' },
  { value: 'off_site',            label: 'Off Site',            icon: '📍' },
  { value: 'other',               label: 'Other',               icon: '•' },
]

export default async function StatusPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('id, company_id, full_name').eq('id', user!.id).single()

  // Current status
  const { data: empStatus } = await admin
    .from('employee_statuses')
    .select('clock_status, current_status, current_ticket_id, current_task_note')
    .eq('profile_id', profile!.id)
    .maybeSingle()

  // Assigned tickets for selecting "working on ticket"
  const { data: myTickets } = await admin
    .from('repair_tickets')
    .select('id, ticket_number, title, assets(unit_number)')
    .eq('assigned_to', profile!.id)
    .in('status', ['assigned', 'in_progress', 'paused', 'waiting_parts'])
    .order('updated_at', { ascending: false })

  const isClockedIn = empStatus?.clock_status === 'clocked_in'

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-sm mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="rp-title">Set Status</h1>
          <a href="/shop/clock" className="text-sm text-blue-600">← Clock</a>
        </div>

        {!isClockedIn && (
          <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            ⚠️ You are not clocked in. Clock in first to set your status.
          </div>
        )}

        <StatusSelector
          options={STATUS_OPTIONS}
          currentStatus={empStatus?.current_status ?? 'clocked_out'}
          currentTicketId={empStatus?.current_ticket_id ?? null}
          myTickets={(myTickets ?? []).map(t => ({
            id: t.id,
            ticket_number: t.ticket_number,
            title: t.title,
            unit_number: (t as any).assets?.unit_number ?? null,
          }))}
          updateStatusAction={updateStatus}
          disabled={!isClockedIn}
        />
      </div>
    </div>
  )
}
