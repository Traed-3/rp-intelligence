import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { TicketStatusBadge, PriorityBadge } from '@/components/tickets/ticket-badges'
import { MyTasksClockIn } from './my-tasks-clock-in'

export default async function MyTasksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('id, full_name, company_id').eq('id', user!.id).single()

  // Get employee shift + current ticket status
  const { data: empStatus } = await admin
    .from('employee_statuses')
    .select('clock_status, current_ticket_id, active_labor_entry_id')
    .eq('profile_id', profile!.id)
    .maybeSingle()

  const isClockedIn = empStatus?.clock_status === 'clocked_in'
  const activeTicketId = empStatus?.current_ticket_id ?? null
  const hasActiveLaborEntry = !!empStatus?.active_labor_entry_id

  // Tickets assigned to this employee (via assignments table OR assigned_to field)
  const { data: assignedTickets } = await admin
    .from('repair_tickets')
    .select('id, ticket_number, title, status, priority, assets(unit_number, make, model)')
    .eq('company_id', profile!.company_id)
    .not('status', 'in', '(completed,closed,deferred)')
    .or(`assigned_to.eq.${profile!.id},id.in.(${
      // sub-query via assignments
      'select ticket_id from repair_ticket_assignments where profile_id = ' + profile!.id + ' and is_active = true'
    })`)
    .order('updated_at', { ascending: false })

  // Also get tickets from repair_ticket_assignments directly
  const { data: assignmentTicketIds } = await admin
    .from('repair_ticket_assignments')
    .select('ticket_id')
    .eq('profile_id', profile!.id)
    .eq('is_active', true)

  const assignmentIds = (assignmentTicketIds ?? []).map(a => a.ticket_id)

  // Fetch all tickets the employee is assigned to (either way)
  const { data: allTickets } = await admin
    .from('repair_tickets')
    .select('id, ticket_number, title, status, priority, assets(unit_number, make, model)')
    .eq('company_id', profile!.company_id)
    .not('status', 'in', '(completed,closed,deferred)')
    .or(assignmentIds.length > 0
      ? `assigned_to.eq.${profile!.id},id.in.(${assignmentIds.join(',')})`
      : `assigned_to.eq.${profile!.id}`)
    .order('updated_at', { ascending: false })

  const tickets = allTickets ?? []

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-sm mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="rp-title">My Tasks</h1>
          <Link href="/shop/clock" className="text-sm text-blue-600">← Clock</Link>
        </div>

        {!isClockedIn && (
          <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            ⚠️ Clock in for your shift first before clocking in to a ticket.
          </div>
        )}

        {tickets.length === 0 ? (
          <div className="rp-card p-8 text-center">
            <p className="text-gray-400 text-sm">No tickets assigned to you.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((t) => {
              const isActiveOnThis = activeTicketId === t.id && hasActiveLaborEntry
              return (
                <div key={t.id} className={`bg-card rounded-xl border transition-colors ${
                  isActiveOnThis ? 'border-green-400 ring-2 ring-green-300' : 'border-gray-200'
                } p-4`}>
                  {/* Ticket info */}
                  <div className="mb-3">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className="font-mono text-xs text-gray-400">{t.ticket_number}</span>
                      <PriorityBadge priority={t.priority} />
                    </div>
                    <Link href={`/tickets/${t.id}`} className="font-semibold text-gray-900 text-sm leading-snug hover:text-blue-600 block">
                      {t.title}
                    </Link>
                    {(t as any).assets && (
                      <p className="text-xs text-gray-500 mt-1">
                        {(t as any).assets.unit_number}
                        {[(t as any).assets.make, (t as any).assets.model].filter(Boolean).length > 0 &&
                          ` — ${[(t as any).assets.make, (t as any).assets.model].filter(Boolean).join(' ')}`}
                      </p>
                    )}
                  </div>

                  {/* Status + Clock In/Out */}
                  <div className="flex items-center justify-between gap-2">
                    <TicketStatusBadge status={t.status} />
                    <MyTasksClockIn
                      ticketId={t.id}
                      isActiveOnThis={isActiveOnThis}
                      isClockedIn={isClockedIn}
                    />
                  </div>

                  {isActiveOnThis && (
                    <p className="text-xs text-green-700 font-semibold mt-2">
                      🟢 You are clocked in to this ticket
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
