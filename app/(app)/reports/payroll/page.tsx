import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { bulkApprove } from '../../time/actions'
import { EmployeeSelect } from '@/components/reports/employee-select'
import { Download } from 'lucide-react'

// ── Date helpers ──────────────────────────────────────────────────────────────

function getMonday(d: Date) {
  const day = d.getDay()
  const diff = d.getDate() - (day === 0 ? 6 : day - 1)
  const mon = new Date(d)
  mon.setDate(diff)
  mon.setHours(0, 0, 0, 0)
  return mon
}

function addDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(d.getDate() + n)
  return r
}

function toISO(d: Date) { return d.toISOString().split('T')[0] }

function getPeriodRange(period: string, customStart?: string, customEnd?: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (period === 'last_week') {
    const mon = getMonday(addDays(today, -7))
    return { start: mon, end: addDays(mon, 6), label: 'Last Week' }
  }
  if (period === 'this_month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1)
    const end   = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    return { start, end, label: 'This Month' }
  }
  if (period === 'last_month') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const end   = new Date(today.getFullYear(), today.getMonth(), 0)
    return { start, end, label: 'Last Month' }
  }
  if (period === 'custom' && customStart && customEnd) {
    return { start: new Date(customStart), end: new Date(customEnd), label: 'Custom Range' }
  }
  // default: this week
  const mon = getMonday(today)
  return { start: mon, end: addDays(mon, 6), label: 'This Week' }
}

function fmtHours(mins: number) {
  return (mins / 60).toFixed(2)
}

