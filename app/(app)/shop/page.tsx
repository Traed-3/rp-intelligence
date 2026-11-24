import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'

const CLOCK_DOT = {
  clocked_in:  'bg-green-500',
  clocked_out: 'bg-gray-300',
}

const STATUS_LABELS: Record<string, string> = {
  clocked_out:         'Clocked Out',
  at_shop:             'At Shop',
  working_on_ticket:   'Working on Ticket',
  waiting_parts:       'Waiting on Parts',
  parts_run:           'Parts Run',
  cleaning_shop:       'Cleaning Shop',
  helping_employee:    'Helping Employee',
  general_maintenance: 'General Maintenance',
  break:               'Break',
  lunch:               'Lunch',
  meeting:             'Meeting',
  off_site:            'Off Site',
  other:               'Other',
}

function minutesToHHMM(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

export default async function ShopPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id, role').eq('id', user!.id).single()

  // Get all shop employees + their current status
  const { data: employees } = await admin
    .from('profiles')
    .select('id, full_name, role')
    .eq('company_id', profile!.company_id)
    .in('role', ['shop_employee', 'shop_manager', 'mechanic', 'service_tech', 'construction_tech'])
    .eq('is_active', true)
    .order('full_name')

  const employeeIds = (employees ?? []).map(e => e.id)

  // Get employee statuses
  const { data: statuses } = await admin
    .from('employee_statuses')
    .select('profile_id, clock_status, current_status, current_task_note, status_updated_at, repair_tickets(ticket_number, title), assets(unit_number)')
    .in('profile_id', employeeIds)

  // Get today's hours for each employee
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const { data: todayClocks } = await admin
    .from('time_clock_entries')
    .select('profile_id, clock_in, clock_out, total_minutes')
    .in('profile_id', employeeIds)
    .gte('clock_in', todayStart.toISOString())

  // Calculate hours today per employee
  const hoursToday: Record<string, number> = {}
  const now = Date.now()
  for (const entry of todayClocks ?? []) {
    const mins = entry.clock_out
      ? (entry.total_minutes ?? 0)
      : Math.round((now - new Date(entry.clock_in).getTime()) / 60000)
    hoursToday[entry.profile_id] = (hoursToday[entry.profile_id] ?? 0) + mins
  }

  // Map statuses by profile_id
  const statusMap = Object.fromEntries((statuses ?? []).map(s => [s.profile_id, s]))

  const clockedInCount = (statuses ?? []).filter(s => s.clock_status === 'clocked_in').length

  // Open tickets
  const { data: openTickets } = await admin
    .from('repair_tickets')
    .select('id, ticket_number, title, status, priority, profiles!repair_tickets_assigned_to_fkey(full_name), assets(unit_number)')
    .eq('company_id', profile!.company_id)
    .in('status', ['new', 'open', 'assigned', 'in_progress', 'waiting_parts', 'paused'])
    .order('updated_at', { ascending: false })
    .limit(10)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="rp-title">Shop</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {clockedInCount} of {employees?.length ?? 0} employee{employees?.length !== 1 ? 's' : ''} clocked in
          </p>
        </div>
        <Link
          href="/shop/clock"
          className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Clock In / Out
        </Link>
      </div>

      {/* Live employee status table */}
      <div className="rp-card overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <h2 className="font-semibold text-gray-900 text-sm">Live Employee Status</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="rp-table w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50">
                <th className="text-left px-4 py-3">Employee</th>
                <th className="text-left px-4 py-3">Clock</th>
                <th className="text-left px-4 py-3">Current Status</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Working On</th>
                <th className="text-right px-4 py-3">Hours Today</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(employees ?? []).map((emp) => {
                const s = statusMap[emp.id]
                const mins = hoursToday[emp.id] ?? 0
                return (
                  <ClickableRow key={emp.id} href={`/shop/employees/${emp.id}`}>
                    <td className="px-4 py-3">
                      <Link href={`/shop/employees/${emp.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                        {emp.full_name}
                      </Link>
                      <p className="text-xs text-gray-400 capitalize">{emp.role.replace('_', ' ')}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5">
                        <span className={cn('w-2 h-2 rounded-full', CLOCK_DOT[s?.clock_status as keyof typeof CLOCK_DOT] ?? 'bg-gray-300')} />
                        <span className="text-xs text-gray-600">
                          {s?.clock_status === 'clocked_in' ? 'In' : 'Out'}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-sm">
                      {s ? STATUS_LABELS[s.current_status] ?? s.current_status : '—'}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {(s as any)?.repair_tickets ? (
                        <Link href={`/tickets/${(s as any).repair_tickets?.id ?? ''}`} className="text-xs text-blue-600 hover:underline">
                          {(s as any).repair_tickets?.ticket_number} — {(s as any).repair_tickets?.title?.slice(0, 30)}
                        </Link>
                      ) : <span className="text-gray-400 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {mins > 0 ? minutesToHHMM(mins) : '—'}
                    </td>
                  </ClickableRow>
                )
              })}
              {!employees?.length && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">No shop employees found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Open tickets */}
      <div className="rp-card overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 text-sm">Active Tickets</h2>
          <Link href="/tickets" className="text-xs text-blue-600 hover:text-blue-800 font-medium">View all →</Link>
        </div>
        <div className="divide-y divide-gray-50">
          {openTickets?.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-gray-400">No open tickets.</p>
          )}
          {openTickets?.map((t) => (
            <div key={t.id} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50">
              <div>
                <Link href={`/tickets/${t.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600">
                  {t.ticket_number} — {t.title}
                </Link>
                <p className="text-xs text-gray-500 mt-0.5">
                  {(t as any).assets?.unit_number ?? 'No asset'} &nbsp;·&nbsp;
                  {(t as any).profiles?.full_name ?? 'Unassigned'}
                </p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                t.status === 'in_progress' ? 'bg-green-100 text-green-800 border-green-200' :
                t.status === 'waiting_parts' ? 'bg-orange-100 text-orange-800 border-orange-200' :
                'bg-gray-100 text-gray-600 border-gray-200'
              }`}>
                {t.status.replace(/_/g, ' ')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
