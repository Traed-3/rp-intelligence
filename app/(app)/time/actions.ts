'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { buildFix, isDay, isTimeManager, nyDay, nyParts, nyRange, parseClockReminder } from '@/lib/time-clock'

type Admin = ReturnType<typeof createAdminClient>

async function getProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from('profiles')
    .select('id, company_id, role, full_name, ui_prefs')
    .eq('id', user.id)
    .single()
  return data
}

function refresh() {
  revalidatePath('/time')
  revalidatePath('/time/approvals')
  revalidatePath('/reports/payroll')
  revalidatePath('/shop/clock')
}

const text = (v: FormDataEntryValue | null, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** The entry, only when it belongs to the manager's company. */
async function companyEntry(admin: Admin, companyId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data } = await admin.from('time_clock_entries')
    .select('id, profile_id, company_id, clock_in, clock_out, total_minutes, break_minutes, is_approved, needs_review, original_clock_in, original_clock_out, adjustment_note, fix_requested_at, fix_requested_in, fix_requested_out, fix_requested_break, fix_request_note')
    .eq('id', id).eq('company_id', companyId).maybeSingle()
  return data
}

/** Where a form goes back to, with a short message. Only our own two pages. */
function back(formData: FormData, params: Record<string, string>): never {
  const to = text(formData.get('back')) === 'time' ? '/time' : '/time/approvals'
  redirect(`${to}?${new URLSearchParams(params).toString()}`)
}

// ── Approve single entry ──────────────────────────────────────────────────────

export async function approveTimeEntry(entryId: string) {
  const profile = await getProfile()
  if (!profile || !isTimeManager(profile.role)) return

  const admin = createAdminClient()
  // An entry that still needs fixing, or was never clocked out, cannot be approved.
  await admin.from('time_clock_entries').update({
    is_approved: true,
    approved_by: profile.id,
    approved_at: new Date().toISOString(),
  }).eq('id', entryId).eq('company_id', profile.company_id).eq('needs_review', false).not('clock_out', 'is', null)

  refresh()
}

/** Approve button on the Fix & Approve list (one plain form per row). */
export async function approveEntryForm(formData: FormData) {
  await approveTimeEntry(text(formData.get('id')))
}

// ── Unapprove ─────────────────────────────────────────────────────────────────

export async function unapproveTimeEntry(entryId: string) {
  const profile = await getProfile()
  if (!profile || !isTimeManager(profile.role)) return

  const admin = createAdminClient()
  await admin.from('time_clock_entries').update({
    is_approved: false,
    approved_by: null,
    approved_at: null,
  }).eq('id', entryId).eq('company_id', profile.company_id)

  refresh()
}

// ── Bulk approve by date range (Eastern days, both included) ──────────────────

export async function bulkApprove(start: string, end: string) {
  const profile = await getProfile()
  if (!profile || !isTimeManager(profile.role)) return
  if (!isDay(start) || !isDay(end)) return

  const admin = createAdminClient()
  const { from, before } = nyRange(start, end)
  await admin.from('time_clock_entries')
    .update({
      is_approved: true,
      approved_by: profile.id,
      approved_at: new Date().toISOString(),
    })
    .eq('company_id', profile.company_id)
    .gte('clock_in', from)
    .lt('clock_in', before)
    .eq('is_approved', false)
    .eq('needs_review', false)        // never the ones waiting on a fix
    .not('clock_out', 'is', null)     // only closed entries

  refresh()
}

// ── Fix an entry (manager) ────────────────────────────────────────────────────

/** What the fix form posts: id, day, in, out, break (minutes), note, optional job. */
export async function fixTimeEntry(formData: FormData) {
  const profile = await getProfile()
  if (!profile || !isTimeManager(profile.role)) redirect('/dashboard')
  const admin = createAdminClient()
  const entry = await companyEntry(admin, profile.company_id, text(formData.get('id')))
  if (!entry) back(formData, { error: 'That time entry was not found.' })

  const note = text(formData.get('note'))
  if (!note) back(formData, { error: 'Say why the time was changed. The reason is kept with the entry.', edit: entry.id })
  const fix = buildFix({ day: text(formData.get('day')), in: text(formData.get('in')), out: text(formData.get('out')), breakMinutes: text(formData.get('break')) })
  if (!fix.ok) back(formData, { error: fix.error, edit: entry.id })

  const stamp = `${nyDay(new Date())} ${profile.full_name}: ${note}`
  await admin.from('time_clock_entries').update({
    clock_in: fix.clockIn,
    clock_out: fix.clockOut,
    break_minutes: fix.breakMinutes,
    total_minutes: fix.totalMinutes,
    manually_adjusted: true,
    adjusted_by: profile.id,
    adjustment_note: [entry.adjustment_note, stamp].filter(Boolean).join(' | ').slice(-900),
    // Keep what the entry said before the first fix.
    original_clock_in: entry.original_clock_in ?? entry.clock_in,
    original_clock_out: entry.original_clock_out ?? entry.clock_out,
    needs_review: false,
    review_reason: null,
    fix_requested_at: null, fix_requested_in: null, fix_requested_out: null, fix_requested_break: null, fix_request_note: null,
    // A changed entry has to be approved again.
    is_approved: false, approved_by: null, approved_at: null,
  }).eq('id', entry.id).eq('company_id', profile.company_id)

  await clockedOutIfNothingOpen(admin, entry.profile_id, profile.company_id)
  await admin.from('notifications').insert({
    company_id: profile.company_id, recipient_id: entry.profile_id, type: 'time_fixed', link: '/time',
    title: 'Your time was corrected',
    message: `${profile.full_name} set ${text(formData.get('day'))} to ${text(formData.get('in'))} - ${text(formData.get('out'))}${fix.breakMinutes ? `, ${fix.breakMinutes} min break` : ''}. Reason: ${note}`,
  })
  refresh()
  back(formData, { done: 'Time fixed.' })
}

