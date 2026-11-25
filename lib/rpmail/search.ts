import { createAdminClient } from '@/lib/supabase/admin'
import { gmail, pooled, UserError } from './gmail'
import { myMailboxes, type Me, type Mailbox } from './access'
import { LIST_COLS, groupThreads, likeSafe, type Item, type Row } from './mail-ops'
import { userLabels } from './organize'
import { knownSites, loadMessages } from './sync'

// RPMail: one search over every mailbox a person has (Trae, 11/25/26: an Anthropic email sent to his personal Proton
// address was filed by Proton into RPS / Claude Anthropic, so it sat in Work Proton, and the search in Personal Proton
// could not see it). Each result says which mailbox it is in and where in it: Inbox, Sent, or its folder.
// Only mailboxes on the person's own login are searched (myMailboxes, the same rule as everywhere else).

export type Found = Item & { where: string }
const MAX = 150

function words(q: unknown): string[] {
  const text = String(q ?? '').trim()
  const w = text.split(/\s+/).map(likeSafe).filter(Boolean).slice(0, 6)
  if (text.length < 2 || !w.length) throw new UserError('Type something to search for.')
  return w
}

/** Where a message is, in words: Inbox, Sent, its folder or label (the deepest name), or Filed. */
async function placeAll(items: Item[], boxes: Mailbox[]): Promise<Found[]> {
  const need = boxes.filter(b => items.some(i => i.mailbox_id === b.id && !i.in_inbox && !i.sent && i.labels.length))
  const names = new Map<string, string>()
  // Folder names come from Gmail (or the Mac helper for Proton). A mailbox that cannot answer just shows "Filed".
  await pooled(need, 3, async b => { for (const l of await userLabels(b).catch(() => [])) names.set(b.id + ':' + l.id, l.name) })
  return items.map(i => {
    const folder = i.labels.map(l => names.get(i.mailbox_id + ':' + l)).filter((n): n is string => !!n).sort((a, b) => b.split('/').length - a.split('/').length)[0]
    return { ...i, where: i.in_inbox ? 'Inbox' : i.sent ? 'Sent' : folder ? folder.replace(/\//g, ' / ') : 'Filed' }
  })
}

/** Search every mailbox at once in what RPMail has loaded (each inbox, its folders and the last 90 days). Newest first. */
export async function searchAll(who: Me, p: Record<string, string>) {
  const w = words(p.q)
  const boxes = await myMailboxes(who)
  if (!boxes.length) return { messages: [] as Found[], total: 0 }
  let q = createAdminClient().from('rpmail_messages').select(LIST_COLS).in('mailbox_id', boxes.map(b => b.id))
  for (const word of w) q = q.or(`subject.ilike.%${word}%,from_name.ilike.%${word}%,from_addr.ilike.%${word}%,snippet.ilike.%${word}%,to_addrs.ilike.%${word}%,site.ilike.%${word}%,po.ilike.%${word}%`)
  const { data, error } = await q.order('date', { ascending: false }).limit(600)
  if (error) throw new Error('Could not search.')
  const found = await placeAll(groupThreads((data ?? []) as Row[], MAX), boxes)
  return { messages: found, total: found.length }
}

/**
 * Look further back: ask each connected mailbox itself (Gmail's search, or Proton through the Mac helper) for up to 25
 * matches each, bring them into RPMail's list, and return everything found. A mailbox that cannot answer is named.
 */
export async function searchAllFurther(who: Me, p: { q?: unknown }) {
  const text = String(p.q ?? '').trim().slice(0, 200)
  words(text)
  const boxes = (await myMailboxes(who)).filter(b => b.token_secret_id)
  const missed: string[] = []
  const hits = await pooled(boxes, 3, async b => {
    try {
      const d = await gmail<{ messages?: { id: string }[] }>(b.id, 'messages', { params: { q: text, maxResults: '25' }, tries: 2 })
      const ids = (d?.messages ?? []).map(m => m.id)
      if (ids.length) await loadMessages(b, ids, await knownSites(b.company_id), true)
      return { box: b.id, ids }
    } catch { missed.push(b.name); return { box: b.id, ids: [] as string[] } }
  })
  const admin = createAdminClient()
  const rows: Row[] = []
  for (const h of hits.filter(h => h.ids.length)) {
    const { data } = await admin.from('rpmail_messages').select(LIST_COLS).eq('mailbox_id', h.box).in('gmail_id', h.ids)
    rows.push(...((data ?? []) as Row[]))
  }
  rows.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  const found = await placeAll(groupThreads(rows, MAX), boxes)
  return { messages: found, total: found.length, missed }
}
