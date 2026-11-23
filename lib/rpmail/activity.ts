import { createAdminClient } from '@/lib/supabase/admin'
import { isMailAdmin, Forbidden, type Me, type Mailbox } from './access'

// RPMail: the activity log an owner can read and export. One line per thing that matters to a company: a mailbox
// signed in or out, mail sent, mail deleted, a send that was blocked, and every change to who can do what.
// No message text is ever written here: only the subject line and the addresses it went to.

export const ACTIVITY: Record<string, string> = {
  sign_in: 'Signed a mailbox in with Google', sign_out: 'Signed a mailbox out',
  send: 'Sent a message', draft: 'Saved a draft to Gmail', trash: 'Moved mail to Trash', spam: 'Marked mail as spam',
  blocked_send: 'A send was blocked by a rule',
  block: 'Blocked a sender', unblock: 'Unblocked a sender', rule_save: 'Added or changed a mail rule', rule_delete: 'Deleted a mail rule', label_delete: 'Deleted a label',
  access: 'Changed what someone can do in a mailbox', rpmail_on: 'Turned RPMail on', rpmail_off: 'Turned RPMail off',
  mailbox_add: 'Added a shared mailbox', mailbox_remove: 'Removed a shared mailbox', content_rules: 'Changed the blocked-content rules',
}
const GROUPS: Record<string, string[]> = {
  mail: ['send', 'draft', 'trash', 'spam', 'blocked_send'],
  access: ['sign_in', 'sign_out', 'access', 'rpmail_on', 'rpmail_off', 'mailbox_add', 'mailbox_remove'],
  setup: ['block', 'unblock', 'rule_save', 'rule_delete', 'label_delete', 'content_rules'],
}
const UUID = /^[0-9a-f-]{36}$/
const KEEP_DAYS = 400

/** Write one line. It never fails the thing it is recording: a log that cannot be written must not stop the mail. */
export async function logActivity(who: Pick<Me, 'id' | 'company_id'>, kind: keyof typeof ACTIVITY, x: { box?: Pick<Mailbox, 'id' | 'address'> | null; detail?: string; target?: string } = {}): Promise<void> {
  try {
    await createAdminClient().from('rpmail_activity').insert({
      company_id: who.company_id, profile_id: who.id, kind, mailbox_id: x.box?.id ?? null, mailbox_address: x.box?.address ?? null,
      target_id: x.target ?? null, detail: (x.detail ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, 300) || null,
    })
  } catch { /* see above */ }
}

type Line = { id: number; at: number; kind: string; what: string; who: string; mailbox: string; about: string; detail: string }

async function lines(who: Me, q: Record<string, string>, max: number): Promise<Line[]> {
  if (!isMailAdmin(who.role)) throw new Forbidden('Only an owner can read the activity log.')
  const admin = createAdminClient()
  let query = admin.from('rpmail_activity').select('id, at, kind, profile_id, mailbox_address, target_id, detail').eq('company_id', who.company_id)
  if (GROUPS[q.kind]) query = query.in('kind', GROUPS[q.kind])
  if (UUID.test(q.person ?? '')) query = query.eq('profile_id', q.person)
  if (/^\d+$/.test(q.before ?? '')) query = query.lt('id', Number(q.before))
  const { data, error } = await query.order('id', { ascending: false }).limit(max)
  if (error) throw new Error('Could not read the activity log.')
  const rows = data ?? []
  const ids = [...new Set(rows.flatMap(r => [r.profile_id, r.target_id]).filter((x): x is string => typeof x === 'string'))]
  const { data: people } = ids.length ? await admin.from('profiles').select('id, full_name, email').in('id', ids) : { data: [] }
  const name = new Map((people ?? []).map(p => [p.id as string, (p.full_name as string) || (p.email as string) || 'Someone']))
  return rows.map(r => ({
    id: r.id as number, at: Date.parse(r.at as string), kind: r.kind as string, what: ACTIVITY[r.kind as string] ?? (r.kind as string),
    who: r.profile_id ? name.get(r.profile_id as string) ?? 'Someone who has left' : 'RPMail', mailbox: (r.mailbox_address as string) ?? '',
    about: r.target_id ? name.get(r.target_id as string) ?? 'Someone who has left' : '', detail: (r.detail as string) ?? '',
  }))
}

/** A page of the log, newest first. `before` is the id to continue from. */
export async function activityList(who: Me, q: Record<string, string>) {
  const rows = await lines(who, q, 101)
  return { rows: rows.slice(0, 100), more: rows.length > 100 }
}

// A cell that starts with = + - or @ would be run as a formula by a spreadsheet program: it gets a leading apostrophe.
const cell = (v: string) => { const s = /^[=+\-@\t\r]/.test(v) ? "'" + v : v; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }

/** The log as a spreadsheet file (CSV), newest first, up to 5,000 lines. */
export async function activityCsv(who: Me, q: Record<string, string>): Promise<Response> {
  const rows = await lines(who, q, 5000)
  const when = (ms: number) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  const out = [['When (Eastern)', 'Who', 'What', 'Mailbox', 'About', 'Detail'], ...rows.map(r => [when(r.at), r.who, r.what, r.mailbox, r.about, r.detail])]
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  return new Response('﻿' + out.map(l => l.map(cell).join(',')).join('\r\n') + '\r\n', { headers: {
    'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="rpmail-activity-${day}.csv"`, 'Cache-Control': 'private, no-store',
  } })
}

/** Lines older than about 13 months are dropped by the scheduled check. */
export async function cleanActivity(): Promise<void> {
  await createAdminClient().from('rpmail_activity').delete().lt('at', new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString())
}
