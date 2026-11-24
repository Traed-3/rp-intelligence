import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { TicketStatusBadge } from '@/components/tickets/ticket-badges'

function minutesToDisplay(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: myProfile } = await admin
    .from('profiles').select('company_id, role').eq('id', user!.id).single()

  // Allow viewing your own page or managers viewing anyone
  const canView = ['owner', 'manager', 'shop_manager'].includes(myProfile?.role ?? '') || user!.id === id
  if (!canView) notFound()

  const { data: employee } = await admin
    .from('profiles')
    .select('id, full_name, email, role, is_active')
    .eq('id', id)
    .eq('company_id', myProfile!.company_id)
    .single()

  if (!employee) notFound()

  const { data: empStatus } = await admin
    .from('employee_statuses')
    .select('clock_status, current_status, status_updated_at, repair_tickets(ticket_number, title)')
    .eq('profile_id', id)
    .maybeSingle()

  // Today's time entries
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const { data: todayEntries } = await admin
    .from('time_clock_entries')
    .select('id, clock_in, clock_out, total_minutes, is_approved')
    .eq('profile_id', id)
    .gte('clock_in', todayStart.toISOString())
    .order('clock_in')

  // Last 7 days entries
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7)
  const { data: weekEntries } = await admin
    .from('time_clock_entries')
    .select('id, clock_in, clock_out, total_minutes')
    .eq('profile_id', id)
    .gte('clock_in', weekStart.toISOString())
    .order('clock_in', { ascending: false })
    .limit(20)

  // Assigned tickets
  const { data: assignedTickets } = await admin
    .from('repair_tickets')
    .select('id, ticket_number, title, status, priority, assets(unit_number)')
    .eq('assigned_to', id)
    .not('status', 'in', '(closed,deferred)')
    .order('updated_at', { ascending: false })
    .limit(10)

  const now = Date.now()
  const todayMins = (todayEntries ?? []).reduce((sum, e) => {
    const mins = e.clock_out ? (e.total_minutes ?? 0) : Math.round((now - new Date(e.clock_in).getTime()) / 60000)
    return sum + mins
  }, 0)
  const weekMins = (weekEntries ?? []).reduce((sum, e) => sum + (e.total_minutes ?? 0), 0)

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/shop/employees" className="text-sm text-gray-500 hover:text-gray-700">← Employees</Link>
        <span className="text-gray-300">/</span>
        <h1 className="rp-title">{employee.full_name}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left */}
        <div className="lg:col-span-2 space-y-5">
          {/* Hours summary */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rp-card p-5 text-center">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Today</p>
              <p className="text-3xl font-bold text-gray-900">{minutesToDisplay(todayMins)}</p>
            </div>
            <div className="rp-card p-5 text-center">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Last 7 Days</p>
              <p className="text-3xl font-bold text-gray-900">{minutesToDisplay(weekMins)}</p>
            </div>
          </div>

          {/* Today's time entries */}
          <div className="rp-card p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Today's Time Entries</h2>
            {!todayEntries?.length ? (
              <p className="text-sm text-gray-400">No entries today.</p>
            ) : (
              <div className="space-y-2">
                {todayEntries.map((e) => {
                  const mins = e.clock_out ? (e.total_minutes ?? 0) : Math.round((now - new Date(e.clock_in).getTime()) / 60000)
                  return (
                    <div key={e.id} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                      <div className="text-gray-700">
                        {new Date(e.clock_in).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        {' → '}
                        {e.clock_out
                          ? new Date(e.clock_out).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                          : <span className="text-green-600 font-medium">Active</span>}
                      </div>
                      <span className="font-semibold text-gray-900">{minutesToDisplay(mins)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Assigned tickets */}
          <div className="rp-card p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Assigned Tickets</h2>
            {!assignedTickets?.length ? (
              <p className="text-sm text-gray-400">No open tickets assigned.</p>
            ) : (
              <div className="space-y-2">
                {assignedTickets.map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <div>
                      <Link href={`/tickets/${t.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600">
                        {t.ticket_number} — {t.title}
                      </Link>
                      {(t as any).assets && (
                        <p className="text-xs text-gray-500">{(t as any).assets.unit_number}</p>
                      )}
                    </div>
                    <TicketStatusBadge status={t.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right — status */}
        <div className="space-y-5">
          <div className="rp-card p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Current Status</h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${empStatus?.clock_status === 'clocked_in' ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span className="font-medium text-gray-900">
                  {empStatus?.clock_status === 'clocked_in' ? 'Clocked In' : 'Clocked Out'}
                </span>
              </div>
              <p className="text-gray-600 capitalize pl-4">
                {empStatus?.current_status?.replace(/_/g, ' ') ?? '—'}
              </p>
              {(empStatus as any)?.repair_tickets && (
                <p className="text-xs text-blue-600 pl-4">
                  {(empStatus as any).repair_tickets.ticket_number} — {(empStatus as any).repair_tickets.title?.slice(0, 40)}
                </p>
              )}
            </div>
          </div>

          <div className="rp-card p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Employee Info</h2>
            <div className="space-y-1 text-sm text-gray-600">
              <p>{employee.email}</p>
              <p className="capitalize">{employee.role.replace('_', ' ')}</p>
              <p>{employee.is_active ? '✅ Active' : '❌ Inactive'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
