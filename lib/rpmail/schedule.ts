import { createAdminClient } from '@/lib/supabase/admin'
import { sendAlertEmail } from '@/lib/email'
import { sendPushNotification } from '@/lib/push'
import { Busy, NotConnected, Unconfirmed, UserError } from './gmail'
import { mailboxFor, meById, Forbidden, type Me } from './access'
import { logActivity } from './activity'
import { sendMail, sendScheduled } from './mail-ops'

// RPMail: schedule send (Trae, 2026-11-24). A person writes a message, presses Schedule, picks a time and confirms.
// Every check a send gets runs right then; the message is put in Drafts in that mailbox to wait, and a row here says
// which draft goes out when. A pg_cron job looks every minute (/api/rpmail/cron?part=scheduled) and sends what is due,
// after checking everything again as if the person pressed Send at that moment.
// Rules: only the person who scheduled a message can see, send early or cancel it. A send is never repeated by itself:
// a row that started sending and was not heard from again is marked failed with "look in Sent", never sent again.
// If something stops it (the Mac Studio is off for a Proton mailbox, Gmail is busy) it is tried again each minute for
// two hours; anything else, or after two hours, it is marked not sent, the draft stays in Drafts, and the person is told.

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR
const SOONEST = MIN, LATEST = 180 * DAY, MAX_WAITING = 50, RETRY_FOR = 2 * HOUR, STUCK = 10 * MIN
const COLS = 'id, company_id, profile_id, mailbox_id, draft_id, thread_id, to_addrs, subject, send_at, status, tries, claimed_at, sent_at, error, created_at'

type Row = { id: number; company_id: string; profile_id: string; mailbox_id: string; draft_id: string; thread_id: string | null; to_addrs: string; subject: string
  send_at: string; status: 'waiting' | 'sending' | 'sent' | 'failed' | 'cancelled'; tries: number; claimed_at: string | null; sent_at: string | null; error: string | null; created_at: string }

/** The time the person picked, checked: at least a minute away and no more than about six months. */
export function whenOf(v: unknown, now = Date.now()): number {
  const t = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN
  if (!Number.isFinite(t)) throw new UserError('Pick a day and time to send it.')
  if (t < now + SOONEST - 5_000) throw new UserError('Pick a time at least a minute from now. To send it now, press Send.')
  if (t > now + LATEST) throw new UserError('Pick a time within the next six months.')
  return t
}

/** Schedule a message. Called only from the person's own Schedule click, after they confirmed the time. */
export async function scheduleMail(who: Me, p: Record<string, unknown>) {
  const at = whenOf(p.send_at)
  const admin = createAdminClient()
  const { data: waiting } = await admin.from('rpmail_scheduled').select('id').eq('profile_id', who.id).in('status', ['waiting', 'sending']).limit(MAX_WAITING + 1)
  if ((waiting ?? []).length >= MAX_WAITING) throw new UserError(`You already have ${MAX_WAITING} messages waiting to go out. Send or cancel some first.`)
  const r = await sendMail(who, { ...p, schedule: true, draft: false }) as { draft_id: string; thread_id: string | null; mailbox_id: string; from: string; to: string; subject: string }
  const box = await mailboxFor(who, r.mailbox_id)
  const { data: row, error } = await admin.from('rpmail_scheduled').insert({ company_id: box.company_id, profile_id: who.id, mailbox_id: box.id, draft_id: r.draft_id,
    thread_id: r.thread_id, to_addrs: r.to.slice(0, 1000), subject: (r.subject ?? '').slice(0, 300), send_at: new Date(at).toISOString() }).select('id').single()
  if (error || !row) throw new UserError('It is saved in Drafts, but the time could not be set. Open it from Drafts and schedule it again.')
  await logActivity(who, 'schedule', { box, detail: `For ${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC. To ${r.to.slice(0, 100)}: ${(r.subject ?? '').slice(0, 100)}` })
  return { ok: true, scheduled: true, id: row.id as number, send_at: at, from: r.from, to: r.to }
}

