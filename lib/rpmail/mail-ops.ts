import { createAdminClient } from '@/lib/supabase/admin'
import { gmail, b64url, headerMap, isHidden, UserError, type GMessage } from './gmail'
import { mailboxFor, noPricingAddresses, maySend, mayDelete, Forbidden, type Me, type Mailbox } from './access'
import { logActivity } from './activity'
import { contentRules, contentGuard } from './company'
import { getPrefs, dayStartIn, DEFAULT_TZ } from './prefs'
import { knownSites, loadMessages, toRow, walkParts, bodyText, type IndexRow } from './sync'
import { buildRaw, cleanRecipients, pricingGuard, type OutFile } from './mime'
import { parseAddrs, decodeWords, splitAddrList, dropBlocks } from './parse'
import { takeAttachments, takePictures, dropAttachments, MAX_ATTACH } from './compose-ops'
import { randomBytes } from 'crypto'
import { cleanRich, hasFormatting, replyQuoteHtml, forwardQuoteHtml, pictureTag, escAttr, keptWording } from './rich'

// RPMail: reading, filing and sending for one mailbox. Every function starts from `mailboxFor(me, …)`, so a person
// can only ever touch a mailbox that is on their own login.

const GID = /^[0-9a-f]{6,32}$/i
export const gid = (v: unknown): string => { if (typeof v !== 'string' || !GID.test(v)) throw new UserError('No such message.'); return v }

export type Item = {
  mailbox_id: string; id: string; thread_id: string; date: number; from_name: string; from_addr: string; to_addrs: string
  subject: string; snippet: string; unread: boolean; starred: boolean; has_att: boolean; in_inbox: boolean; sent: boolean
  site: string | null; po: string | null; count?: number; why?: string; waiting?: boolean
  /** Gmail label ids the person made themselves (Label_…). Gmail's own tabs and system labels are left out. */
  labels: string[]
  /** This person's own snooze or reminder on the conversation, if they set one. */
  snooze?: SnoozeInfo
}
export type SnoozeInfo = { kind: 'snooze' | 'remind'; until: number; woke: boolean }

/** This person's snoozes and reminders in one mailbox, by conversation. */
export async function mySnoozes(profileId: string, mailboxId: string): Promise<Map<string, SnoozeInfo>> {
  const { data } = await createAdminClient().from('rpmail_snoozes').select('thread_id, kind, until, woke_at').eq('profile_id', profileId).eq('mailbox_id', mailboxId)
  return new Map((data ?? []).map(z => [z.thread_id as string, { kind: z.kind as 'snooze' | 'remind', until: Date.parse(z.until as string), woke: !!z.woke_at }]))
}
export const LIST_COLS = 'mailbox_id, gmail_id, thread_id, date, from_name, from_addr, to_addrs, subject, snippet, unread, starred, has_att, in_inbox, sent, site, po, labels'
type Row = Pick<IndexRow, 'mailbox_id' | 'gmail_id' | 'thread_id' | 'date' | 'from_name' | 'from_addr' | 'to_addrs' | 'subject' | 'snippet' | 'unread' | 'starred' | 'has_att' | 'in_inbox' | 'sent' | 'site' | 'po'> & { labels?: string[] | null }
export const toItem = (r: Row): Item => ({
  mailbox_id: r.mailbox_id, id: r.gmail_id, thread_id: r.thread_id, date: Date.parse(r.date), from_name: r.from_name ?? '', from_addr: r.from_addr ?? '',
  to_addrs: r.to_addrs ?? '', subject: r.subject ?? '', snippet: r.snippet ?? '', unread: !!r.unread, starred: !!r.starred, has_att: !!r.has_att,
  in_inbox: !!r.in_inbox, sent: !!r.sent, site: r.site ?? null, po: r.po ?? null,
  labels: (r.labels ?? []).filter(l => l.startsWith('Label_')),
})

/** One conversation per line, newest message first; bold when anything in it is unread. */
export function groupThreads(rows: Row[], max = 200): Item[] {
  const by = new Map<string, Item>()
  for (const r of rows) {
    const k = r.mailbox_id + ':' + r.thread_id
    const g = by.get(k)
    if (!g) by.set(k, { ...toItem(r), count: 1 })
    else {
      g.count = (g.count ?? 1) + 1; g.unread = g.unread || !!r.unread; g.has_att = g.has_att || !!r.has_att; g.starred = g.starred || !!r.starred
      for (const l of r.labels ?? []) if (l.startsWith('Label_') && !g.labels.includes(l)) g.labels.push(l)
    }
  }
  return [...by.values()].slice(0, max)
}

