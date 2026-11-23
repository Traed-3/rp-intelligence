import { createAdminClient } from '@/lib/supabase/admin'
import { sendAlertEmail } from '@/lib/email'
import { sendPushNotification } from '@/lib/push'
import { isLockedRole } from '@/lib/role-access'
import { syncMailbox } from './sync'
import { BOX_COLS, myMailboxes, type Mailbox, type Me } from './access'
import { getPrefs, inQuietHours, type NotifyPrefs } from './extras'
import { ensureSummary } from './overview'
import { OUTBOX } from './compose-ops'

// RPMail: the work that happens with nobody looking at the page. Called every few minutes by the scheduler
// (/api/rpmail/cron). It checks every connected mailbox for new mail, tells the owners when one has been failing
// for over an hour, sends new-mail notifications to the people who asked for them, makes the morning summary, and
// clears out attachments that were uploaded for a message nobody sent.
// It never sends an email from anyone's mailbox.

const HOUR = 3_600_000

export type BackgroundResult = { checked: number; failed: number; alerts: number; notified: number; woken: number; summaries: number; cleaned: number; ms: number }

export async function runBackground(budgetMs = 45_000): Promise<BackgroundResult> {
  const admin = createAdminClient()
  const started = Date.now()
  const left = () => budgetMs - (Date.now() - started)
  const out: BackgroundResult = { checked: 0, failed: 0, alerts: 0, notified: 0, woken: 0, summaries: 0, cleaned: 0, ms: 0 }

  // The mailbox that has waited longest goes first, so one big or broken mailbox cannot starve the rest.
  const { data } = await admin.from('rpmail_mailboxes').select(BOX_COLS).order('last_sync_at', { ascending: true, nullsFirst: true }).limit(400)
  const boxes = ((data ?? []) as Mailbox[]).filter(b => b.token_secret_id)
  const unfinished: string[] = []
  for (const box of boxes) {
    if (left() < 6_000) break
    try {
      const r = await syncMailbox(box, Math.min(14_000, left() - 4_000))
      out.checked++
      if (r.done && !r.busy) out.notified += await notifyNewMail(box).catch(() => 0)
      else if (!r.busy) unfinished.push(box.id)
    } catch { out.failed++ }
  }
  // Time left over goes to mailboxes that are still doing their first load, a round each, until the time is used up.
  while (unfinished.length && left() > 12_000) {
    const id = unfinished.shift()!
    const { data: again } = await admin.from('rpmail_mailboxes').select(BOX_COLS).eq('id', id).maybeSingle()
    if (!again) continue
    try {
      const r = await syncMailbox(again as Mailbox, Math.min(14_000, left() - 6_000))
      if (!r.done && !r.busy) unfinished.push(id)
    } catch { /* counted on its first try; the next run starts with it */ }
  }

  out.alerts = await alertFailing().catch(() => 0)
  out.woken = await wakeSnoozes().catch(() => 0)
  if (left() > 8_000) out.summaries = await morningSummaries(left() - 4_000).catch(() => 0)
  if (left() > 3_000) out.cleaned = await cleanOutbox().catch(() => 0)
  out.ms = Date.now() - started
  return out
}

/** Tell the company's owners, once a day at most, about a mailbox whose checks have failed for over an hour. */
async function alertFailing(): Promise<number> {
  const admin = createAdminClient()
  const { data } = await admin.from('rpmail_mailboxes').select('id, company_id, name, address, last_error, failing_since, fail_alerted_at')
    .lt('failing_since', new Date(Date.now() - HOUR).toISOString()).limit(50)
  let sent = 0
  for (const b of data ?? []) {
    if (!b.failing_since) continue
    if (b.fail_alerted_at && Date.now() - Date.parse(b.fail_alerted_at as string) < 24 * HOUR) continue
    const { data: owners } = await admin.from('profiles').select('id, email').eq('company_id', b.company_id).eq('role', 'owner').eq('is_active', true)
    const hours = Math.max(1, Math.round((Date.now() - Date.parse(b.failing_since as string)) / HOUR))
    const title = `RPMail: ${b.name} has not been able to check for mail for ${hours} hour${hours === 1 ? '' : 's'}`
    const message = `${b.address}: ${String(b.last_error ?? 'the check keeps failing').slice(0, 200)} Open RPMail, right-click the mailbox and choose "Sign in again".`
    for (const o of owners ?? []) {
      await admin.from('notifications').insert({ company_id: b.company_id, recipient_id: o.id, type: 'rpmail_sync_failing', title, message, link: '/rpmail' })
      if (o.email) await sendAlertEmail({ to: o.email as string, subject: title, title, message, link: '/rpmail' }).catch(() => null)
      await push(o.id as string, { title, message, link: '/rpmail' })
    }
    await admin.from('rpmail_mailboxes').update({ fail_alerted_at: new Date().toISOString() }).eq('id', b.id)
    sent++
  }
  return sent
}