/** This person's own scheduled messages: waiting, and the ones that went out, failed or were cancelled in the last 3 days. */
export async function scheduledList(who: Me, q: Record<string, string> = {}) {
  const admin = createAdminClient()
  let query = admin.from('rpmail_scheduled').select(COLS).eq('profile_id', who.id).order('send_at', { ascending: true }).limit(200)
  if (q.mailbox) query = query.eq('mailbox_id', (await mailboxFor(who, q.mailbox)).id)
  const { data } = await query
  const since = Date.now() - 3 * DAY
  const rows = ((data ?? []) as Row[]).filter(r => r.status === 'waiting' || r.status === 'sending' || Date.parse(r.sent_at ?? r.claimed_at ?? r.send_at) > since)
  return { scheduled: rows.map(r => ({ id: r.id, mailbox_id: r.mailbox_id, draft_id: r.draft_id, to: r.to_addrs, subject: r.subject, send_at: Date.parse(r.send_at),
    status: r.status, sent_at: r.sent_at ? Date.parse(r.sent_at) : null, error: r.error })) }
}

async function ownRow(who: Me, id: unknown): Promise<Row> {
  const n = Number(id)
  if (!Number.isInteger(n) || n <= 0) throw new UserError('No such scheduled message.')
  const { data } = await createAdminClient().from('rpmail_scheduled').select(COLS).eq('id', n).eq('profile_id', who.id).maybeSingle()
  if (!data) throw new UserError('That scheduled message is not on your list.')
  await mailboxFor(who, (data as Row).mailbox_id)          // and they still have the mailbox
  return data as Row
}

/** Stop a scheduled message from going out. It stays in Drafts, to finish or delete there. */
export async function scheduleCancel(who: Me, p: { id?: unknown }) {
  const s = await ownRow(who, p.id)
  if (s.status !== 'waiting' && s.status !== 'failed') throw new UserError(s.status === 'sent' ? 'That one has already gone out.' : s.status === 'sending' ? 'That one is being sent right now.' : 'That one was already cancelled.')
  const { data } = await createAdminClient().from('rpmail_scheduled').update({ status: 'cancelled', error: null }).eq('id', s.id).in('status', ['waiting', 'failed']).select('id')
  if (!data?.length) throw new UserError('That one is being sent right now.')
  const box = await mailboxFor(who, s.mailbox_id)
  await logActivity(who, 'schedule_cancel', { box, detail: `To ${s.to_addrs.slice(0, 100)}: ${s.subject.slice(0, 100)}` })
  return { ok: true, cancelled: true }
}

/** Send a scheduled message now instead of waiting. Called only from the person's own Send now click, after they confirmed. */
export async function scheduleNow(who: Me, p: { id?: unknown; confirmed?: unknown }) {
  if (p.confirmed !== true) throw new UserError('Press Send now, then confirm.')
  const s = await ownRow(who, p.id)
  if (s.status !== 'waiting' && s.status !== 'failed') throw new UserError(s.status === 'sent' ? 'That one has already gone out.' : s.status === 'sending' ? 'That one is being sent right now.' : 'That one was cancelled. Open it from Drafts to send it.')
  if (!await claim(s, ['waiting', 'failed'])) throw new UserError('That one is being sent right now.')
  try {
    const r = await sendScheduled(who, s)
    await markSent(s, r.id)
    return { ok: true, sent: true, to: r.to, from: r.box.address }
  } catch (e) {
    // The person is here and sees what went wrong. It goes back to how it was, unless it may have gone out: then it is
    // marked not sent, so it can never go out a second time at its scheduled time.
    const admin = createAdminClient()
    const maybeSent = e instanceof Unconfirmed || !(e instanceof UserError || e instanceof Forbidden || e instanceof NotConnected || e instanceof Busy)
    if (maybeSent) {
      const why = e instanceof Unconfirmed ? e.message : 'Gmail did not confirm the send. Look in Sent before sending it again.'
      await admin.from('rpmail_scheduled').update({ status: 'failed', error: why }).eq('id', s.id)
      throw new UserError(why)
    }
    await admin.from('rpmail_scheduled').update({ status: s.status, error: e instanceof Error ? e.message.slice(0, 300) : 'It did not go out.', claimed_at: null }).eq('id', s.id)
    throw e
  }
}

/** Take a row for sending, in one step, so two runs (or a run and a Send now) never both send it. */
async function claim(s: Row, from: Row['status'][]): Promise<boolean> {
  const { data } = await createAdminClient().from('rpmail_scheduled').update({ status: 'sending', claimed_at: new Date().toISOString(), tries: (s.tries ?? 0) + 1 })
    .eq('id', s.id).in('status', from).select('id')
  return !!data?.length
}