function dayLabel(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; start?: string; end?: string; employee?: string }>
}) {
  const { period = 'this_week', start: customStart, end: customEnd, employee: empFilter } =
    await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id, role').eq('id', user!.id).single()

  if (!profile || !['owner', 'manager', 'shop_manager'].includes(profile.role)) {
    redirect('/dashboard')
  }

  const { start, end, label } = getPeriodRange(period, customStart, customEnd)
  const startISO = toISO(start)
  const endISO   = toISO(end)

  // Employees
  const { data: employees } = await admin
    .from('profiles')
    .select('id, full_name')
    .eq('company_id', profile.company_id)
    .in('role', ['shop_employee', 'shop_manager'])
    .eq('is_active', true)
    .order('full_name')

  // Time entries for this period
  let query = admin
    .from('time_clock_entries')
    .select('id, profile_id, clock_in, clock_out, total_minutes, is_approved, manually_adjusted')
    .eq('company_id', profile.company_id)
    .gte('clock_in', start.toISOString())
    .lte('clock_in', new Date(endISO + 'T23:59:59.999Z').toISOString())
    .order('clock_in')

  if (empFilter) query = (query as any).eq('profile_id', empFilter)

  const { data: entries } = await query

  // Build per-employee per-day minutes map
  const empDayMap: Record<string, Record<string, number>> = {}
  const empTotalMap: Record<string, number> = {}

  for (const e of entries ?? []) {
    if (!empDayMap[e.profile_id]) empDayMap[e.profile_id] = {}
    const dayKey = e.clock_in.split('T')[0]
    const mins = e.clock_out ? (e.total_minutes ?? 0) : 0 // only count closed entries
    empDayMap[e.profile_id][dayKey] = (empDayMap[e.profile_id][dayKey] ?? 0) + mins
    empTotalMap[e.profile_id] = (empTotalMap[e.profile_id] ?? 0) + mins
  }

  // Build days array for the period
  const days: Date[] = []
  let d = new Date(start)
  while (d <= end) { days.push(new Date(d)); d = addDays(d, 1) }

  const totalAllMins = Object.values(empTotalMap).reduce((s, m) => s + m, 0)
  const unapprovedCount = (entries ?? []).filter(e => !e.is_approved && e.clock_out).length

  // Bulk approve action
  async function handleBulkApprove() {
    'use server'
    await bulkApprove(startISO, endISO)
  }

  const csvUrl = `/api/reports/payroll-csv?start=${startISO}&end=${endISO}${empFilter ? `&employee=${empFilter}` : ''}`

  const PERIODS = [
    { value: 'this_week',   label: 'This Week' },
    { value: 'last_week',   label: 'Last Week' },
    { value: 'this_month',  label: 'This Month' },
    { value: 'last_month',  label: 'Last Month' },
  ]

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href="/reports" className="hover:text-gray-700">Reports</Link>
            <span>/</span>
            <span>Payroll</span>
          </div>
          <h1 className="rp-title">Payroll Report</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {label} · {start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <a
          href={csvUrl}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-600/90 transition-colors shrink-0"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </a>
      </div>

      {/* Period + employee filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        {PERIODS.map(p => (
          <Link
            key={p.value}
            href={`/reports/payroll?period=${p.value}${empFilter ? `&employee=${empFilter}` : ''}`}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              period === p.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            {p.label}
          </Link>
        ))}

        <EmployeeSelect
          employees={employees ?? []}
          currentValue={empFilter ?? ''}
          period={period}
        />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rp-card p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{fmtHours(totalAllMins)}</p>
          <p className="text-xs font-medium text-gray-500 mt-0.5">Total Hours</p>
        </div>
        <div className="rp-card p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{(entries ?? []).filter(e => e.clock_out).length}</p>
          <p className="text-xs font-medium text-gray-500 mt-0.5">Completed Shifts</p>
        </div>
        <div className={`rounded-xl border p-4 text-center ${unapprovedCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-card border-gray-200'}`}>
          <p className={`text-2xl font-bold ${unapprovedCount > 0 ? 'text-amber-700' : 'text-gray-900'}`}>{unapprovedCount}</p>
          <p className="text-xs font-medium text-gray-500 mt-0.5">Pending Approval</p>
        </div>
      </div>

      {/* Weekly grid */}
      <div className="rp-card overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 text-sm">Hours by Employee</h2>
          {unapprovedCount > 0 && (
            <form action={handleBulkApprove}>
              <button type="submit" className="text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 border border-blue-200 px-3 py-1 rounded-full transition-colors">
                Approve All ({unapprovedCount})
              </button>
            </form>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="rp-table w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-2.5">Employee</th>
                {days.map(day => (
                  <th key={toISO(day)} className="text-center px-2 py-2.5 font-medium text-gray-500 whitespace-nowrap min-w-[70px]">
                    {dayLabel(day)}
                  </th>
                ))}
                <th className="text-right px-4 py-2.5 text-gray-900">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(empFilter ? employees?.filter(e => e.id === empFilter) : employees)?.map(emp => {
                const dayHours = empDayMap[emp.id] ?? {}
                const total = empTotalMap[emp.id] ?? 0
                return (
                  <tr key={emp.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                      <Link href={`/shop/employees/${emp.id}`} className="hover:text-blue-600">
                        {emp.full_name}
                      </Link>
                    </td>
                    {days.map(day => {
                      const mins = dayHours[toISO(day)] ?? 0
                      return (
                        <td key={toISO(day)} className={`text-center px-2 py-3 tabular-nums ${
                          mins === 0 ? 'text-gray-300' :
                          mins > 540 ? 'text-amber-700 font-semibold' :
                          'text-gray-800'
                        }`}>
                          {mins > 0 ? fmtHours(mins) : '—'}
                        </td>
                      )
                    })}
                    <td className="text-right px-4 py-3 font-bold text-gray-900 tabular-nums">
                      {total > 0 ? fmtHours(total) : '—'}
                    </td>
                  </tr>
                )
              })}
              {/* Totals row */}
              <tr className="bg-gray-50 border-t-2 border-gray-200">
                <td className="px-4 py-3 font-bold text-gray-700">Total</td>
                {days.map(day => {
                  const dayTotal = (entries ?? [])
                    .filter(e => e.clock_in.startsWith(toISO(day)) && e.clock_out)
                    .reduce((s, e) => s + (e.total_minutes ?? 0), 0)
                  return (
                    <td key={toISO(day)} className="text-center px-2 py-3 font-bold text-gray-700 tabular-nums">
                      {dayTotal > 0 ? fmtHours(dayTotal) : '—'}
                    </td>
                  )
                })}
                <td className="text-right px-4 py-3 font-bold text-gray-900 tabular-nums">
                  {fmtHours(totalAllMins)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Detailed entries */}
      <div className="rp-card overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <h2 className="font-semibold text-gray-900 text-sm">Time Entry Detail</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="rp-table w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-2.5 hidden md:table-cell">Employee</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Clock In</th>
                <th className="text-left px-4 py-2.5">Clock Out</th>
                <th className="text-right px-4 py-2.5">Hours</th>
                <th className="text-center px-4 py-2.5">Approved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(entries ?? []).map(e => {
                const emp = employees?.find(em => em.id === e.profile_id)
                const hours = e.clock_out ? fmtHours(e.total_minutes ?? 0) : null
                return (
                  <tr key={e.id} className={`hover:bg-gray-50 ${!e.is_approved && e.clock_out ? 'bg-amber-50' : ''}`}>
                    <td className="px-4 py-3 text-gray-700 hidden md:table-cell">{emp?.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {new Date(e.clock_in).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {e.manually_adjusted && <span className="ml-1 text-xs text-purple-600">✎</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap tabular-nums">
                      {new Date(e.clock_in).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                      {e.clock_out
                        ? <span className="text-gray-700">{new Date(e.clock_out).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                        : <span className="text-green-600 font-medium">Active</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {hours ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {e.is_approved
                        ? <span className="text-green-600 text-xs font-medium">✓ Approved</span>
                        : e.clock_out
                          ? <Link href="/time/approvals" className="text-xs text-amber-600 hover:text-amber-800 font-medium">Pending</Link>
                          : <span className="text-gray-400 text-xs">Open</span>}
                    </td>
                  </tr>
                )
              })}
              {!entries?.length && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">No time entries for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