async function push(profileId: string, payload: { title: string; message: string; link?: string }): Promise<number> {
  const { data: subs } = await createAdminClient().from('push_subscriptions').select('endpoint, p256dh, auth_key').eq('profile_id', profileId)
  for (const s of subs ?? []) await sendPushNotification(s as { endpoint: string; p256dh: string; auth_key: string }, payload).catch(() => null)
  return (subs ?? []).length
}

/**
 * The person pressed "Send a test notification": one goes to each of their own devices, and we say plainly what
 * happened. `here` says whether the device they are holding (its address is sent along) is one of them.
 * The only delay allowed is 15 seconds.
 */
export async function notifyTest(who: Pick<Me, 'id'>, p: { endpoint?: unknown; delay?: unknown } = {}) {
  const admin = createAdminClient()
  // "Send one in 15 seconds": time to lock the phone first, which is how real mail notifications arrive.
  if (Number(p.delay) === 15) await new Promise(r => setTimeout(r, 15_000))
  const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth_key').eq('profile_id', who.id)
  const mine = typeof p.endpoint === 'string' && p.endpoint ? p.endpoint : null
  let sent = 0, failed = 0, here: boolean | null = mine ? false : null
  for (const s of (subs ?? []) as { endpoint: string; p256dh: string; auth_key: string }[]) {
    const r = await sendPushNotification(s, { title: 'RPMail test', message: 'Notifications are working on this device.', link: '/rpmail' }).catch(() => 'failed' as const)
    if (r === 'sent') { sent++; if (s.endpoint === mine) here = true }
    else {
      failed++
      // The push service says this device is no longer registered: forget it, so it is not counted as a device again.
      if (r === 'gone') await admin.from('push_subscriptions').delete().eq('profile_id', who.id).eq('endpoint', s.endpoint)
    }
  }
  return { ok: true, devices: (subs ?? []).length, sent, failed, here }
}

type NewRow = { gmail_id: string; date: string; from_name: string | null; from_addr: string | null; subject: string | null; bulk: boolean; asks: boolean }
const wants = (what: NotifyPrefs['what'], r: NewRow) => what === 'all' ? true : what === 'needs' ? !r.bulk && r.asks : !r.bulk

/**
 * New mail since the last look goes to each person who has this mailbox, asked for notifications, has not switched
 * this mailbox off, and is not in their quiet hours. One notification per person per check, never one per message.
 */
export async function notifyNewMail(box: Pick<Mailbox, 'id' | 'name' | 'kind' | 'crew_reads' | 'company_id'> & { notify_mark?: string | null }): Promise<number> {
  const admin = createAdminClient()
  const now = new Date().toISOString()
  if (!box.notify_mark) { await admin.from('rpmail_mailboxes').update({ notify_mark: now }).eq('id', box.id); return 0 }   // first look: nothing is "new" yet
  const { data } = await admin.from('rpmail_messages').select('gmail_id, date, from_name, from_addr, subject, bulk, asks')
    .eq('mailbox_id', box.id).eq('in_inbox', true).eq('sent', false).eq('unread', true).eq('quiet', false).gte('date', box.notify_mark).order('date', { ascending: false }).limit(40)
  const fresh = ((data ?? []) as NewRow[]).filter(r => Date.parse(r.date) > Date.parse(box.notify_mark as string))
  if (!fresh.length) return 0
  // Announced up to the newest message seen (not "up to now"), so mail that lands between the check and this line is not skipped.
  await admin.from('rpmail_mailboxes').update({ notify_mark: fresh[0].date }).eq('id', box.id)
  const { data: acc } = await admin.from('rpmail_access').select('profile_id').eq('mailbox_id', box.id)
  const ids = (acc ?? []).map(a => a.profile_id as string)
  if (!ids.length) return 0
  const [{ data: people }, { data: on }] = await Promise.all([
    admin.from('profiles').select('id, role, company_id, is_active').in('id', ids),
    admin.from('rpmail_users').select('profile_id, enabled').in('profile_id', ids),
  ])
  const enabled = new Set((on ?? []).filter(u => u.enabled).map(u => u.profile_id as string))
  let sent = 0
  for (const p of people ?? []) {
    // The same rule as reading the mailbox: right company, RPMail on, and no pricing mailbox for a tech or shop login.
    if (p.is_active === false || p.company_id !== box.company_id || !enabled.has(p.id as string)) continue
    if (box.kind === 'shared' && !box.crew_reads && isLockedRole(p.role as string)) continue
    const n = (await getPrefs({ id: p.id as string })).notify
    if (!n.on || n.off.includes(box.id) || inQuietHours(n, new Date())) continue
    const mine = fresh.filter(r => wants(n.what, r))
    if (!mine.length) continue
    const first = mine[0]
    const who = first.from_name || first.from_addr || 'Someone'
    const payload = mine.length === 1
      ? { title: `${who} (${box.name})`, message: first.subject || '(no subject)', link: '/rpmail' }
      : { title: `${mine.length} new in ${box.name}`, message: mine.slice(0, 3).map(r => `${r.from_name || r.from_addr}: ${r.subject || '(no subject)'}`).join(' · ').slice(0, 240), link: '/rpmail' }
    if (await push(p.id as string, payload)) sent++
  }
  return sent
}

