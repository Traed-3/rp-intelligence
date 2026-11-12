import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export default async function TimeEntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; approved?: string }>
}) {
  const { employee: empFilter, approved: approvedFilter } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id, role, id').eq('id', user!.id).single()

  const isManager = ['owner', 'manager', 'shop_manager'].includes(profile?.role ?? '')

  const { data: employees } = isManager
    ? await admin.from('profiles').select('id, full_name').eq('company_id', profile!.company_id).in('role', ['shop_employee', 'shop_manager']).order('full_name')
    : { data: null }

  // 30 day window
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  let query = admin
    .from('time_clock_entries')
    .select('id, profile_id, clock_in, clock_out, total_minutes, is_approved, manually_adjusted, profiles(full_name)')
    .eq('company_id', profile!.company_id)
    .gte('clock_in', thirtyDaysAgo.toISOString())
    .order('clock_in', { ascending: false })
    .limit(100)

  // Non-managers can only see their own
  if (!isManager) query = (query as any).eq('profile_id', profile!.id)
  else if (empFilter) query = (query as any).eq('profile_id', empFilter)

  if (approvedFilter === 'pending') query = (query as any).eq('is_approved', false).not('clock_out', 'is', null)
  if (approvedFilter === 'approved') query = (query as any).eq('is_approved', true)

  const { data: entries } = await query

  const pendingCount = entries?.filter(e => !e.is_approved && e.clock_out).length ?? 0

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="rp-title">Time Entries</h1>
          <p className="text-sm text-gray-500 mt-0.5">Last 30 days</p>
        </div>
        <div className="flex gap-2">
          {isManager && pendingCount > 0 && (
            <Link href="/time/approvals" className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors">
              {pendingCount} Pending Approval
            </Link>
          )}
          <Link href="/reports/payroll" className="px-4 py-2 rounded-lg border border-gray-300 bg-card text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Payroll Report →
          </Link>
        </div>
      </div>

      {/* Filters */}
      {isManager && (
        <div className="flex flex-wrap gap-2 mb-5">
          {[
            { value: '', label: 'All' },
            { value: 'pending', label: 'Pending' },
            { value: 'approved', label: 'Approved' },
          ].map(f => (
            <Link
              key={f.value}
              href={`/time?approved=${f.value}${empFilter ? `&employee=${empFilter}` : ''}`}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                (approvedFilter ?? '') === f.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      )}

      <div className="rp-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="rp-table w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {isManager && <th className="text-left px-4 py-2.5">Employee</th>}
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Clock In</th>
                <th className="text-left px-4 py-2.5">Clock Out</th>
                <th className="text-right px-4 py-2.5">Hours</th>
                <th className="text-center px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries?.map(e => (
                <tr key={e.id} className={`hover:bg-gray-50 ${!e.is_approved && e.clock_out ? 'bg-amber-50/50' : ''}`}>
                  {isManager && <td className="px-4 py-3 text-gray-700">{(e as any).profiles?.full_name ?? '—'}</td>}
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                    {new Date(e.clock_in).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    {e.manually_adjusted && <span className="ml-1 text-purple-600 text-xs">✎</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-700 tabular-nums whitespace-nowrap">
                    {new Date(e.clock_in).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap">
                    {e.clock_out
                      ? <span className="text-gray-700">{new Date(e.clock_out).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                      : <span className="text-green-600 font-medium">Active</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {e.clock_out && e.total_minutes ? (e.total_minutes / 60).toFixed(2) : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {e.is_approved
                      ? <span className="text-xs text-green-700 font-medium bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">Approved</span>
                      : e.clock_out
                        ? <Link href="/time/approvals" className="text-xs text-amber-700 font-medium bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full hover:bg-amber-100">Pending</Link>
                        : <span className="text-xs text-gray-400">Open</span>}
                  </td>
                </tr>
              ))}
              {!entries?.length && (
                <tr><td colSpan={isManager ? 6 : 5} className="px-4 py-8 text-center text-sm text-gray-400">No time entries found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