const likeSafe = (w: string) => w.replace(/[,()%_*\\"']/g, ' ').trim()

const DAY = /^\d{4}-\d{2}-\d{2}$/
/** The moment a calendar day starts in Eastern time. (Kept by name for the callers that are always Eastern.) */
export const easternDayStart = (day: string, plus = 0) => dayStartIn(day, plus)

export async function listMessages(who: Me, p: Record<string, string>) {
  const box = await mailboxFor(who, p.mailbox)
  const admin = createAdminClient()
  const view = p.view || 'inbox'
  const snoozes = await mySnoozes(who.id, box.id)
  const asleep = new Set([...snoozes].filter(([, z]) => z.kind === 'snooze' && !z.woke).map(([t]) => t))   // off this person's lists until the time comes
  const tag = (items: Item[]) => items.map(i => { const z = snoozes.get(i.thread_id); return z ? { ...i, snooze: z } : i })
  if (view === 'needs') {
    const { data } = await admin.rpc('rpmail_needs', { p_profile: who.id, p_mailbox: box.id, p_limit: 200 })
    return { messages: tag(((data ?? []) as Row[]).map(toItem)), total: (data ?? []).length }
  }
  let q = admin.from('rpmail_messages').select(LIST_COLS).eq('mailbox_id', box.id)
  if (view === 'snoozed') {
    if (!asleep.size) return { messages: [], total: 0 }
    q = q.in('thread_id', [...asleep])
  }
  if (view === 'inbox') q = q.eq('in_inbox', true)
  else if (view === 'sent') q = q.eq('sent', true)
  else if (view === 'filed') q = q.eq('in_inbox', false).eq('sent', false)
  if (p.unread === '1') q = q.eq('unread', true)
  if (p.att === '1') q = q.eq('has_att', true)
  if (p.starred === '1') q = q.eq('starred', true)
  if (p.label) { if (!/^Label_[A-Za-z0-9_-]{1,40}$/.test(p.label)) throw new UserError('No such label.'); q = q.contains('labels', [p.label]) }
  if (p.from) { const s = likeSafe(p.from); if (s) q = q.or(`from_addr.ilike.%${s}%,from_name.ilike.%${s}%`) }
  if (DAY.test(p.after ?? '') || DAY.test(p.before ?? '')) {
    const tz = (await getPrefs(who)).tz                                                // days are counted by the person's own clock
    if (DAY.test(p.after ?? '')) q = q.gte('date', dayStartIn(p.after, 0, tz))         // from the start of that day
    if (DAY.test(p.before ?? '')) q = q.lt('date', dayStartIn(p.before, 1, tz))        // through the end of that day
  }
  if (p.site) { const s = likeSafe(p.site); if (s) q = q.or(`site.ilike.%${s}%,po.ilike.%${s}%,subject.ilike.%${s}%`) }
  for (const word of (p.q || '').split(/\s+/).map(likeSafe).filter(Boolean).slice(0, 6)) {
    q = q.or(`subject.ilike.%${word}%,from_name.ilike.%${word}%,from_addr.ilike.%${word}%,snippet.ilike.%${word}%,to_addrs.ilike.%${word}%`)
  }
  const { data, error } = await q.order('date', { ascending: false }).limit(800)
  if (error) throw new Error('Could not load the list.')
  const rows = ((data ?? []) as Row[]).filter(r => view !== 'inbox' || !asleep.has(r.thread_id))
  const groups = tag(groupThreads(rows))
  return { messages: groups, total: groups.length }
}

/** Search all of the mailbox in Gmail itself (older than what the index holds), and bring the hits into the index. */
export async function searchGmail(who: Me, p: { mailbox?: unknown; q?: unknown }) {
  const box = await mailboxFor(who, p.mailbox)
  const text = String(p.q ?? '').trim().slice(0, 200)
  if (text.length < 2) throw new UserError('Type something to search for.')
  const d = await gmail<{ messages?: { id: string }[] }>(box.id, 'messages', { params: { q: text, maxResults: '40' } })
  const ids = (d?.messages ?? []).map(m => m.id)
  if (!ids.length) return { messages: [], total: 0 }
  await loadMessages(box, ids, await knownSites(box.company_id))
  const { data } = await createAdminClient().from('rpmail_messages').select(LIST_COLS).eq('mailbox_id', box.id).in('gmail_id', ids).order('date', { ascending: false })
  const groups = groupThreads((data ?? []) as Row[])
  return { messages: groups, total: groups.length }
}

const BARE_TAG = /<\/?(?:script|iframe|object|embed|noscript|form|link|base|meta)\b/gi

/**
 * Takes out of received mail anything that could run or load. The page also shows mail in a locked frame that cannot
 * run scripts or load anything; this is the second lock. Single passes, for the reason given in parse.ts.
 */
export function sanitizeHtml(html: string): string {
  // 1. Whole blocks, with what is inside them. One that is never closed keeps its opening tag for step 2, and what follows stays as words.
  const h = dropBlocks(html, 'script|iframe|object|embed|noscript')
  // 2. The tags themselves, wherever one is left.
  let out = '', i = 0
  for (;;) {
    BARE_TAG.lastIndex = i
    const m = BARE_TAG.exec(h)
    if (!m) { out += h.slice(i); break }
    out += h.slice(i, m.index)
    const gt = h.indexOf('>', BARE_TAG.lastIndex)
    if (gt < 0) break                            // a tag that never ends: a browser shows nothing after it either
    i = gt + 1
  }
  return out
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, 'blocked:')
}

export type ThreadItem = { id: string; date: number; from_name: string; from_addr: string; to_addrs: string; snippet: string; unread: boolean; sent: boolean }

/**
 * The other messages in the conversation, oldest first, read live from Gmail: who, when and Gmail's short preview only.
 * Nothing is stored, and no message text is fetched until the person opens that message. Drafts, Trash and Spam are left out.
 * If Gmail does not answer, the short list RPMail already holds is used instead (it may miss mail older than 90 days).
 */
async function restOfThread(box: Mailbox, m: GMessage, sites: Set<string>): Promise<ThreadItem[]> {
  try {
    const t = await gmail<{ messages?: GMessage[] }>(box.id, 'threads/' + m.threadId, { params: { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Subject'] }, tries: 1 })   // asked once: a slow Gmail must not hold up opening the message
    return (t?.messages ?? []).filter(x => x.id !== m.id && !isHidden(x.labelIds)).slice(-100).map(x => {
      const r = toRow(box, x, sites)
      return { id: x.id, date: Date.parse(r.date), from_name: r.from_name, from_addr: r.from_addr, to_addrs: r.to_addrs, snippet: r.snippet, unread: r.unread, sent: r.sent }
    }).sort((a, b) => a.date - b.date)
  } catch {
    const { data } = await createAdminClient().from('rpmail_messages').select('gmail_id, date, from_name, from_addr, to_addrs, snippet, unread, sent')
      .eq('mailbox_id', box.id).eq('thread_id', m.threadId).neq('gmail_id', m.id).order('date', { ascending: true }).limit(100)
    return (data ?? []).map(t => ({ id: t.gmail_id as string, date: Date.parse(t.date as string), from_name: (t.from_name as string) ?? '', from_addr: (t.from_addr as string) ?? '',
      to_addrs: (t.to_addrs as string) ?? '', snippet: (t.snippet as string) ?? '', unread: !!t.unread, sent: !!t.sent }))
  }
}

async function liveMessage(box: Mailbox, id: string): Promise<GMessage> {
  const m = await gmail<GMessage>(box.id, 'messages/' + id, { params: { format: 'full' } })
  if (!m) throw new UserError('That message is no longer in Gmail.')
  return m
}

/** Open one message: read live from Gmail. Opening never marks it read. Nothing of the body is stored. */
export async function readMessage(who: Me, p: Record<string, string>) {
  const box = await mailboxFor(who, p.mailbox)
  const id = gid(p.id)
  const admin = createAdminClient()
  // Everything that does not need the message itself is asked for at the same time as the message, not one after another.
  const [m, sites, done, snoozes] = await Promise.all([
    liveMessage(box, id),
    knownSites(box.company_id),
    admin.from('rpmail_done').select('gmail_id').eq('profile_id', who.id).eq('mailbox_id', box.id).eq('gmail_id', id).maybeSingle().then(r => r.data),
    mySnoozes(who.id, box.id),
  ])
  const row = toRow(box, m, sites)
  const rest = restOfThread(box, m, sites)   // asked for now, used at the end: it runs while the rest of this is worked out
  const saved = isHidden(m.labelIds) ? Promise.resolve() : admin.from('rpmail_messages').upsert(row, { onConflict: 'mailbox_id,gmail_id' }).then(() => undefined)
  const { plain, html, files } = walkParts(m.payload)
  let safe = html ? sanitizeHtml(html) : null
  if (safe) {
    // Pictures that are part of the message itself (logos in a signature, pasted screenshots) are put in place, all fetched at once.
    let budget = 6_000_000
    const want = files.filter(f => f.inline && f.cid && f.attachmentId && f.type.startsWith('image/') && f.size < 2_000_000 && safe!.includes('cid:' + f.cid)).slice(0, 12)
      .filter(f => (budget -= f.size) >= 0)
    const got = await Promise.all(want.map(f => gmail<{ data?: string }>(box.id, `messages/${id}/attachments/${f.attachmentId}`).catch(() => null)))
    want.forEach((f, i) => { const d = got[i]?.data; if (d) safe = safe!.split('cid:' + f.cid).join(`data:${f.type};base64,${b64url(d).toString('base64')}`) })
  }
  const h = headerMap(m.payload)
  const snooze = snoozes.get(m.threadId)
  const [thread] = await Promise.all([rest, saved])
  return {
    ...toItem(row), cc_addrs: row.cc_addrs, to_full: decodeWords(h['to'] ?? ''), cc_full: decodeWords(h['cc'] ?? ''),
    text: bodyText(plain, html).slice(0, 400_000), html: safe && safe.length < 3_000_000 ? safe : null,
    attachments: files.map((f, i) => ({ i, name: f.name, type: f.type, size: f.size, inline: f.inline })).filter(f => !f.inline || !safe),
    thread,
    done: !!done, hidden: isHidden(m.labelIds), ...(snooze ? { snooze } : {}),
  }
}

const INLINE_OK = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain'])

/** One attachment, streamed from Gmail. The file name and type come from Gmail, never from the request. */
export async function readAttachment(who: Me, p: Record<string, string>): Promise<Response> {
  const box = await mailboxFor(who, p.mailbox)
  const id = gid(p.id)
  const m = await liveMessage(box, id)
  const f = walkParts(m.payload).files[Number(p.i)]
  if (!f?.attachmentId) throw new UserError('No such attachment.')
  if (f.size > 26_000_000) throw new UserError('That attachment is too large to open here. Open it in Gmail.')
  const a = await gmail<{ data?: string }>(box.id, `messages/${id}/attachments/${f.attachmentId}`)
  if (!a?.data) throw new UserError('Gmail did not return that attachment.')
  const inline = INLINE_OK.has(f.type) && p.download !== '1'
  const name = f.name.replace(/[\r\n"\\/]/g, '_').slice(0, 180) || 'attachment'
  return new Response(new Uint8Array(b64url(a.data)), { headers: {
    'Content-Type': inline ? f.type : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    // Only PDFs, pictures and plain text open in the browser (none of them can run code); everything else downloads.
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
  } })
}

async function threadIds(box: Mailbox, threadId: string): Promise<string[]> {
  const t = await gmail<{ messages?: { id: string }[] }>(box.id, 'threads/' + threadId, { params: { format: 'minimal' } })
  return (t?.messages ?? []).map(m => m.id)
}
async function reindexThread(box: Mailbox, threadId: string) {
  const ids = await threadIds(box, threadId)
  const admin = createAdminClient()
  if (!ids.length) { await admin.from('rpmail_messages').delete().eq('mailbox_id', box.id).eq('thread_id', threadId); return }
  await loadMessages(box, ids, await knownSites(box.company_id))
}
export async function indexRow(box: Mailbox, id: string) {
  const { data } = await createAdminClient().from('rpmail_messages').select('gmail_id, thread_id, subject, in_inbox').eq('mailbox_id', box.id).eq('gmail_id', id).maybeSingle()
  if (data) return data as { gmail_id: string; thread_id: string; subject: string; in_inbox: boolean }
  const m = await liveMessage(box, id)
  return { gmail_id: id, thread_id: m.threadId, subject: decodeWords(headerMap(m.payload)['subject'] ?? ''), in_inbox: (m.labelIds ?? []).includes('INBOX') }
}

/** Mark a conversation read, or one message unread. */
export async function markRead(who: Me, p: { mailbox?: unknown; id?: unknown; unread?: unknown }) {
  const box = await mailboxFor(who, p.mailbox)
  const id = gid(p.id)
  const row = await indexRow(box, id)
  const admin = createAdminClient()
  if (p.unread === true) {
    await gmail(box.id, `messages/${id}/modify`, { method: 'POST', body: { addLabelIds: ['UNREAD'] } })
    await admin.from('rpmail_messages').update({ unread: true }).eq('mailbox_id', box.id).eq('gmail_id', id)
  } else {
    await gmail(box.id, `threads/${row.thread_id}/modify`, { method: 'POST', body: { removeLabelIds: ['UNREAD'] } })
    await admin.from('rpmail_messages').update({ unread: false }).eq('mailbox_id', box.id).eq('thread_id', row.thread_id)
  }
  return { ok: true, unread: p.unread === true }
}

const PLACES = ['Archive', 'Inbox', 'Spam', 'Trash'] as const
type Place = typeof PLACES[number]

/** Archive / Inbox / Spam / Trash for a whole conversation. Trash is Gmail's Trash (kept 30 days), never a permanent delete. */
export async function fileMessage(who: Me, p: { mailbox?: unknown; id?: unknown; dest?: unknown }) {
  const box = await mailboxFor(who, p.mailbox)
  const id = gid(p.id)
  const dest = p.dest as Place
  if (!PLACES.includes(dest)) throw new UserError('Mail can go to Archive, Inbox, Spam or Trash.')
  if ((dest === 'Trash' || dest === 'Spam') && !mayDelete(box)) throw new Forbidden(`You can read ${box.name} but not delete from it. An owner can change that in Settings, RPMail.`)
  const row = await indexRow(box, id)
  const admin = createAdminClient()
  const t = `threads/${row.thread_id}`
  if (dest === 'Archive') await gmail(box.id, `${t}/modify`, { method: 'POST', body: { removeLabelIds: ['INBOX'] } })
  else if (dest === 'Inbox') await gmail(box.id, `${t}/modify`, { method: 'POST', body: { addLabelIds: ['INBOX'], removeLabelIds: ['SPAM'] } })
  else if (dest === 'Spam') await gmail(box.id, `${t}/modify`, { method: 'POST', body: { addLabelIds: ['SPAM'], removeLabelIds: ['INBOX'] } })
  else await gmail(box.id, `${t}/trash`, { method: 'POST' })
  if (dest === 'Archive') await admin.from('rpmail_messages').update({ in_inbox: false }).eq('mailbox_id', box.id).eq('thread_id', row.thread_id)
  else if (dest === 'Inbox') await reindexThread(box, row.thread_id)
  else await admin.from('rpmail_messages').delete().eq('mailbox_id', box.id).eq('thread_id', row.thread_id)
  const { data: mv } = await admin.from('rpmail_moves').insert({ profile_id: who.id, mailbox_id: box.id, gmail_id: id, thread_id: row.thread_id,
    subject: (row.subject ?? '').slice(0, 300), from_place: row.in_inbox ? 'Inbox' : 'All Mail', to_place: dest }).select('id').single()
  if (dest === 'Trash' || dest === 'Spam') await logActivity(who, dest === 'Trash' ? 'trash' : 'spam', { box, detail: (row.subject ?? '').slice(0, 160) })
  return { ok: true, move_id: mv?.id ?? null, to: dest }
}

/** Put a filed conversation back where it was. A person can only undo their own moves. */
export async function undoMove(who: Me, p: { move?: unknown }) {
  const admin = createAdminClient()
  const { data: mv } = await admin.from('rpmail_moves').select('*').eq('id', Number(p.move) || 0).eq('profile_id', who.id).maybeSingle()
  if (!mv) throw new UserError('That move is not on your list.')
  if (mv.undone) throw new UserError('That one was already put back.')
  const box = await mailboxFor(who, mv.mailbox_id)
  const t = `threads/${mv.thread_id}`
  const back = mv.from_place === 'Inbox' ? ['INBOX'] : []
  if (mv.to_place === 'Trash') {
    await gmail(box.id, `${t}/untrash`, { method: 'POST' })
    if (back.length) await gmail(box.id, `${t}/modify`, { method: 'POST', body: { addLabelIds: back } })
  } else if (mv.to_place === 'Spam') await gmail(box.id, `${t}/modify`, { method: 'POST', body: { removeLabelIds: ['SPAM'], addLabelIds: back } })
  else if (mv.to_place === 'Archive') await gmail(box.id, `${t}/modify`, { method: 'POST', body: { addLabelIds: ['INBOX'] } })
  else if (mv.label_id) await gmail(box.id, `${t}/modify`, { method: 'POST', body: { removeLabelIds: [mv.label_id], addLabelIds: back } })   // "moved to a label"
  else await gmail(box.id, `${t}/modify`, { method: 'POST', body: { removeLabelIds: ['INBOX'] } })
  await reindexThread(box, mv.thread_id)
  await admin.from('rpmail_moves').update({ undone: true }).eq('id', mv.id)
  return { ok: true, back_to: mv.from_place === 'Inbox' ? 'the inbox' : mv.to_place === 'Inbox' ? 'where it was' : 'All Mail' }
}

/** Tick an item off your own lists (or put it back). Nothing changes in Gmail, and nobody else's lists change. */
export async function markDone(who: Me, p: { mailbox?: unknown; id?: unknown; on?: unknown }) {
  const box = await mailboxFor(who, p.mailbox)
  const id = gid(p.id)
  const admin = createAdminClient()
  if (p.on === false) await admin.from('rpmail_done').delete().eq('profile_id', who.id).eq('mailbox_id', box.id).eq('gmail_id', id)
  else await admin.from('rpmail_done').upsert({ profile_id: who.id, mailbox_id: box.id, gmail_id: id }, { onConflict: 'profile_id,mailbox_id,gmail_id', ignoreDuplicates: true })
  return { ok: true, done: p.on !== false }
}

/** A person's signature for one mailbox: the plain wording, and the same with its formatting when it has any. */
export async function getSignature(who: Me, boxId: string): Promise<{ text: string; html: string | null }> {
  const { data } = await createAdminClient().from('rpmail_signatures').select('body, html').eq('profile_id', who.id).eq('mailbox_id', boxId).maybeSingle()
  return { text: (data?.body as string | undefined) ?? '', html: (data?.html as string | null | undefined) || null }
}
export async function setSignature(who: Me, p: { mailbox?: unknown; text?: unknown; html?: unknown }) {
  const box = await mailboxFor(who, p.mailbox)
  // With formatting, the HTML is cleaned here and the plain wording is taken from the cleaned copy (as for a message).
  const sig = keptWording(p.html, p.text, 4000)
  await createAdminClient().from('rpmail_signatures').upsert({ profile_id: who.id, mailbox_id: box.id, body: sig.text, html: sig.html }, { onConflict: 'profile_id,mailbox_id' })
  return { ok: true, text: sig.text, html: sig.html }
}

const whenText = (ms: number, tz = DEFAULT_TZ) => new Date(ms).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

type Prep = { from: string; to: string; cc: string; subject: string; quoted: string; quotedHtml: string; forward: boolean; attachments: string[]; signature: string; signature_html: string | null
  msgid: string; refs: string; threadId: string; files: ReturnType<typeof walkParts>['files'] }

async function prep(who: Me, box: Mailbox, id: string, all: boolean, forward: boolean): Promise<Prep> {
  const m = await liveMessage(box, id)
  const h = headerMap(m.payload)
  const { plain, html, files } = walkParts(m.payload)
  const body = bodyText(plain, html)
  const from = parseAddrs(decodeWords(h['from'] ?? ''))[0] ?? { name: '', addr: '' }
  const toList = parseAddrs(decodeWords(h['to'] ?? '')).map(a => a.addr)
  const ccList = parseAddrs(decodeWords(h['cc'] ?? '')).map(a => a.addr)
  const mine = new Set([box.address, who.email].filter(Boolean))
  let subj = decodeWords(h['subject'] ?? '')
  const when = whenText(Number(m.internalDate ?? Date.now()), (await getPrefs(who)).tz)
  const sig = await getSignature(who, box.id)
  const msgid = (h['message-id'] ?? '').trim()
  const refs = (((h['references'] ?? '') + ' ' + msgid).match(/<[^>]+>/g) ?? []).slice(-20).join(' ')
  const base = { from: box.address, signature: sig.text, signature_html: sig.html, msgid, refs, threadId: m.threadId, files }
  if (forward) {
    if (!/^fwd?\s*:/i.test(subj)) subj = 'Fwd: ' + subj
    const head = `---------- Forwarded message ----------\nFrom: ${from.name} <${from.addr}>\nDate: ${when}\nSubject: ${decodeWords(h['subject'] ?? '')}\nTo: ${toList.join(', ')}`
      + (ccList.length ? `\nCc: ${ccList.join(', ')}` : '')
    return { ...base, to: '', cc: '', subject: subj, quoted: head + '\n\n' + body, quotedHtml: forwardQuoteHtml(head, body), forward: true, attachments: files.filter(f => !f.inline && f.attachmentId).map(f => f.name) }
  }
  let to = parseAddrs(decodeWords(h['reply-to'] ?? '')).map(a => a.addr)
  if (!to.length) to = from.addr ? [from.addr] : []
  if (mine.has(from.addr)) {
    // Replying to something this mailbox sent: it goes to the people it was sent to, not back to the mailbox.
    const others = toList.filter(a => !mine.has(a))
    if (others.length) to = others
  }
  const cc: string[] = []
  if (all) for (const a of [...toList, ...ccList]) if (!mine.has(a) && !to.includes(a) && !cc.includes(a)) cc.push(a)
  if (!/^re\s*:/i.test(subj)) subj = 'Re: ' + subj
  // The plain copy and the HTML copy quote the same lines of the original (never its own HTML, only its words).
  const head = `On ${when}, ${from.name} <${from.addr}> wrote:`, kept = body.split('\n').slice(0, 200)
  const quoted = head + '\n' + kept.map(l => '> ' + l).join('\n')
  return { ...base, to: to.join(', '), cc: cc.join(', '), subject: subj, quoted, quotedHtml: replyQuoteHtml(head, kept.join('\n')), forward: false, attachments: [] }
}

/** What the reply / forward box starts with. */
export async function draftPrep(who: Me, p: Record<string, string>) {
  const box = await mailboxFor(who, p.mailbox)
  const d = await prep(who, box, gid(p.id), p.all === '1', p.fwd === '1')
  return { from: d.from, to: d.to, cc: d.cc, subject: d.subject, quoted: d.quoted, forward: d.forward, attachments: d.attachments, signature: d.signature, signature_html: d.signature_html }
}

const tooLong = (): never => { throw new UserError('That message is too long to send from here. Shorten it, or put the long part in an attached file.') }

/**
 * Send, or save to Gmail Drafts. Called only from the person's own Send / Save draft click.
 * mode 'new' | 'reply' | 'forward'. A forward carries the original's attachments along.
 */
export async function sendMail(who: Me, p: { mailbox?: unknown; mode?: unknown; id?: unknown; to?: unknown; cc?: unknown; subject?: unknown; body?: unknown
  quote?: unknown; draft?: unknown; confirmed?: unknown; from?: unknown; files?: unknown; html?: unknown }) {
  // `src` is the mailbox the original message is in; `box` is the mailbox this goes out from (the From picker).
  const src = await mailboxFor(who, p.mailbox)
  const box = p.from && p.from !== src.id ? await mailboxFor(who, p.from) : src
  if (!maySend(box)) throw new Forbidden(`You can read ${box.name} but not send from it. An owner can change that in Settings, RPMail.`)
  const mode = p.mode === 'reply' || p.mode === 'forward' ? p.mode : 'new'
  const draft = p.draft === true
  if (!draft && p.confirmed !== true) throw new UserError('Press Send, then confirm.')
  const { to, cc } = cleanRecipients(String(p.to ?? ''), String(p.cc ?? ''), !draft)
  // A message written with formatting arrives as HTML. It is rebuilt from scratch here (cleanRich), and the plain text is
  // made from that same rebuilt copy, never taken from the page. So the rules below read exactly what will go out.
  const rich = typeof p.html === 'string' && p.html.trim() ? cleanRich(p.html.length > 600_000 ? tooLong() : p.html) : null
  if (rich && rich.text.length > 200_000) tooLong()
  const typed = (rich ? rich.text : String(p.body ?? '')).replace(/\s+$/, '').slice(0, 200_000)
  // With no bold, list or link in it, the message goes as plain text, exactly as before.
  let html = rich && hasFormatting(rich.html) ? rich.html : null
  let subject = String(p.subject ?? '').trim().slice(0, 400)
  let full = typed, inReplyTo: string | undefined, references: string | undefined, threadId: string | undefined
  const files: OutFile[] = []
  if (mode !== 'new') {
    const d = await prep(who, src, gid(p.id), false, mode === 'forward')
    if (!subject) subject = d.subject
    if (mode === 'forward' || p.quote !== false) {
      full = typed + '\n\n' + d.quoted
      if (html !== null) html += '<div><br></div>' + d.quotedHtml
    }
    if (mode === 'reply') {
      if (!typed) throw new UserError('The reply is empty.')
      if (d.msgid) { inReplyTo = d.msgid; references = d.refs }
      if (box.id === src.id) threadId = d.threadId   // from another mailbox it still carries the reply headers, so the other side sees one conversation
    } else {
      let total = 0
      for (const f of d.files.filter(f => !f.inline && f.attachmentId)) {
        total += f.size
        if (total > 20_000_000) throw new UserError('The attachments on that message are too large to forward from here (over 20 MB). Forward it from Gmail.')
        const a = await gmail<{ data?: string }>(src.id, `messages/${gid(p.id)}/attachments/${f.attachmentId}`)
        if (!a?.data) throw new UserError(`Could not load the attachment ${f.name}.`)
        files.push({ name: f.name, type: f.type, data: b64url(a.data) })
      }
    }
  } else if (!(to.length || subject || typed)) throw new UserError('The message is empty.')

  // Files the person attached themselves (they wait in private storage under their own id until now).
  const own = await takeAttachments(who, p.files)
  files.push(...own.files)
  // Pictures placed in the text: read from the same private folder, checked to be real pictures, and given a name the HTML can point at.
  const pics = rich?.pictures.length ? await takePictures(who, rich.pictures) : { files: [], paths: [] }
  const pictures = pics.files.map(f => ({ ...f, cid: randomBytes(10).toString('hex') + '@rpmail' }))
  if (html !== null) pics.paths.forEach((path, i) => {
    html = html!.split(pictureTag(path)).join(`<img src="cid:${pictures[i].cid}" alt="${escAttr(pictures[i].name)}" style="max-width:100%;height:auto">`)
  })
  if ([...files, ...pictures].reduce((n, f) => n + f.data.length, 0) > MAX_ATTACH) throw new UserError('The attachments and pictures add up to more than 20 MB, which is more than email can carry. Take one off.')

  // The built-in pricing rule, then any rules the company wrote for itself. A refused send is written to the activity log.
  try {
    const crewReads = await noPricingAddresses(box.company_id), text = [subject, full, ...files.map(f => f.name), ...pictures.map(f => f.name)].join('\n')
    pricingGuard(box.address, [...to, ...cc], text, crewReads)
    contentGuard(await contentRules(box.company_id), box.address, [...to, ...cc], text, crewReads)
  } catch (e) {
    if (e instanceof UserError) await logActivity(who, 'blocked_send', { box, detail: e.message.slice(0, 220) })
    throw e
  }

  const raw = buildRaw({ fromName: (await getPrefs(who)).sender_name || who.name, fromAddr: box.address, to, cc, subject, body: full, inReplyTo, references, files,
    ...(html !== null ? { html: `<div dir="ltr">${html}</div>`, pictures } : {}) })
  const message = { raw, ...(threadId ? { threadId } : {}) }
  const admin = createAdminClient()
  if (draft) {
    const r = await gmail<{ id?: string }>(box.id, 'drafts', { method: 'POST', body: { message } })
    await admin.from('rpmail_sent').insert({ profile_id: who.id, mailbox_id: box.id, kind: 'draft', to_addrs: [...to, ...cc].join(', ').slice(0, 1000), subject: subject.slice(0, 300), gmail_id: r?.id ?? null })
    await dropAttachments([...own.paths, ...pics.paths])
    await logActivity(who, 'draft', { box, detail: `To ${[...to, ...cc].join(', ').slice(0, 120) || '(nobody yet)'}: ${subject.slice(0, 120)}` })
    return { ok: true, draft: true, from: box.address }
  }
  const r = await gmail<{ id?: string; threadId?: string }>(box.id, 'messages/send', { method: 'POST', body: message })
  await admin.from('rpmail_sent').insert({ profile_id: who.id, mailbox_id: box.id, kind: 'send', to_addrs: [...to, ...cc].join(', ').slice(0, 1000), subject: subject.slice(0, 300), gmail_id: r?.id ?? null })
  await dropAttachments([...own.paths, ...pics.paths])
  await logActivity(who, 'send', { box, detail: `To ${[...to, ...cc].join(', ').slice(0, 120)}: ${subject.slice(0, 120)}` })
  if (r?.id) await loadMessages(box, [r.id], await knownSites(box.company_id)).catch(() => null)
  return { ok: true, sent: true, to: [...to, ...cc].join(', '), from: box.address }
}

export { splitAddrList }
