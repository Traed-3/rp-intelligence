/**
 * The time clock's background guard: catches a forgotten clock-out.
 * Called every 10 minutes by pg_cron (GET /api/time/clock-guard, migration time_clock_guard.sql).
 * The rules themselves are `guardAction` in lib/time-clock.ts.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { sendAlertEmail } from '@/lib/email'
import { sendPushNotification } from '@/lib/push'
import { AUTO_OUT_HOURS, TIME_MANAGER_ROLES, guardAction, nyTime, parseClockReminder } from '@/lib/time-clock'

type Admin = ReturnType<typeof createAdminClient>
const CLOCK_LINK = '/shop/clock'
const FIX_LINK = '/time/approvals'

/** Bell + push (unless the person switched push off for this alert) + email (when they asked for it, or `email`). */
async function tell(admin: Admin, o: { companyId: string; profileId: string; type: string; title: string; message: string; link: string; email?: boolean; push?: boolean }) {
  await admin.from('notifications').insert({ company_id: o.companyId, recipient_id: o.profileId, type: o.type, title: o.title, message: o.message, link: o.link })
  const [{ data: pref }, { data: person }] = await Promise.all([
    admin.from('alert_preferences').select('email_enabled, push_enabled').eq('profile_id', o.profileId).eq('alert_type', 'clock_out_reminder').maybeSingle(),
    admin.from('profiles').select('email, is_active').eq('id', o.profileId).maybeSingle(),
  ])
  if (!person?.is_active) return
  if (o.push !== false && pref?.push_enabled !== false) {
    const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth_key').eq('profile_id', o.profileId)
    await Promise.all((subs ?? []).map(s => sendPushNotification(s, { title: o.title, message: o.message, link: o.link }).catch(() => 'failed')))
  }
  if ((o.email || pref?.email_enabled) && person.email) {
    await sendAlertEmail({ to: person.email, subject: o.title, title: o.title, message: o.message, link: o.link }).catch(() => {})
  }
}

/**
 * Close an entry nobody clocked out of. The hours are held at 0 and the entry is flagged, so nothing is paid
 * on a guess: a manager has to put in the real clock-out before it can be approved.
 * Only closes an entry that is still open (so a clock-out that lands at the same moment wins).
 */
export async function autoClockOut(admin: Admin, entry: { id: string; profile_id: string; company_id: string; clock_in: string }, hours: number, now = new Date()): Promise<boolean> {
  const { data: closed } = await admin.from('time_clock_entries').update({
    clock_out: now.toISOString(),
    total_minutes: 0,
    needs_review: true,
    review_reason: `Never clocked out. Clocked out by the system after ${hours} hours; hours are held at 0 until the real clock-out is entered.`,
    auto_clocked_out_at: now.toISOString(),
    original_clock_in: entry.clock_in,
  }).eq('id', entry.id).is('clock_out', null).select('id')
  if (!closed?.length) return false

  // Same clean-up as a normal clock-out: stop a running labor timer, show the person as clocked out.
  const { data: status } = await admin.from('employee_statuses').select('active_labor_entry_id').eq('profile_id', entry.profile_id).maybeSingle()
  if (status?.active_labor_entry_id) {
    await admin.from('labor_entries').update({ ended_at: now.toISOString(), total_minutes: 0, is_active: false, notes: 'Closed by the system: never clocked out. Needs the real time.' })
      .eq('id', status.active_labor_entry_id).eq('is_active', true)
  }
  const { data: stillOpen } = await admin.from('time_clock_entries').select('id').eq('profile_id', entry.profile_id).is('clock_out', null).limit(1)
  if (!stillOpen?.length) {
    await admin.from('employee_statuses').upsert({
      profile_id: entry.profile_id, company_id: entry.company_id, clock_status: 'clocked_out', current_status: 'clocked_out',
      current_ticket_id: null, current_asset_id: null, current_task_note: null, active_labor_entry_id: null, status_updated_at: now.toISOString(),
    }, { onConflict: 'profile_id' })
  }
  return true
}

