import Link from 'next/link'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { canUseFieldSurveys, isSurveyOnly, SURVEY_ONLY_HOME } from '@/lib/field-surveys'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import { ShareAppButton } from '@/components/mobile/share-app-button'
import { SignOutLink } from '@/components/mobile/sign-out-link'

const STATUS_LABELS: Record<string, string> = {
  clocked_out: 'Clocked Out', at_shop: 'At Shop',
  working_on_ticket: 'Working on Ticket', waiting_parts: 'Waiting on Parts',
  parts_run: 'Parts Run', cleaning_shop: 'Cleaning Shop',
  helping_employee: 'Helping Someone', general_maintenance: 'General Maintenance',
  break: 'On Break', lunch: 'At Lunch', meeting: 'In a Meeting',
  off_site: 'Off Site', other: 'Other',
}

export default async function MobilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('id, company_id, full_name, role')
    .eq('id', user!.id)
    .single()

  const { data: empStatus } = await admin
    .from('employee_statuses')
    .select('clock_status, current_status, current_ticket_id, status_updated_at, repair_tickets(id, ticket_number, title)')
    .eq('profile_id', profile!.id)
    .maybeSingle()

  // Today's hours
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const { data: todayEntries } = await admin
    .from('time_clock_entries')
    .select('clock_in, clock_out, total_minutes')
    .eq('profile_id', profile!.id)
    .gte('clock_in', todayStart.toISOString())

  const now = Date.now()
  const todayMins = (todayEntries ?? []).reduce((sum, e) => {
    return sum + (e.clock_out ? (e.total_minutes ?? 0) : Math.round((now - new Date(e.clock_in).getTime()) / 60000))
  }, 0)

  // The Field Survey Only login has no use for this home screen: straight to its one page.
  if (isSurveyOnly(profile?.role)) redirect(SURVEY_ONLY_HOME)
  const canSurvey = canUseFieldSurveys({ id: profile?.id, role: profile?.role })
  const surveyFirst = profile?.role === 'construction_tech'   // crew: Field Surveys is the big button at the top
  const isClockedIn = empStatus?.clock_status === 'clocked_in'
  const activeTicket = (empStatus as any)?.repair_tickets
  const isWorkingTicket = isClockedIn && empStatus?.current_status === 'working_on_ticket' && !!activeTicket?.id
  const isManager = ['owner', 'manager', 'shop_manager'].includes(profile?.role ?? '')
  // Settings / user management is owner + manager only (matches the Settings page guard)
  const canAdmin = ['owner', 'manager'].includes(profile?.role ?? '')

  // Assigned tickets count
  const { count: myTaskCount } = await admin
    .from('repair_tickets')
    .select('*', { count: 'exact', head: true })
    .eq('assigned_to', profile!.id)
    .not('status', 'in', '(completed,closed,deferred)')

  const firstName = profile?.full_name?.split(' ')[0] ?? 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="relative overflow-hidden text-white px-6 pt-10 pb-8 rounded-b-3xl shadow-lg"
        style={{ background: 'linear-gradient(135deg, #16243d 0%, #1e3558 55%, #2d4e7a 100%)' }}>
        <div className="pointer-events-none absolute -top-16 -right-10 w-52 h-52 rounded-full bg-blue-300/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-8 w-52 h-52 rounded-full bg-green-400/10 blur-3xl" />
        <div className="relative">
        <div className="flex items-center gap-2 mb-4">
          <span className="inline-flex items-center justify-center bg-white rounded-lg p-1">
            <Image src="/logo-mark-v2.png" alt="" width={32} height={32} className="h-7 w-7" />
          </span>
          <span className="font-semibold tracking-tight text-white/95">RP Intelligence</span>
        </div>
        <p className="text-white/60 text-sm">{greeting}</p>
        <h1 className="text-2xl font-bold mt-0.5">{firstName}</h1>

        {/* Status pill — tap to open the active ticket when working one */}
        {isWorkingTicket ? (
          <Link
            href={`/tickets/${activeTicket.id}`}
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full text-sm font-semibold bg-green-500/30 text-green-100 hover:bg-green-500/45 transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-green-300" />
            {STATUS_LABELS['working_on_ticket']}
            <span className="opacity-80">→</span>
          </Link>
        ) : (
          <div className={cn(
            'inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full text-sm font-semibold',
            isClockedIn ? 'bg-green-500/30 text-green-100' : 'bg-white/20 text-white/80'
          )}>
            <span className={cn('w-2 h-2 rounded-full', isClockedIn ? 'bg-green-300' : 'bg-white/50')} />
            {isClockedIn
              ? STATUS_LABELS[empStatus?.current_status ?? ''] ?? 'Clocked In'
              : 'Clocked Out'}
          </div>
        )}

        {todayMins > 0 && (
          <p className="text-white/60 text-xs mt-2">
            {Math.floor(todayMins / 60)}h {todayMins % 60}m today
          </p>
        )}
        </div>
      </div>

      {/* Active ticket banner */}
      {isClockedIn && (empStatus as any)?.repair_tickets && (
        <Link
          href={`/tickets/${(empStatus as any).repair_tickets.id}`}
          className="mx-4 -mt-4 bg-white rounded-xl border border-green-200 shadow-sm px-4 py-3 flex items-center justify-between"
        >
          <div>
            <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Active Ticket</p>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">
              {(empStatus as any).repair_tickets.ticket_number} — {(empStatus as any).repair_tickets.title?.slice(0, 40)}
            </p>
          </div>
          <span className="text-green-600 text-lg">→</span>
        </Link>
      )}

      {/* Main actions */}
      <div className="flex-1 px-4 py-6 space-y-3">

        {/* Construction crew: Field Surveys one tap from the home screen */}
        {surveyFirst && (
          <Link href="/construction/surveys" className="flex items-center justify-between w-full rounded-2xl px-6 py-5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg shadow-sm">
            <span>📸 Field Surveys</span>
            <span className="text-2xl opacity-80">→</span>
          </Link>
        )}

        {/* Field service ticket — sign on the phone, invoice from the office */}
        <Link
          href="/mobile/service-ticket"
          className="flex items-center justify-between w-full rounded-2xl px-6 py-4 bg-white border border-gray-200 shadow-sm font-semibold text-gray-900"
        >
          <span>🧾 Service Ticket</span>
          <span className="text-gray-400">→</span>
        </Link>

        {/* Primary action — clock */}
        <Link
          href="/shop/clock"
          className={cn(
            'flex items-center justify-between w-full rounded-2xl px-6 py-5 text-white font-bold text-lg shadow-sm',
            isClockedIn ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
          )}
        >
          <span>{isClockedIn ? '🔴 Clock Out' : '🟢 Clock In'}</span>
          <span className="text-2xl opacity-80">→</span>
        </Link>

        {/* Secondary actions grid */}
        <div className="grid grid-cols-2 gap-3">
          <Link href="/shop/status" className="bg-white rounded-2xl border border-gray-200 px-4 py-5 flex flex-col items-center gap-2 hover:border-blue-300 transition-colors">
            <span className="text-3xl">🏷️</span>
            <span className="text-sm font-semibold text-gray-800">Set Status</span>
          </Link>

          <Link href="/shop/my-tasks" className="bg-white rounded-2xl border border-gray-200 px-4 py-5 flex flex-col items-center gap-2 hover:border-blue-300 transition-colors relative">
            <span className="text-3xl">📋</span>
            <span className="text-sm font-semibold text-gray-800">My Tasks</span>
            {(myTaskCount ?? 0) > 0 && (
              <span className="absolute top-3 right-3 w-5 h-5 bg-blue-600 text-white text-xs font-bold rounded-full flex items-center justify-center">
                {myTaskCount}
              </span>
            )}
          </Link>

          <Link href="/mobile/report-issue" className="bg-white rounded-2xl border border-gray-200 px-4 py-5 flex flex-col items-center gap-2 hover:border-blue-300 transition-colors">
            <span className="text-3xl">⚠️</span>
            <span className="text-sm font-semibold text-gray-800">Report Issue</span>
          </Link>

          <Link href="/mobile/mileage" className="bg-white rounded-2xl border border-gray-200 px-4 py-5 flex flex-col items-center gap-2 hover:border-blue-300 transition-colors">
            <span className="text-3xl">🚗</span>
            <span className="text-sm font-semibold text-gray-800">Log Mileage</span>
          </Link>

          <Link href="/mobile/daily-update" className="bg-white rounded-2xl border border-gray-200 px-4 py-5 flex flex-col items-center gap-2 hover:border-blue-300 transition-colors">
            <span className="text-3xl">📋</span>
            <span className="text-sm font-semibold text-gray-800">Daily Update</span>
          </Link>
          {canSurvey && !surveyFirst && (
            <Link href="/construction/surveys" className="bg-white rounded-2xl border border-gray-200 px-4 py-5 flex flex-col items-center gap-2 hover:border-blue-300 transition-colors">
              <span className="text-3xl">📸</span>
              <span className="text-sm font-semibold text-gray-800">Field Survey</span>
            </Link>
          )}

          <Link href="/shop/general-time" className="bg-white rounded-2xl border border-gray-200 px-4 py-5 flex flex-col items-center gap-2 hover:border-blue-300 transition-colors">
            <span className="text-3xl">⏱️</span>
            <span className="text-sm font-semibold text-gray-800">Log Shop Time</span>
          </Link>

          {isManager ? (
            <Link href="/maintenance" className="bg-white rounded-2xl border border-gray-200 px-4 py-5 flex flex-col items-center gap-2 hover:border-blue-300 transition-colors">
              <span className="text-3xl">📊</span>
              <span className="text-sm font-semibold text-gray-800">Maintenance Dashboard</span>
            </Link>
          ) : (
            <Link href="/tickets" className="bg-white rounded-2xl border border-gray-200 px-4 py-5 flex flex-col items-center gap-2 hover:border-blue-300 transition-colors">
              <span className="text-3xl">🔧</span>
              <span className="text-sm font-semibold text-gray-800">All Tickets</span>
            </Link>
          )}

          {/* Owners & managers — admin access on any device */}
          {canAdmin && (
            <Link href="/settings" className="bg-white rounded-2xl border border-gray-200 px-4 py-5 flex flex-col items-center gap-2 hover:border-blue-300 transition-colors">
              <span className="text-3xl">⚙️</span>
              <span className="text-sm font-semibold text-gray-800">Settings</span>
            </Link>
          )}

          {canAdmin && (
            <Link href="/settings/users" className="bg-white rounded-2xl border border-gray-200 px-4 py-5 flex flex-col items-center gap-2 hover:border-blue-300 transition-colors">
              <span className="text-3xl">👥</span>
              <span className="text-sm font-semibold text-gray-800">Users</span>
            </Link>
          )}
        </div>
      </div>

      {/* Install hint + share + sign out */}
      <div className="px-6 pb-24 text-center space-y-3">
        <p className="text-xs text-gray-400">
          Add to Home Screen for quick access:{' '}
          <span className="font-medium">tap Share → Add to Home Screen</span>
        </p>
        <div className="flex items-center justify-center gap-6">
          <ShareAppButton />
          <SignOutLink />
        </div>
      </div>
    </div>
  )
}