/**
 * Snoozes and reminders whose time has come. A snoozed conversation is back on the person's lists from this moment;
 * a reminder is only given if nobody has written back since it was set. Each is the person's own, so it goes to
 * their devices whatever their new-mail setting is, but never inside their quiet hours (it is still marked, and
 * shows in RPMail).
 */
export async function wakeSnoozes(): Promise<number> {
  const admin = createAdminClient()
  const now = new Date()
  await admin.from('rpmail_snoozes').delete().lt('woke_at', new Date(now.getTime() - 3 * 86_400_000).toISOString())   // shown as "back" for three days, then forgotten
  const { data } = await admin.from('rpmail_snoozes').select('id, profile_id, mailbox_id, thread_id, subject, kind, created_at')
    .is('woke_at', null).lte('until', now.toISOString()).order('until', { ascending: true }).limit(100)
  let n = 0
  for (const z of data ?? []) {
    const gone = () => admin.from('rpmail_snoozes').delete().eq('id', z.id)
    const [{ data: p }, { data: box }, { data: acc }, { data: on }] = await Promise.all([
      admin.from('profiles').select('id, role, company_id, is_active').eq('id', z.profile_id).maybeSingle(),
      admin.from('rpmail_mailboxes').select('id, name, kind, crew_reads, company_id').eq('id', z.mailbox_id).maybeSingle(),
      admin.from('rpmail_access').select('mailbox_id').eq('profile_id', z.profile_id).eq('mailbox_id', z.mailbox_id).maybeSingle(),
      admin.from('rpmail_users').select('enabled').eq('profile_id', z.profile_id).maybeSingle(),
    ])
    // The same rule as reading the mailbox. Someone who no longer has it is told nothing about it.
    if (!p || !box || !acc || !on?.enabled || p.is_active === false || p.company_id !== box.company_id || (box.kind === 'shared' && !box.crew_reads && isLockedRole(p.role as string))) { await gone(); continue }
    const { data: thread } = await admin.from('rpmail_messages').select('date, sent').eq('mailbox_id', z.mailbox_id).eq('thread_id', z.thread_id).order('date', { ascending: false }).limit(30)
    if (!thread?.length) { await gone(); continue }                                                    // the conversation is no longer in the mailbox
    if (z.kind === 'remind' && thread.some(m => !m.sent && Date.parse(m.date as string) > Date.parse(z.created_at as string))) { await gone(); continue }   // they wrote back: nothing to remind about
    await admin.from('rpmail_snoozes').update({ woke_at: now.toISOString() }).eq('id', z.id)
    n++
    if (inQuietHours((await getPrefs({ id: z.profile_id as string })).notify, now)) continue
    await push(z.profile_id as string, { title: `${z.kind === 'remind' ? 'No reply yet' : 'Back in your inbox'} (${box.name})`, message: (z.subject as string) || '(no subject)', link: '/rpmail' })
  }
  return n
}

/** After 6 in the morning, make today's summary for everyone who has RPMail on and does not have it yet. */
async function morningSummaries(budgetMs: number): Promise<number> {
  const admin = createAdminClient()
  const started = Date.now()
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })) % 24
  if (hour < 6) return 0
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const { data: users } = await admin.from('rpmail_users').select('profile_id').eq('enabled', true).limit(500)
  const { data: have } = await admin.from('rpmail_summaries').select('profile_id').eq('day', today)
  const done = new Set((have ?? []).map(h => h.profile_id as string))
  let made = 0
  for (const u of users ?? []) {
    if (done.has(u.profile_id as string) || Date.now() - started > budgetMs) continue
    const { data: p } = await admin.from('profiles').select('id, company_id, role, full_name, email, is_active').eq('id', u.profile_id).maybeSingle()
    if (!p || p.is_active === false) continue
    const who: Me = { id: p.id, company_id: p.company_id, role: p.role ?? '', name: p.full_name ?? '', email: (p.email ?? '').toLowerCase(), enabled: true, mailAddress: null }
    if (await ensureSummary(who, await myMailboxes(who))) made++
  }
  return made
}

async function cleanOutbox(): Promise<number> {
  const admin = createAdminClient()
  const { data } = await admin.rpc('rpmail_outbox_stale', { p_hours: 48 })
  const names = ((data ?? []) as unknown[]).map(n => typeof n === 'string' ? n : String((n as { rpmail_outbox_stale?: string })?.rpmail_outbox_stale ?? '')).filter(Boolean)
  if (names.length) await admin.storage.from(OUTBOX).remove(names)
  return names.length
}
