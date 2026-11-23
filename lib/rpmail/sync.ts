import { createAdminClient } from '@/lib/supabase/admin'
import { gmail, pace, pooled, b64url, headerMap, isHidden, NotConnected, type GMessage, type GPart } from './gmail'
import { parseAddrs, decodeWords, htmlToText, topOf, asksForSomething, deadlineHint, findSite, findPo, isBulk } from './parse'
import type { Mailbox, SyncState } from './access'

// RPMail: keeps the small index (rpmail_messages) in step with Gmail.
//   * First time: lists the inbox plus the last 90 days and loads them a chunk at a time (the page keeps asking
//     until it is done, so no single request runs long).
//   * After that: asks Gmail only for what changed since the last look (the history bookmark).
// The message text is read here to work out the site number, whether it asks for something, and whether it has
// attachments, and is then dropped. Only the fields in rpmail_messages are kept.

const BACKFILL_DAYS = 90
const META_HEADERS = ['From', 'To', 'Cc', 'Reply-To', 'Subject', 'Message-ID', 'References', 'In-Reply-To', 'List-Unsubscribe', 'List-Id', 'Precedence', 'Auto-Submitted', 'Content-Type']
const CHUNK = 60
const MAX_LIST = 8000

let sitesCache: { at: number; company: string; set: Set<string> } | null = null
export async function knownSites(companyId: string): Promise<Set<string>> {
  if (sitesCache && sitesCache.company === companyId && Date.now() - sitesCache.at < 600_000) return sitesCache.set
  const set = new Set<string>()
  const admin = createAdminClient()
  for (let from = 0; from < 5000; from += 1000) {
    const { data } = await admin.from('con_sites').select('site_number').eq('company_id', companyId).range(from, from + 999)
    for (const r of data ?? []) if (/^\d{5}$/.test(r.site_number ?? '')) set.add(r.site_number as string)
    if (!data || data.length < 1000) break
  }
  sitesCache = { at: Date.now(), company: companyId, set }
  return set
}

/** Plain text, HTML and attachment parts of a Gmail message. */
export function walkParts(payload: GPart | undefined) {
  const plain: string[] = [], html: string[] = []
  const files: { name: string; type: string; size: number; attachmentId: string | null; cid: string; inline: boolean; partId: string }[] = []
  const walk = (p: GPart) => {
    const mt = (p.mimeType ?? '').toLowerCase()
    const h = headerMap(p)
    const cid = (h['content-id'] ?? '').replace(/^<|>$/g, '').trim()
    if (p.filename || (cid && mt.startsWith('image/'))) {
      files.push({ name: decodeWords(p.filename || cid), type: mt || 'application/octet-stream', size: p.body?.size ?? 0, attachmentId: p.body?.attachmentId ?? null,
        cid, inline: !!cid && !/attachment/i.test(h['content-disposition'] ?? ''), partId: p.partId ?? '' })
    } else if ((mt === 'text/plain' || mt === 'text/html') && p.body?.data) {
      const bytes = b64url(p.body.data).subarray(0, 600_000)
      const cs = /charset="?([\w.:-]+)/i.exec(h['content-type'] ?? '')?.[1] ?? 'utf-8'
      let text: string
      try { text = new TextDecoder(cs).decode(bytes) } catch { text = new TextDecoder('utf-8').decode(bytes) }
      ;(mt === 'text/plain' ? plain : html).push(text)
    }
    for (const s of p.parts ?? []) walk(s)
  }
  if (payload) walk(payload)
  return { plain: plain.join('\n'), html: html.join('\n'), files }
}

export const bodyText = (plain: string, html: string) => {
  const p = plain.trim() ? (/<\/(p|div|h\d|table|td|span|a)>/i.test(plain) ? htmlToText(plain) : plain) : (html ? htmlToText(html) : '')
  return p.replace(/\r\n/g, '\n')
}

// Gmail's tabs other than Primary. Updates is automated notices (receipts, confirmations, statements): nobody is waiting on a reply to those either.
const AUTO_CATEGORIES = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS', 'CATEGORY_UPDATES'])

const realFile = (name: string) => !/^(image\d+|outlook-\w+)\.(png|jpe?g|gif)$/i.test(name)

export type IndexRow = {
  mailbox_id: string; gmail_id: string; thread_id: string; date: string; from_name: string; from_addr: string; to_addrs: string; cc_addrs: string
  reply_to: string; subject: string; snippet: string; msgid: string; refs: string; unread: boolean; in_inbox: boolean; sent: boolean; starred: boolean
  has_att: boolean; bulk: boolean; asks: boolean; deadline: string | null; site: string | null; po: string | null; labels: string[]
}

