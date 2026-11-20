import { createAdminClient } from '@/lib/supabase/admin'
import { gmail, UserError } from './gmail'
import { mailboxFor, myMailboxes, type Me } from './access'
import { LIST_COLS, toItem, fileMessage, markRead, markDone, type Item } from './mail-ops'

// RPMail: the person's own screen choices (which dashboard boxes are closed, and their order), the list of things
// they ticked Done, the star, and "do this to all the ones I selected". Like everything else in RPMail, each function
// starts from the signed-in person and only touches mailboxes that are on their own login.

const UUID = /^[0-9a-f-]{36}$/
const GID = /^[0-9a-f]{6,32}$/i

/** New-mail notifications. `what`: 'needs' = mail from a person that asks for something, 'people' = any mail from a person, 'all' = everything. */
export type NotifyPrefs = { on: boolean; what: 'needs' | 'people' | 'all'; quiet_from: string; quiet_to: string; off: string[] }
export type Prefs = { hidden: string[]; order: string[]; undo_secs: number; notify: NotifyPrefs }
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const notifyPrefs = (v: unknown): NotifyPrefs => {
  const d = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return { on: d.on === true, what: d.what === 'needs' || d.what === 'all' ? d.what : 'people',
    quiet_from: typeof d.quiet_from === 'string' && HHMM.test(d.quiet_from) ? d.quiet_from : '', quiet_to: typeof d.quiet_to === 'string' && HHMM.test(d.quiet_to) ? d.quiet_to : '', off: ids(d.off) }
}
/** Is `at` inside the person's quiet hours? Times are Eastern for now. A range may run past midnight (21:00 to 06:00). */
export function inQuietHours(n: Pick<NotifyPrefs, 'quiet_from' | 'quiet_to'>, at: Date): boolean {
  if (!n.quiet_from || !n.quiet_to || n.quiet_from === n.quiet_to) return false
  const now = at.toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false })
  return n.quiet_from < n.quiet_to ? now >= n.quiet_from && now < n.quiet_to : now >= n.quiet_from || now < n.quiet_to
}
const UNDO = [0, 5, 10, 20, 30]
const undoSecs = (v: unknown) => UNDO.includes(Number(v)) && v !== null && v !== undefined && v !== '' ? Number(v) : 10
const ids = (v: unknown): string[] => Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && UUID.test(x)))].slice(0, 60) : []

export async function getPrefs(who: Pick<Me, 'id'>): Promise<Prefs> {
  const { data } = await createAdminClient().from('rpmail_prefs').select('data').eq('profile_id', who.id).maybeSingle()
  const d = (data?.data ?? {}) as Partial<Prefs>
  return { hidden: ids(d.hidden), order: ids(d.order), undo_secs: undoSecs(d.undo_secs), notify: notifyPrefs(d.notify) }
}

/** Save which dashboard boxes are closed and the order they show in. Only this person's own screen changes. */
export async function setPrefs(who: Me, p: { hidden?: unknown; order?: unknown; undo_secs?: unknown; notify?: unknown }) {
  const cur = await getPrefs(who)
  const next: Prefs = { hidden: p.hidden === undefined ? cur.hidden : ids(p.hidden), order: p.order === undefined ? cur.order : ids(p.order),
    undo_secs: p.undo_secs === undefined ? cur.undo_secs : undoSecs(p.undo_secs),
    notify: p.notify === undefined ? cur.notify : notifyPrefs(p.notify) }
  const { error } = await createAdminClient().from('rpmail_prefs').upsert({ profile_id: who.id, data: next, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' })
  if (error) throw new Error('Could not save that.')
  return { ok: true, prefs: next }
}

/** What this person ticked Done lately, newest first, so a tick made by mistake can be put back. */
export async function doneList(who: Me) {
  const admin = createAdminClient()
  const boxes = await myMailboxes(who)
  const allowed = boxes.map(b => b.id)
  if (!allowed.length) return { items: [] }
  const { data: done } = await admin.from('rpmail_done').select('mailbox_id, gmail_id, created_at').eq('profile_id', who.id).in('mailbox_id', allowed)
    .order('created_at', { ascending: false }).limit(120)
  const rows = done ?? []
  const found = new Map<string, Item>()
  for (const box of allowed) {
    const gids = rows.filter(r => r.mailbox_id === box).map(r => r.gmail_id as string)
    if (!gids.length) continue
    const { data } = await admin.from('rpmail_messages').select(LIST_COLS).eq('mailbox_id', box).in('gmail_id', gids)
    for (const m of data ?? []) found.set(box + ':' + m.gmail_id, toItem(m as Parameters<typeof toItem>[0]))
  }
  const items = rows.flatMap(r => {
    const it = found.get(r.mailbox_id + ':' + r.gmail_id)
    return it ? [{ ...it, done_at: Date.parse(r.created_at as string) }] : []
  })
  return { items }
}

/** Star or unstar one message. The star is Gmail's own, so it shows in Gmail too. */
export async function setStar(who: Me, p: { mailbox?: unknown; id?: unknown; on?: unknown }) {
  const box = await mailboxFor(who, p.mailbox)
  if (typeof p.id !== 'string' || !GID.test(p.id)) throw new UserError('No such message.')
  const on = p.on !== false
  const r = await gmail(box.id, `messages/${p.id}/modify`, { method: 'POST', body: on ? { addLabelIds: ['STARRED'] } : { removeLabelIds: ['STARRED'] } })
  if (!r) throw new UserError('That message is no longer in Gmail.')
  await createAdminClient().from('rpmail_messages').update({ starred: on }).eq('mailbox_id', box.id).eq('gmail_id', p.id)
  return { ok: true, starred: on }
}

const BULK = ['Archive', 'Trash', 'read', 'unread', 'done'] as const
type BulkAction = typeof BULK[number]

/** One action on every selected conversation. Each one goes through the same checks as doing it by hand. */
export async function bulk(who: Me, p: { mailbox?: unknown; ids?: unknown; action?: unknown }) {
  const box = await mailboxFor(who, p.mailbox)
  const action = p.action as BulkAction
  if (!BULK.includes(action)) throw new UserError('That is not something RPMail can do to a selection.')
  const list = Array.isArray(p.ids) ? [...new Set(p.ids.filter((x): x is string => typeof x === 'string' && GID.test(x)))] : []
  if (!list.length) throw new UserError('Nothing is selected.')
  if (list.length > 40) throw new UserError('Select 40 or fewer at a time.')
  const moves: number[] = []
  let ok = 0, failed = 0
  for (const id of list) {
    try {
      if (action === 'Archive' || action === 'Trash') { const r = await fileMessage(who, { mailbox: box.id, id, dest: action }); if (r.move_id) moves.push(r.move_id as number) }
      else if (action === 'done') await markDone(who, { mailbox: box.id, id, on: true })
      else await markRead(who, { mailbox: box.id, id, unread: action === 'unread' })
      ok++
    } catch (e) {
      if (!(e instanceof UserError) && !(e instanceof Error)) throw e
      failed++
    }
  }
  return { ok: true, n: ok, failed, moves }
}
