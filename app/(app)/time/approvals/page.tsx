import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { approveTimeEntry, unapproveTimeEntry } from '../actions'

export default async function ApprovalsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id, role').eq('id', user!.id).single()

  if (!profile || !['owner', 'manager', 'shop_manager'].includes(profile.role)) {
    redirect('/dashboard')
  }

  const { data: entries } = await admin
    .from('time_clock_entries')
    .select('id, profile_id, clock_in, clock_out, total_minutes, is_approved, manually_adjusted, adjustment_note, profiles(full_name)')
    .eq('company_id', profile.company_id)
    .eq('is_approved', false)
    .not('clock_out', 'is', null)
    .order('clock_in', { ascending: false })
    .limit(50)

  function fmtHours(mins: number | null) {
    if (!mins) return '—'
    return (mins / 60).toFixed(2) + ' hrs'
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/time" className="text-sm text-gray-500 hover:text-gray-700">← Time Entries</Link>
        <span className="text-gray-300">/</span>
        <h1 className="rp-title">Pending Approvals</h1>
      </div>

      {!entries?.length ? (
        <div className="rp-card p-12 text-center">
          <p className="text-4xl mb-3">✅</p>
          <p className="font-semibold text-gray-900">All caught up!</p>
          <p className="text-sm text-gray-500 mt-1">No time entries pending approval.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-4">{entries.length} entr{entries.length !== 1 ? 'ies' : 'y'} pending approval.</p>
          <div className="rp-card overflow-hidden">
            <div className="divide-y divide-gray-50">
              {entries.map(e => {
                const emp = (e as any).profiles
                async function handleApprove() {
                  'use server'
                  await approveTimeEntry(e.id)
                }
                return (
                  <div key={e.id} className="px-5 py-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{emp?.full_name ?? '—'}</p>
                      <p className="text-sm text-gray-600">
                        {new Date(e.clock_in).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {new Date(e.clock_in).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        {' → '}
                        {new Date(e.clock_out!).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        {' · '}
                        <span className="font-medium text-gray-700">{fmtHours(e.total_minutes)}</span>
                        {e.manually_adjusted && <span className="ml-2 text-purple-600">✎ Adjusted</span>}
                      </p>
                    </div>
                    <form action={handleApprove}>
                      <button
                        type="submit"
                        className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-600/90 transition-colors shrink-0"
                      >
                        Approve
                      </button>
                    </form>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