export function toRow(box: Pick<Mailbox, 'id' | 'address'>, m: GMessage, sites: Set<string>): IndexRow {
  const h = headerMap(m.payload)
  const from = parseAddrs(decodeWords(h['from'] ?? ''))[0] ?? { name: '', addr: '' }
  const labels = m.labelIds ?? []
  const { plain, html, files } = walkParts(m.payload)
  const top = topOf(bodyText(plain, html))
  const subject = decodeWords(h['subject'] ?? '').slice(0, 500)
  const sent = labels.includes('SENT') || from.addr === box.address
  // Gmail's own sorting counts too: Promotions, Social and Forums are never mail somebody is waiting on an answer to.
  const bulk = !sent && (isBulk(h, from.addr) || labels.some(l => AUTO_CATEGORIES.has(l)))
  const list = (k: string) => parseAddrs(decodeWords(h[k] ?? '')).map(a => a.addr).join(', ')
  const ms = Number(m.internalDate ?? 0)
  return {
    mailbox_id: box.id, gmail_id: m.id, thread_id: m.threadId, date: new Date(ms || Date.now()).toISOString(),
    from_name: (from.name || from.addr).slice(0, 200), from_addr: from.addr, to_addrs: list('to'), cc_addrs: list('cc'), reply_to: list('reply-to'),
    subject, snippet: decodeEntities(m.snippet ?? '').slice(0, 240), msgid: (h['message-id'] ?? '').trim().slice(0, 400),
    refs: ((h['references'] ?? '') + ' ' + (h['in-reply-to'] ?? '')).match(/<[^>]+>/g)?.slice(-12).join(' ') ?? '',
    unread: labels.includes('UNREAD'), in_inbox: labels.includes('INBOX'), sent, starred: labels.includes('STARRED'),
    has_att: files.some(f => !f.inline && realFile(f.name)), bulk,
    asks: !sent && !bulk && asksForSomething(top), deadline: sent || bulk ? null : deadlineHint(subject, top),
    site: findSite(subject, top, sites), po: findPo(subject + ' ' + top.slice(0, 1500)),
    labels: labels.filter(l => l.startsWith('Label_') || l.startsWith('CATEGORY_')),
  }
}

const decodeEntities = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')

async function listIds(boxId: string, q: string, max: number): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const d = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(boxId, 'messages', { params: { q, maxResults: '500', ...(pageToken ? { pageToken } : {}) } })
    for (const m of d?.messages ?? []) ids.push(m.id)
    pageToken = d?.nextPageToken
  } while (pageToken && ids.length < max)
  return ids.slice(0, max)
}

/** Fetch these messages from Gmail and write them to the index; ones that are gone or hidden are removed. */
export async function loadMessages(box: Mailbox, ids: string[], sites: Set<string>, fast = false): Promise<{ stored: number; failed: string[] }> {
  const admin = createAdminClient()
  const rows: IndexRow[] = [], gone: string[] = [], failed: string[] = []
  await pooled(ids, 5, async id => {
    try {
      await pace(box.id)
      // First load of a whole mailbox: ask for the headers only (much smaller), and fetch the full message just for
      // mail from people and for anything that may carry an attachment. Newsletters never need their text read.
      let m = await gmail<GMessage>(box.id, 'messages/' + id, { params: fast ? { format: 'metadata', metadataHeaders: META_HEADERS } : { format: 'full' } })
      if (m && fast && !isHidden(m.labelIds)) {
        const row = toRow(box, m, sites)
        if (row.bulk && !/multipart\/mixed/i.test(headerMap(m.payload)['content-type'] ?? '')) { rows.push(row); return }
        await pace(box.id)
        m = await gmail<GMessage>(box.id, 'messages/' + id, { params: { format: 'full' } })
      }
      if (!m || isHidden(m.labelIds)) gone.push(id)
      else rows.push(toRow(box, m, sites))
    } catch (e) {
      if (e instanceof NotConnected) throw e
      failed.push(id)
    }
  })
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin.from('rpmail_messages').upsert(rows.slice(i, i + 200), { onConflict: 'mailbox_id,gmail_id' })
    if (error) throw new Error('Could not save the mail index: ' + error.message)
  }
  if (gone.length) await admin.from('rpmail_messages').delete().eq('mailbox_id', box.id).in('gmail_id', gone)
  return { stored: rows.length, failed }
}

/**
 * Mail from a sender this mailbox has blocked goes straight to Gmail's Trash (Gmail keeps it 30 days) and never
 * reaches the lists or a notification. Only mail that has just arrived in the inbox is touched.
 */