export type GuardResult = { open: number; reminded: number; autoOut: number }

export async function runClockGuard(admin: Admin = createAdminClient(), now = new Date()): Promise<GuardResult> {
  const out: GuardResult = { open: 0, reminded: 0, autoOut: 0 }
  const { data: open } = await admin.from('time_clock_entries')
    .select('id, profile_id, company_id, clock_in, reminded_at, remind_count')
    .is('clock_out', null).order('clock_in').limit(500)
  if (!open?.length) return out
  out.open = open.length

  const ids = [...new Set(open.map(e => e.profile_id as string))]
  const { data: people } = await admin.from('profiles').select('id, full_name, ui_prefs, company_id').in('id', ids)
  const person = new Map((people ?? []).map(p => [p.id as string, p]))
  const managersOf = new Map<string, string[]>()

  for (const e of open) {
    const p = person.get(e.profile_id as string)
    if (!p || !e.company_id) continue
    const reminder = parseClockReminder((p.ui_prefs as Record<string, unknown> | null)?.clock_reminder)
    const act = guardAction(e, reminder, now)
    if (act.kind === 'none') continue

    if (act.kind === 'auto_out') {
      if (!(await autoClockOut(admin, e as never, act.hours, now))) continue
      out.autoOut++
      const since = `${nyTime(e.clock_in)} on ${new Date(e.clock_in).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' })}`
      await tell(admin, {
        companyId: e.company_id, profileId: e.profile_id, type: 'clock_out_reminder', link: '/time',
        title: 'You were clocked out automatically',
        message: `You clocked in at ${since} and never clocked out. After ${AUTO_OUT_HOURS} hours the clock stopped itself and your hours for that shift are on hold. Open Time Entries and send in the time you really finished.`,
      })
      if (!managersOf.has(e.company_id)) {
        const { data: m } = await admin.from('profiles').select('id').eq('company_id', e.company_id).eq('is_active', true).in('role', [...TIME_MANAGER_ROLES])
        managersOf.set(e.company_id, (m ?? []).map(x => x.id as string))
      }
      const rows = managersOf.get(e.company_id)!.filter(id => id !== e.profile_id).map(id => ({
        company_id: e.company_id, recipient_id: id, type: 'time_needs_fixing', link: FIX_LINK,
        title: `${p.full_name} never clocked out`,
        message: `Clocked in at ${since}. The clock stopped itself and the hours are on hold until someone enters the real clock-out.`,
      }))
      if (rows.length) await admin.from('notifications').insert(rows)
      continue
    }

    // A reminder. Mark it first so two runs close together cannot both send.
    const { data: marked } = await admin.from('time_clock_entries')
      .update({ reminded_at: now.toISOString(), remind_count: (e.remind_count ?? 0) + 1 })
      .eq('id', e.id).is('clock_out', null)
      .filter('reminded_at', e.reminded_at ? 'eq' : 'is', e.reminded_at ?? null)
      .select('id')
    if (!marked?.length) continue
    out.reminded++
    const left = Math.max(1, AUTO_OUT_HOURS - act.hours)
    await tell(admin, {
      companyId: e.company_id, profileId: e.profile_id, type: 'clock_out_reminder', link: CLOCK_LINK,
      email: act.why === 'personal',
      title: act.why === 'personal' ? `It is past ${nyTime(now)} and you are still clocked in` : 'Did you forget to clock out?',
      message: act.why === 'personal'
        ? `You clocked in at ${nyTime(e.clock_in)} and have not clocked out. Tap to clock out. This reminder repeats every hour until you do.`
        : `You have been clocked in for ${act.hours} hours (since ${nyTime(e.clock_in)}). Tap to clock out. If nobody does, the clock stops itself in about ${left} hour${left === 1 ? '' : 's'} and a manager has to enter your time.`,
    })
  }
  return out
}
