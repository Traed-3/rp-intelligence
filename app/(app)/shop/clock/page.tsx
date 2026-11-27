import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { clockIn, clockOut, setClockJob, type ClockTarget } from '../actions'
import { ClockWidget } from './clock-widget'
import { saveClockReminder } from '../../time/actions'
import { WEEKDAYS, nyDay, nyRange, parseClockReminder } from '@/lib/time-clock'

export default async function ClockPage({ searchParams }: { searchParams: Promise<{ reminder?: string }> }) {
  const { reminder: reminderMsg } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('id, company_id, full_name, ui_prefs')
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
  const today = nyDay(new Date())                    // the Eastern day, not the server's
  const reminder = parseClockReminder((profile?.ui_prefs as Record<string, unknown> | null)?.clock_reminder)
  const remindDays = reminder?.days ?? WEEKDAYS
  const { data: todayEntries } = await admin
    .from('time_clock_entries')
    .select('total_minutes, clock_in, clock_out')
    .eq('profile_id', profile!.id)
    .gte('clock_in', nyRange(today, today).from)

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
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
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

        {/* My own clock-out reminder */}
        <details className="rp-card mt-4" open={!!reminderMsg}>
          <summary className="cursor-pointer select-none px-5 py-3 text-sm font-semibold text-gray-700">
            Clock-out reminder: {reminder ? `on, ${new Date(`2000-01-01T${reminder.time}:00Z`).toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' })} ${reminder.days.join('') === '12345' ? 'Mon to Fri' : 'on your days'}` : 'off'}
          </summary>
          <form action={saveClockReminder} className="border-t border-gray-100 p-5 text-sm">
            {reminderMsg === 'saved' && <p className="mb-3 font-medium text-green-700">Saved.</p>}
            {reminderMsg === 'off' && <p className="mb-3 font-medium text-gray-600">Reminder turned off.</p>}
            {reminderMsg === 'bad' && <p className="mb-3 font-medium text-red-600">Pick a time and at least one day.</p>}
            <label className="flex items-center gap-2 font-medium text-gray-800">
              <input type="checkbox" name="on" defaultChecked={!!reminder} className="size-4" />
              Remind me if I am still clocked in at
              <input type="time" name="time" defaultValue={reminder?.time ?? '19:00'} className="rounded-lg border border-gray-300 px-2 py-1" />
            </label>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                <label key={d} className="flex items-center gap-1.5 text-gray-700">
                  <input type="checkbox" name="days" value={i} defaultChecked={remindDays.includes(i)} className="size-4" />{d}
                </label>
              ))}
            </div>
            <p className="mt-3 text-xs text-gray-500">
              You get a phone notification and an email, then again every hour until you clock out. Everyone also gets a
              reminder after 12 hours on the clock, and the clock stops itself at 18 hours so a manager can enter the real time.
              Phone notifications need to be switched on for this phone (Settings, Alerts).
            </p>
            <button type="submit" className="mt-3 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold">Save</button>
          </form>
        </details>

        <a href="/time" className="mt-4 block text-center text-sm font-semibold text-brand hover:underline">My time entries: check a shift or send in a correction</a>

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