async function markSent(s: Row, gmailId: string | null) {
  await createAdminClient().from('rpmail_scheduled').update({ status: 'sent', sent_at: new Date().toISOString(), gmail_id: gmailId, error: null }).eq('id', s.id)
}

/** Not sent: written down, and the person told (bell, phone, and an email to their own login address). */
async function markFailed(s: Row, why: string) {
  const admin = createAdminClient()
  await admin.from('rpmail_scheduled').update({ status: 'failed', error: why.slice(0, 300) }).eq('id', s.id)
  const { data: box } = await admin.from('rpmail_mailboxes').select('id, name, address').eq('id', s.mailbox_id).maybeSingle()
  const { data: p } = await admin.from('profiles').select('id, email, is_active').eq('id', s.profile_id).maybeSingle()
  const title = 'A scheduled message was not sent'
  const message = `To ${s.to_addrs.slice(0, 120) || '(nobody)'}: ${s.subject.slice(0, 120) || '(no subject)'}. ${why} It is still in Drafts${box ? ' in ' + box.name : ''}.`
  await logActivity({ id: s.profile_id, company_id: s.company_id }, 'schedule_failed', { box: box ? { id: box.id as string, address: box.address as string } : null, detail: why.slice(0, 200) })
  if (!p || p.is_active === false) return
  await admin.from('notifications').insert({ company_id: s.company_id, recipient_id: s.profile_id, type: 'rpmail_schedule_failed', title, message, link: '/rpmail' }).then(() => null, () => null)
  const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth_key').eq('profile_id', s.profile_id)
  for (const x of subs ?? []) await sendPushNotification(x as { endpoint: string; p256dh: string; auth_key: string }, { title, message, link: '/rpmail' }).catch(() => null)
  if (p.email) await sendAlertEmail({ to: p.email as string, subject: title, title, message, link: '/rpmail' }).catch(() => null)
}

/**
 * Send what is due. Run every minute by the scheduler, and at the start of the 5-minute background round.
 * Returns how many went out.
 */
export async function sendDue(budgetMs = 40_000): Promise<{ sent: number; failed: number; later: number }> {
  const admin = createAdminClient()
  const started = Date.now()
  const out = { sent: 0, failed: 0, later: 0 }
  // Started and never finished (the run was cut off): it may have gone out, so it is never sent again by itself.
  const { data: stuck } = await admin.from('rpmail_scheduled').select(COLS).eq('status', 'sending').lt('claimed_at', new Date(Date.now() - STUCK).toISOString()).limit(20)
  for (const s of (stuck ?? []) as Row[]) { await markFailed(s, 'RPMail started sending it but did not hear back, so it may or may not have gone out. Look in Sent before sending it again.'); out.failed++ }

  const { data: due } = await admin.from('rpmail_scheduled').select(COLS).eq('status', 'waiting').lte('send_at', new Date().toISOString()).order('send_at', { ascending: true }).limit(25)
  for (const s of (due ?? []) as Row[]) {
    if (Date.now() - started > budgetMs) break
    if (!await claim(s, ['waiting'])) continue
    const who = await meById(s.profile_id)
    if (!who) { await markFailed(s, 'RPMail is no longer turned on for your login.'); out.failed++; continue }
    try {
      const r = await sendScheduled(who, s)
      await markSent(s, r.id)
      out.sent++
    } catch (e) {
      const why = e instanceof Error ? e.message : 'It did not go out.'
      const late = Date.now() - Date.parse(s.send_at)
      // Something in the way that clears up by itself: try again next minute, for up to two hours.
      if ((e instanceof NotConnected || e instanceof Busy) && !(e instanceof Unconfirmed) && late < RETRY_FOR) {
        await admin.from('rpmail_scheduled').update({ status: 'waiting', claimed_at: null, error: why.slice(0, 300) }).eq('id', s.id)
        out.later++
        continue
      }
      await markFailed(s, e instanceof UserError || e instanceof Forbidden || e instanceof NotConnected || e instanceof Busy ? why
        : 'Gmail did not confirm it. Look in Sent before sending it again.')
      out.failed++
    }
  }
  return out
}
