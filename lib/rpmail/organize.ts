import { createAdminClient } from '@/lib/supabase/admin'
import { gmail, UserError } from './gmail'
import { mailboxFor, isMailAdmin, Forbidden, type Me, type Mailbox } from './access'
import { fileMessage, indexRow, gid } from './mail-ops'
import type { Rule, RuleAction, RuleMatch } from './arrival'
import { logActivity } from './activity'

// RPMail: keeping a mailbox tidy. Labels (Gmail's own, so they show in Gmail too) and blocked senders.
// Like everything else in RPMail, each function starts from `mailboxFor(me, …)`.

const LABEL = /^Label_[A-Za-z0-9_-]{1,40}$/
export const labelId = (v: unknown): string => { if (typeof v !== 'string' || !LABEL.test(v)) throw new UserError('No such label.'); return v }
/** A Gmail label (or a Proton folder or label). `total` / `unread`: how many of RPMail's loaded messages carry it. */
export type Label = { id: string; name: string; total?: number; unread?: number }
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
  const [labels, { data: counts }] = await Promise.all([userLabels(box), createAdminClient().rpc('rpmail_label_counts', { p_mailbox: box.id })])
  const by = new Map(((counts ?? []) as { label: string; total: number; unread: number }[]).map(c => [c.label, c]))
  return { labels: labels.map(l => ({ ...l, total: Number(by.get(l.id)?.total ?? 0), unread: Number(by.get(l.id)?.unread ?? 0) })), can_edit: mayReshape(who, box) }
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
  await logActivity(who, 'label_delete', { box })
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
    await logActivity(who, 'unblock', { box, detail: addr })
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
  await logActivity(who, 'block', { box, detail: addr })
  let move_id: number | null = null
  if (fromMessage) move_id = ((await fileMessage(who, { mailbox: box.id, id: p.id, dest: 'Trash' })).move_id as number | null) ?? null
  return { ok: true, blocked: true, addr, move_id }
}

// ── Rules ─────────────────────────────────────────────────────────────────────────────────────────────────────
// What to do with mail as it arrives (lib/rpmail/arrival.ts applies them). A rule belongs to the mailbox, so it
// changes things for everyone who uses that mailbox: the person on their own mailbox, an owner on a shared one.
const UUID = /^[0-9a-f-]{36}$/
const word = (v: unknown, max = 100) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

export async function ruleList(who: Me, p: Record<string, string>) {
  const box = await mailboxFor(who, p.mailbox)
  const { data } = await createAdminClient().from('rpmail_rules').select('id, name, position, enabled, match, action').eq('mailbox_id', box.id).order('position', { ascending: true })
  return { rules: (data ?? []) as Rule[], can_edit: mayReshape(who, box) }
}

/** Make a rule, or change one (with `id`). It acts on mail that arrives from now on, never on mail already here. */
export async function ruleSave(who: Me, p: { mailbox?: unknown; id?: unknown; name?: unknown; match?: unknown; action?: unknown; enabled?: unknown }) {
  const box = await mailboxFor(who, p.mailbox)
  if (!mayReshape(who, box)) throw new Forbidden('On a shared mailbox only an owner can change the rules.')
  const m = (p.match && typeof p.match === 'object' ? p.match : {}) as Record<string, unknown>
  const a = (p.action && typeof p.action === 'object' ? p.action : {}) as Record<string, unknown>
  const match: RuleMatch = {}
  for (const k of ['from', 'to', 'subject'] as const) { const v = word(m[k]); if (v) match[k] = v }
  if (!Object.keys(match).length) throw new UserError('Say what the mail has to match: who it is from, who it is to, or words in the subject.')
  if (Object.values(match).some(v => v.length < 2)) throw new UserError('Each thing to match needs at least two characters, or the rule would catch nearly everything.')
  let action: RuleAction = {}
  if (a.trash === true) action = { trash: true }   // Trash on its own: there is nothing left to label or star
  else {
    if (a.label) {
      const label = labelId(a.label)
      if (!(await userLabels(box)).some(l => l.id === label)) throw new UserError('That label is no longer in Gmail.')
      action.label = label
    }
    for (const k of ['archive', 'read', 'star', 'quiet'] as const) if (a[k] === true) action[k] = true
  }
  if (!Object.keys(action).length) throw new UserError('Say what should happen to the mail.')
  const name = word(p.name, 80) || [match.from && 'From ' + match.from, match.to && 'To ' + match.to, match.subject && 'Subject has ' + match.subject].filter(Boolean).join(', ').slice(0, 80)
  const admin = createAdminClient()
  const fields = { name, match, action, enabled: p.enabled !== false }
  if (p.id !== undefined && p.id !== null && p.id !== '') {
    if (typeof p.id !== 'string' || !UUID.test(p.id)) throw new UserError('No such rule.')
    const { data } = await admin.from('rpmail_rules').update(fields).eq('id', p.id).eq('mailbox_id', box.id).select('id')
    if (!data?.length) throw new UserError('That rule is no longer there.')
    await logActivity(who, 'rule_save', { box, detail: name + (fields.enabled ? '' : ' (switched off)') })
    return { ok: true, id: p.id }
  }
  const { count } = await admin.from('rpmail_rules').select('id', { count: 'exact', head: true }).eq('mailbox_id', box.id)
  if ((count ?? 0) >= 50) throw new UserError('This mailbox already has 50 rules. Delete one you no longer need first.')
  const { data: made, error } = await admin.from('rpmail_rules').insert({ mailbox_id: box.id, profile_id: who.id, position: count ?? 0, ...fields }).select('id').single()
  if (error) throw new Error('Could not save that rule.')
  await logActivity(who, 'rule_save', { box, detail: name })
  return { ok: true, id: made.id as string }
}

export async function ruleDelete(who: Me, p: { mailbox?: unknown; id?: unknown }) {
  const box = await mailboxFor(who, p.mailbox)
  if (!mayReshape(who, box)) throw new Forbidden('On a shared mailbox only an owner can change the rules.')
  if (typeof p.id !== 'string' || !UUID.test(p.id)) throw new UserError('No such rule.')
  await createAdminClient().from('rpmail_rules').delete().eq('id', p.id).eq('mailbox_id', box.id)
  await logActivity(who, 'rule_delete', { box })
  return { ok: true }
}
