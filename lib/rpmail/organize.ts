import { createAdminClient } from '@/lib/supabase/admin'
import { gmail, UserError } from './gmail'
import { mailboxFor, isMailAdmin, Forbidden, type Me, type Mailbox } from './access'
import { fileMessage, indexRow, gid } from './mail-ops'

// RPMail: keeping a mailbox tidy. Labels (Gmail's own, so they show in Gmail too) and blocked senders.
// Like everything else in RPMail, each function starts from `mailboxFor(me, …)`.

const LABEL = /^Label_[A-Za-z0-9_-]{1,40}$/
export const labelId = (v: unknown): string => { if (typeof v !== 'string' || !LABEL.test(v)) throw new UserError('No such label.'); return v }
export type Label = { id: string; name: string }
type GLabel = { id: string; name: string; type?: string }

/**
 * Reshaping a mailbox for everyone who uses it (renaming or deleting a label, blocking a sender): a person on their
 * own mailbox, and only an owner on a shared one.
 */
export const mayReshape = (who: Pick<Me, 'id' | 'role'>, box: Pick<Mailbox, 'kind' | 'owner_id'>) =>
  box.kind === 'personal' ? box.owner_id === who.id : isMailAdmin(who.role)

async function userLabels(box: Mailbox): Promise<Label[]> {
  const d = await gmail<{ labels?: GLabel[] }>(box.id, 'labels')
  return (d?.labels ?? []).filter(l => l.type === 'user' && LABEL.test(l.id)).map(l => ({ id: l.id, name: l.name })).sort((a, b) => a.name.localeCompare(b.name))
}

function labelName(v: unknown): string {
  const name = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!name) throw new UserError('Give the label a name.')
  if (name.length > 60) throw new UserError('Keep the label name to 60 characters or fewer.')
  if (/^(inbox|sent|drafts?|spam|trash|starred|important|unread|chats?|all mail)$/i.test(name)) throw new UserError('Gmail keeps that name for itself. Pick another.')
  return name
}

export async function labelList(who: Me, p: Record<string, string>) {
  const box = await mailboxFor(who, p.mailbox)
  return { labels: await userLabels(box), can_edit: mayReshape(who, box) }
}