/** If the fix closed the person's only open entry, show them as clocked out. */
async function clockedOutIfNothingOpen(admin: Admin, profileId: string, companyId: string) {
  const { data: open } = await admin.from('time_clock_entries').select('id').eq('profile_id', profileId).is('clock_out', null).limit(1)
  if (open?.length) return
  const { data: status } = await admin.from('employee_statuses').select('clock_status').eq('profile_id', profileId).maybeSingle()
  if (status?.clock_status !== 'clocked_in') return
  await admin.from('employee_statuses').upsert({
    profile_id: profileId, company_id: companyId, clock_status: 'clocked_out', current_status: 'clocked_out',
    current_ticket_id: null, current_asset_id: null, current_task_note: null, active_labor_entry_id: null, status_updated_at: new Date().toISOString(),
  }, { onConflict: 'profile_id' })
}

// ── Add a missed day (manager) ────────────────────────────────────────────────

export async function addTimeEntry(formData: FormData) {
  const profile = await getProfile()
  if (!profile || !isTimeManager(profile.role)) redirect('/dashboard')
  const admin = createAdminClient()

  const who = text(formData.get('profile_id'))
  const { data: person } = await admin.from('profiles').select('id, full_name').eq('id', who).eq('company_id', profile.company_id).maybeSingle()
  if (!person) back(formData, { error: 'Pick the employee.', add: '1' })
  const note = text(formData.get('note'))
  if (!note) back(formData, { error: 'Say why the time is being added by hand.', add: '1' })
  const day = text(formData.get('day'))
  const fix = buildFix({ day, in: text(formData.get('in')), out: text(formData.get('out')), breakMinutes: text(formData.get('break')) })
  if (!fix.ok) back(formData, { error: fix.error, add: '1' })

  // The same person cannot be on the clock twice at once.
  const { data: clash } = await admin.from('time_clock_entries').select('id')
    .eq('profile_id', person.id).lt('clock_in', fix.clockOut).gt('clock_out', fix.clockIn).gt('total_minutes', 0).limit(1)
  if (clash?.length) back(formData, { error: `${person.full_name} already has time on the clock that overlaps ${day}. Fix that entry instead.`, add: '1' })

  await admin.from('time_clock_entries').insert({
    company_id: profile.company_id, profile_id: person.id,
    clock_in: fix.clockIn, clock_out: fix.clockOut, break_minutes: fix.breakMinutes, total_minutes: fix.totalMinutes,
    source: 'manager', manually_adjusted: true, adjusted_by: profile.id,
    adjustment_note: `${nyDay(new Date())} ${profile.full_name} added by hand: ${note}`,
  })
  refresh()
  back(formData, { done: `Added ${(fix.totalMinutes / 60).toFixed(2)} hours for ${person.full_name}.` })
}

// ── Delete an entry (owner / manager only; for doubles and test punches) ──────

export async function deleteTimeEntry(formData: FormData) {
  const profile = await getProfile()
  if (!profile || !['owner', 'manager'].includes(profile.role)) redirect('/dashboard')
  const admin = createAdminClient()
  const entry = await companyEntry(admin, profile.company_id, text(formData.get('id')))
  if (!entry) back(formData, { error: 'That time entry was not found.' })
  if (entry.is_approved) back(formData, { error: 'Un-approve it first. An approved entry cannot be deleted.' })
  if (formData.get('sure') !== 'on') back(formData, { error: 'Tick the box to delete the entry.', edit: entry.id })

  await admin.from('activity_log').insert({
    company_id: profile.company_id, actor_id: profile.id, action: 'time_entry_deleted', entity_type: 'time_clock_entry', entity_id: entry.id,
    details: { for: entry.profile_id, clock_in: entry.clock_in, clock_out: entry.clock_out, total_minutes: entry.total_minutes },
  }).then(() => {}, () => {})
  await admin.from('labor_entries').update({ time_clock_entry_id: null }).eq('time_clock_entry_id', entry.id)
  await admin.from('time_clock_entries').delete().eq('id', entry.id).eq('company_id', profile.company_id)
  await clockedOutIfNothingOpen(admin, entry.profile_id, profile.company_id)
  refresh()
  back(formData, { done: 'Entry deleted.' })
}

// ── Use what the employee sent in / turn it down (manager) ────────────────────

