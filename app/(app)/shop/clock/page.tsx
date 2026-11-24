import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { clockIn, clockOut, setClockJob, type ClockTarget } from '../actions'
import { ClockWidget } from './clock-widget'

export default async function ClockPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('id, company_id, full_name')
    .eq('id', user!.id)
    .single()

  // Current status
  const { data: empStatus } = await admin
    .from('employee_statuses')
    .select('clock_status, current_status, status_updated_at')
    .eq('profile_id', profile!.id)
    .single()

  // Open clock entry (if clocked in)
  const { data: openEntry } = await admin
    .from('time_clock_entries')
    .select('id, clock_in, con_job_id, store_number')
    .eq('profile_id', profile!.id)
    .is('clock_out', null)
    .order('clock_in', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Today's total minutes
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const { data: todayEntries } = await admin
    .from('time_clock_entries')
    .select('total_minutes, clock_in, clock_out')
    .eq('profile_id', profile!.id)
    .gte('clock_in', todayStart.toISOString())

  const todayCompletedMins = (todayEntries ?? [])
    .filter(e => e.clock_out)
    .reduce((sum, e) => sum + (e.total_minutes ?? 0), 0)

  const isClockedIn = empStatus?.clock_status === 'clocked_in'

  // Jobs a person can clock into — receipts they snap while clocked in default to this job.
  const { data: jobs } = await admin
    .from('con_jobs')
    .select('id, site_number, work_order_number')
    .eq('company_id', profile!.company_id)
    .not('stage', 'in', '(complete,quoting)')
    .order('site_number')
    .limit(300)

  async function handleClockIn(target?: ClockTarget) {
    'use server'
    await clockIn(target)
  }

  async function handleSetJob(target: ClockTarget) {
    'use server'
    await setClockJob(target)
  }

  async function handleClockOut() {
    'use server'
    await clockOut()
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="text-sm text-gray-500">Welcome back</p>
          <h1 className="rp-title">{profile?.full_name}</h1>
        </div>

        <ClockWidget
          isClockedIn={isClockedIn}
          clockInTime={openEntry?.clock_in ?? null}
          todayCompletedMins={todayCompletedMins}
          clockInAction={handleClockIn}
          clockOutAction={handleClockOut}
          setJobAction={handleSetJob}
          jobs={(jobs ?? []).map(j => ({ id: j.id as string, label: `${j.site_number ?? '—'}${j.work_order_number ? ` (${j.work_order_number})` : ''}` }))}
          currentJobId={openEntry?.con_job_id ?? null}
          currentStore={openEntry?.store_number ?? null}
        />

        <div className="mt-6 grid grid-cols-3 gap-2">
          <a href="/shop/status" className="rp-card text-center py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Set Status
          </a>
          <a href="/shop/my-tasks" className="rp-card text-center py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            My Tasks
          </a>
          <a href="/shop/general-time" className="rp-card text-center py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Log Time
          </a>
        </div>
      </div>
    </div>
  )
}
