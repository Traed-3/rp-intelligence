import { createAdminClient } from '@/lib/supabase/admin'
import { gmail, UserError } from './gmail'
import { mailboxFor, myMailboxes, type Me } from './access'
import { LIST_COLS, toItem, fileMessage, markRead, markDone, type Item } from './mail-ops'
import { getPrefs, setPrefs, inQuietHours, type Prefs, type NotifyPrefs } from './prefs'
import { labelApply, labelId } from './organize'

// RPMail: the person's own screen choices (which dashboard boxes are closed, and their order), the list of things
// they ticked Done, the star, and "do this to all the ones I selected". Like everything else in RPMail, each function
// starts from the signed-in person and only touches mailboxes that are on their own login.

const GID = /^[0-9a-f]{6,32}$/i

// The person's own settings live in ./prefs (kept apart so the mail code can read them too); they are handed on from here.
export { getPrefs, setPrefs, inQuietHours }
export type { Prefs, NotifyPrefs }

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

const BULK = ['Archive', 'Trash', 'read', 'unread', 'done', 'label'] as const
type BulkAction = typeof BULK[number]

/** One action on every selected conversation. Each one goes through the same checks as doing it by hand. */
export async function bulk(who: Me, p: { mailbox?: unknown; ids?: unknown; action?: unknown; label?: unknown; move?: unknown }) {
  const box = await mailboxFor(who, p.mailbox)
  const action = p.action as BulkAction
  if (!BULK.includes(action)) throw new UserError('That is not something RPMail can do to a selection.')
  const list = Array.isArray(p.ids) ? [...new Set(p.ids.filter((x): x is string => typeof x === 'string' && GID.test(x)))] : []
  if (!list.length) throw new UserError('Nothing is selected.')
  if (list.length > 40) throw new UserError('Select 40 or fewer at a time.')
  const label = action === 'label' ? labelId(p.label) : ''
  const moves: number[] = []
  let ok = 0, failed = 0
  for (const id of list) {
    try {
      if (action === 'Archive' || action === 'Trash') { const r = await fileMessage(who, { mailbox: box.id, id, dest: action }); if (r.move_id) moves.push(r.move_id as number) }
      else if (action === 'label') { const r = await labelApply(who, { mailbox: box.id, id, label, on: true, move: p.move === true }); if (r.move_id) moves.push(r.move_id) }
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