export async function applyFixRequest(formData: FormData) {
  const profile = await getProfile()
  if (!profile || !isTimeManager(profile.role)) redirect('/dashboard')
  const admin = createAdminClient()
  const entry = await companyEntry(admin, profile.company_id, text(formData.get('id')))
  if (!entry?.fix_requested_at || !entry.fix_requested_in || !entry.fix_requested_out) back(formData, { error: 'There is no request on that entry any more.' })
  const i = nyParts(entry.fix_requested_in), o = nyParts(entry.fix_requested_out)
  const fd = new FormData()
  fd.set('id', entry.id); fd.set('day', i.day); fd.set('in', i.hhmm); fd.set('out', o.hhmm)
  fd.set('break', String(entry.fix_requested_break ?? 0))
  fd.set('note', `as sent in by the employee${entry.fix_request_note ? ` ("${entry.fix_request_note.slice(0, 120)}")` : ''}`)
  fd.set('back', text(formData.get('back')))
  await fixTimeEntry(fd)
}

export async function dismissFixRequest(formData: FormData) {
  const profile = await getProfile()
  if (!profile || !isTimeManager(profile.role)) redirect('/dashboard')
  const admin = createAdminClient()
  const entry = await companyEntry(admin, profile.company_id, text(formData.get('id')))
  if (!entry) back(formData, { error: 'That time entry was not found.' })
  await admin.from('time_clock_entries').update({
    fix_requested_at: null, fix_requested_in: null, fix_requested_out: null, fix_requested_break: null, fix_request_note: null,
  }).eq('id', entry.id).eq('company_id', profile.company_id)
  await admin.from('notifications').insert({
    company_id: profile.company_id, recipient_id: entry.profile_id, type: 'time_fixed', link: '/time',
    title: 'Your time correction was not used', message: `${profile.full_name} left the entry for ${nyDay(entry.clock_in)} as it was. Talk to them if it is still wrong.`,
  })
  refresh()
  back(formData, { done: 'Request cleared. The entry was left as it was.' })
}

// ── "My time is wrong" (the employee, own entries only) ───────────────────────

export async function requestTimeFix(formData: FormData) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  const admin = createAdminClient()
  const id = text(formData.get('id'))
  const { data: entry } = /^[0-9a-f-]{36}$/i.test(id)
    ? await admin.from('time_clock_entries').select('id, profile_id, is_approved, clock_out').eq('id', id).eq('profile_id', profile.id).maybeSingle()
    : { data: null }
  const to = (p: Record<string, string>): never => redirect(`/time?${new URLSearchParams(p).toString()}`)
  if (!entry) to({ error: 'That time entry was not found.' })
  if (entry!.is_approved) to({ error: 'That entry is already approved. Ask your manager to change it.' })
  if (!entry!.clock_out) to({ error: 'You are still clocked in on that entry. Clock out first.' })
  const note = text(formData.get('note'))
  if (!note) to({ error: 'Say what happened (for example: forgot to clock out, left at 5:15).', fix: id })
  const fix = buildFix({ day: text(formData.get('day')), in: text(formData.get('in')), out: text(formData.get('out')), breakMinutes: text(formData.get('break')) })
  if (!fix.ok) to({ error: fix.error, fix: id })
  if (!fix.ok) return

  await admin.from('time_clock_entries').update({
    fix_requested_at: new Date().toISOString(), fix_requested_in: fix.clockIn, fix_requested_out: fix.clockOut,
    fix_requested_break: fix.breakMinutes, fix_request_note: note,
  }).eq('id', id).eq('profile_id', profile.id)

  const { data: managers } = await admin.from('profiles').select('id, role').eq('company_id', profile.company_id).eq('is_active', true)
  const rows = (managers ?? []).filter(m => isTimeManager(m.role) && m.id !== profile.id).map(m => ({
    company_id: profile.company_id, recipient_id: m.id, type: 'time_needs_fixing', link: '/time/approvals',
    title: `${profile.full_name} sent in a time correction`,
    message: `${text(formData.get('day'))}: ${text(formData.get('in'))} - ${text(formData.get('out'))}. "${note.slice(0, 140)}"`,
  }))
  if (rows.length) await admin.from('notifications').insert(rows)
  refresh()
  to({ done: 'Sent to your manager. Your hours change once they approve it.' })
}

// ── My own clock-out reminder ─────────────────────────────────────────────────

export async function saveClockReminder(formData: FormData) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  const admin = createAdminClient()
  const prefs = { ...((profile.ui_prefs as Record<string, unknown> | null) ?? {}) }
  const on = formData.get('on') === 'on'
  const next = on ? parseClockReminder({ time: text(formData.get('time')), days: formData.getAll('days').map(d => Number(d)) }) : null
  if (next) prefs.clock_reminder = next
  else delete prefs.clock_reminder
  await admin.from('profiles').update({ ui_prefs: prefs }).eq('id', profile.id)
  revalidatePath('/shop/clock')
  redirect(`/shop/clock?reminder=${next ? 'saved' : on ? 'bad' : 'off'}`)
}