/** Make a label, or rename one (with `id`). Making one that already exists just hands it back. */
export async function labelSave(who: Me, p: { mailbox?: unknown; id?: unknown; name?: unknown }) {
  const box = await mailboxFor(who, p.mailbox)
  const name = labelName(p.name)
  const all = await userLabels(box)
  const same = (l: Label) => l.name.toLowerCase() === name.toLowerCase()
  if (p.id !== undefined && p.id !== null && p.id !== '') {
    if (!mayReshape(who, box)) throw new Forbidden('On a shared mailbox only an owner can rename a label.')
    const id = labelId(p.id)
    if (!all.some(l => l.id === id)) throw new UserError('That label is no longer in Gmail.')
    if (all.some(l => l.id !== id && same(l))) throw new UserError('There is already a label with that name.')
    await gmail(box.id, 'labels/' + id, { method: 'PATCH', body: { name } })
    return { ok: true, label: { id, name } }
  }
  const have = all.find(same)
  if (have) return { ok: true, label: have, existed: true }
  if (all.length >= 300) throw new UserError('This mailbox already has 300 labels. Delete one you no longer use first.')
  const made = await gmail<GLabel>(box.id, 'labels', { method: 'POST', body: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' } })
  if (!made?.id) throw new Error('Gmail did not make the label.')
  return { ok: true, label: { id: made.id, name: made.name ?? name } }
}

/** Delete a label. The mail that carried it stays where it is; only the label goes. */
export async function labelDelete(who: Me, p: { mailbox?: unknown; label?: unknown }) {
  const box = await mailboxFor(who, p.mailbox)
  if (!mayReshape(who, box)) throw new Forbidden('On a shared mailbox only an owner can delete a label.')
  const id = labelId(p.label)
  await gmail(box.id, 'labels/' + id, { method: 'DELETE' })   // "not found" means it was already gone
  await createAdminClient().rpc('rpmail_label_drop', { p_mailbox: box.id, p_label: id })
  return { ok: true }
}

/**
 * Put a label on a conversation, or take it off. With `move` the conversation also leaves the inbox ("move to"),
 * and that can be undone like any other move.
 */
export async function labelApply(who: Me, p: { mailbox?: unknown; id?: unknown; label?: unknown; on?: unknown; move?: unknown }) {
  const box = await mailboxFor(who, p.mailbox)
  const id = gid(p.id)
  const label = labelId(p.label)
  const on = p.on !== false, move = on && p.move === true
  const row = await indexRow(box, id)
  const all = await userLabels(box)
  const found = all.find(l => l.id === label)
  if (on && !found) throw new UserError('That label is no longer in Gmail.')
  const r = await gmail(box.id, `threads/${row.thread_id}/modify`, { method: 'POST',
    body: on ? { addLabelIds: [label], ...(move ? { removeLabelIds: ['INBOX'] } : {}) } : { removeLabelIds: [label] } })
  if (r === null) throw new UserError('That conversation is no longer in Gmail.')
  const admin = createAdminClient()
  await admin.rpc('rpmail_label_set', { p_mailbox: box.id, p_thread: row.thread_id, p_label: label, p_on: on })
  let move_id: number | null = null
  if (move) {
    await admin.from('rpmail_messages').update({ in_inbox: false }).eq('mailbox_id', box.id).eq('thread_id', row.thread_id)
    const { data: mv } = await admin.from('rpmail_moves').insert({ profile_id: who.id, mailbox_id: box.id, gmail_id: id, thread_id: row.thread_id,
      subject: (row.subject ?? '').slice(0, 300), from_place: row.in_inbox ? 'Inbox' : 'All Mail', to_place: ('Label: ' + (found?.name ?? '')).slice(0, 80), label_id: label }).select('id').single()
    move_id = (mv?.id as number | undefined) ?? null
  }
  return { ok: true, on, moved: move, move_id, name: found?.name ?? '' }
}

// ── Blocked senders ───────────────────────────────────────────────────────────────────────────────────────────
const ADDR = /^[^@\s<>"',;:()]+@[^@\s<>"',;:()]+\.[a-z]{2,}$/i
function cleanAddr(v: unknown): string {
  const a = String(v ?? '').trim().toLowerCase()
  if (a.length > 320 || !ADDR.test(a)) throw new UserError('That does not look like an email address.')
  return a
}

export async function blockList(who: Me, p: Record<string, string>) {
  const box = await mailboxFor(who, p.mailbox)
  const { data } = await createAdminClient().from('rpmail_blocks').select('addr, created_at').eq('mailbox_id', box.id).order('addr', { ascending: true })
  return { blocked: (data ?? []).map(b => ({ addr: b.addr as string, since: Date.parse(b.created_at as string) })), can_edit: mayReshape(who, box) }
}

/**
 * Block a sender for this mailbox (by address, or the sender of message `id`), or unblock with `on: false`.
 * New mail from a blocked sender goes straight to Gmail's Trash, where Gmail keeps it 30 days. Blocking from a
 * message also moves that conversation to Trash, which can be undone.
 */
export async function blockSender(who: Me, p: { mailbox?: unknown; addr?: unknown; id?: unknown; on?: unknown }) {
  const box = await mailboxFor(who, p.mailbox)
  if (!mayReshape(who, box)) throw new Forbidden('On a shared mailbox only an owner can block or unblock a sender.')
  const admin = createAdminClient()
  if (p.on === false) {
    const addr = cleanAddr(p.addr)
    await admin.from('rpmail_blocks').delete().eq('mailbox_id', box.id).eq('addr', addr)
    return { ok: true, blocked: false, addr, move_id: null }
  }
  let addr: string
  const fromMessage = p.id !== undefined && p.id !== null && p.id !== ''
  if (fromMessage) {
    const { data: m } = await admin.from('rpmail_messages').select('from_addr, sent').eq('mailbox_id', box.id).eq('gmail_id', gid(p.id)).maybeSingle()
    if (!m?.from_addr) throw new UserError('Open the message first, then block its sender.')
    if (m.sent) throw new UserError('That message was sent from this mailbox.')
    addr = cleanAddr(m.from_addr)
  } else addr = cleanAddr(p.addr)
  if (addr === box.address.toLowerCase()) throw new UserError('That is this mailbox\'s own address.')
  const { count } = await admin.from('rpmail_blocks').select('addr', { count: 'exact', head: true }).eq('mailbox_id', box.id)
  if ((count ?? 0) >= 500) throw new UserError('This mailbox already blocks 500 senders. Unblock one first.')
  const { error } = await admin.from('rpmail_blocks').upsert({ mailbox_id: box.id, addr, profile_id: who.id }, { onConflict: 'mailbox_id,addr', ignoreDuplicates: true })
  if (error) throw new Error('Could not save that.')
  let move_id: number | null = null
  if (fromMessage) move_id = ((await fileMessage(who, { mailbox: box.id, id: p.id, dest: 'Trash' })).move_id as number | null) ?? null
  return { ok: true, blocked: true, addr, move_id }
}