async function applyBlocks(box: Mailbox, ids: string[]): Promise<number> {
  if (!ids.length) return 0
  const admin = createAdminClient()
  const { data: bl } = await admin.from('rpmail_blocks').select('addr').eq('mailbox_id', box.id)
  const blocked = new Set((bl ?? []).map(b => String(b.addr).toLowerCase()))
  if (!blocked.size) return 0
  let n = 0
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from('rpmail_messages').select('gmail_id, from_addr').eq('mailbox_id', box.id).eq('in_inbox', true).eq('sent', false).in('gmail_id', ids.slice(i, i + 200))
    for (const r of data ?? []) {
      if (!blocked.has(String(r.from_addr ?? '').toLowerCase())) continue
      await gmail(box.id, `messages/${r.gmail_id}/trash`, { method: 'POST' })
      await admin.from('rpmail_messages').delete().eq('mailbox_id', box.id).eq('gmail_id', r.gmail_id)
      n++
    }
  }
  return n
}

export type SyncResult = { done: boolean; total: number; left: number; changed: number; busy?: boolean }

/**
 * Bring one mailbox's index up to date. Works for at most `budgetMs`, then returns; `done: false` means call again.
 */
export async function syncMailbox(box: Mailbox, budgetMs = 18_000): Promise<SyncResult> {
  const admin = createAdminClient()
  const started = Date.now()
  const save = (patch: Record<string, unknown>) => admin.from('rpmail_mailboxes').update(patch).eq('id', box.id)
  let sync: SyncState & { busy?: string } = { ...(box.sync ?? {}) }
  // Two people with the same shared mailbox open: one syncs, the other waits for it.
  if (sync.busy && Date.now() - Date.parse(sync.busy) < 50_000) return { done: !sync.todo?.length, total: sync.total ?? 0, left: sync.todo?.length ?? 0, changed: 0, busy: true }
  const sites = await knownSites(box.company_id)
  let changed = 0

  try {
    let historyId = box.history_id
    if (!historyId && !sync.todo) {
      // First look at this mailbox.
      const prof = await gmail<{ historyId?: string }>(box.id, 'profile')
      const inbox = await listIds(box.id, 'in:inbox', 2000)
      const recent = await listIds(box.id, `-in:chats -in:drafts newer_than:${BACKFILL_DAYS}d`, MAX_LIST)
      const seen = new Set(inbox)
      const todo = [...inbox, ...recent.filter(i => !seen.has(i))]
      sync = { todo, total: todo.length, started: new Date().toISOString() }
      historyId = prof?.historyId ? String(prof.historyId) : null
      await save({ history_id: historyId, sync: { ...sync, busy: new Date().toISOString() }, last_error: null })
    }

    if (sync.todo?.length) {
      let todo = sync.todo
      while (todo.length && Date.now() - started < budgetMs) {
        await save({ sync: { ...sync, todo, busy: new Date().toISOString() } })
        const batch = todo.slice(0, CHUNK)
        const r = await loadMessages(box, batch, sites, true)
        changed += r.stored
        todo = todo.slice(CHUNK)   // a message that would not load is skipped, not retried forever
      }
      sync = todo.length ? { ...sync, todo } : { total: sync.total, started: sync.started, full_done: new Date().toISOString() }
      await save({ sync, last_sync_at: new Date().toISOString(), last_error: null, failing_since: null, fail_alerted_at: null })
      if (todo.length) return { done: false, total: sync.total ?? 0, left: todo.length, changed }
    }

    if (historyId) {
      const ids = new Set<string>()
      let pageToken: string | undefined, latest = historyId, expired = false
      do {
        const d = await gmail<{ history?: { messages?: { id: string }[] }[]; nextPageToken?: string; historyId?: string }>(box.id, 'history',
          { params: { startHistoryId: historyId, maxResults: '500', ...(pageToken ? { pageToken } : {}) } })
        if (d === null) { expired = true; break }   // the bookmark is too old for Gmail
        for (const h of d.history ?? []) for (const m of h.messages ?? []) ids.add(m.id)
        if (d.historyId) latest = String(d.historyId)
        pageToken = d.nextPageToken
      } while (pageToken && ids.size < 3000)
      if (expired) {
        // Start over from a clean index. Each person's Done ticks are kept (they are stored by message, separately).
        await admin.from('rpmail_messages').delete().eq('mailbox_id', box.id)
        await save({ history_id: null, sync: {}, last_error: null })
        return { done: false, total: 0, left: 1, changed }
      }
      if (ids.size) {
        const r = await loadMessages(box, [...ids], sites)
        changed += r.stored
        await applyBlocks(box, [...ids])
        if (r.failed.length) latest = historyId   // look again next time
      }
      await save({ history_id: latest, sync: { ...sync, busy: undefined }, last_sync_at: new Date().toISOString(), last_error: null, failing_since: null, fail_alerted_at: null })
    }
    return { done: true, total: sync.total ?? 0, left: 0, changed }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'sync failed'
    // The moment the trouble started is kept (not moved forward on each failure), so "failing for over an hour" can be told.
    await save({ sync: { ...sync, busy: undefined }, last_error: msg.slice(0, 300), ...(box.failing_since ? {} : { failing_since: new Date().toISOString() }) })
    throw e
  }
}
