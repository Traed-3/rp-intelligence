/**
 * Gmail → Ticket sync engine (maintenance.rps@gmail.com, fed by eshoptasks@).
 *
 * Shop rules this follows (checked against the mailbox, Nov 2026):
 *  - A new email thread = a new job. Replies are notes on that job.
 *  - A note is a completion only when it STARTS with "Complete"/"Completed".
 *    "Update …" is progress. "Complete duplicate" closes a repeat email.
 *  - The shop often FORWARDS the original with "Update …"/"Complete …" on top.
 *    Gmail makes that a new thread, so it is attached to the job it belongs to
 *    instead of opening a second ticket.
 *  - A thread stays in the Inbox until the job is done; archived = done.
 *  - "T20 OCD … Complete 334,286" and "truck inspected" also move the truck's
 *    oil-change / inspection dates (lib/fleet-service.ts).
 *
 * Regular runs read the Inbox AND everything received in the last few days
 * (archived or not), and only open threads that have mail we haven't logged.
 * Backfill runs (after/before) walk a date window the same way, oldest first,
 * and stop when their time budget is used so the caller can call again.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  listMessageRefs,
  getThread,
  getAttachment,
  listThreadIds,
  markAsRead,
} from '@/lib/gmail-client'
import {
  parseSubject,
  extractUnitCandidates,
  titleWithoutUnit,
  extractBody,
  getHeader,
  parseSender,
  detectStatus,
  isPersonalVehicle,
  personalVehicleInitials,
  generateTicketNumber,
  ownText,
  replyIntent,
  nonTicketReason,
  coreSubject,
  isOilChangeText,
  isStateInspectionText,
} from '@/lib/gmail-parser'
import { applyCompletedWork } from '@/lib/fleet-service'

const COMPANY_ID = 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'
// Employee Vehicle asset type ID
const EMPLOYEE_VEHICLE_TYPE_ID = '289b1400-4a45-46f2-829b-9748b70c66b6'
const TERMINAL_STATUSES = ['closed', 'completed', 'deferred']
const OPEN_STATUSES_EARLY = ['new', 'open', 'assigned']
/** The shop mailbox itself and the address that forwards into it. */
const SHOP_ADDRESSES = ['maintenance.rps@gmail.com', 'eshoptasks@gmail.com']

type Admin = ReturnType<typeof createAdminClient>

/** Automated Google emails (security alerts, etc.) are never tickets. */
function isGoogleSender(email: string): boolean {
  return /@(?:[a-z0-9.-]*\.)?google(?:mail)?\.com$/i.test(email)
}

// ── Asset helpers ─────────────────────────────────────────────────────────────

async function findOrCreateAsset(
  admin: ReturnType<typeof createAdminClient>,
  unitNumber: string
): Promise<string | null> {
  // Try exact match first
  const { data: asset } = await admin
    .from('assets')
    .select('id')
    .eq('company_id', COMPANY_ID)
    .ilike('unit_number', unitNumber)
    .maybeSingle()

  if (asset) return asset.id

  // Auto-create personal vehicle assets (initials + PV, e.g. PWPV)
  if (isPersonalVehicle(unitNumber)) {
    const initials = personalVehicleInitials(unitNumber)
    const { data: newAsset } = await admin
      .from('assets')
      .insert({
        company_id:    COMPANY_ID,
        unit_number:   unitNumber.toUpperCase(),
        name:          `Personal Vehicle ${initials}`,
        status:        'active',
        asset_type_id: EMPLOYEE_VEHICLE_TYPE_ID,
      })
      .select('id')
      .single()
    return newAsset?.id ?? null
  }

  return null
}

/**
 * Fallback asset resolver. The shop usually puts the unit first, but some emails
 * bury it ("Breaks sound bad on t20"). When the first-word unit doesn't match a
 * real asset, scan the WHOLE subject for tokens that match existing assets'
 * unit numbers. Returns every distinct real asset found, in subject order.
 *
 * Only the caller decides whether to use it — a single confident match is
 * auto-linked; multiple matches (e.g. "Service due S19, J10, I9") stay in the
 * review queue rather than silently picking one and dropping the rest.
 */
async function findAssetsInSubject(
  admin: ReturnType<typeof createAdminClient>,
  subject: string,
  skipUnit: string,
): Promise<{ unitNumber: string; assetId: string; matchText: string; viaAlias: boolean }[]> {
  // Load the company's assets once (small table) so we can match both unit-number
  // tokens AND per-asset email aliases (e.g. "mini excavator" → E35).
  const { data: assets } = await admin
    .from('assets')
    .select('id, unit_number, email_aliases')
    .eq('company_id', COMPANY_ID)
  if (!assets?.length) return []

  const out: { unitNumber: string; assetId: string; matchText: string; viaAlias: boolean }[] = []
  const usedIds = new Set<string>()
  const add = (unitNumber: string, assetId: string, matchText: string, viaAlias: boolean) => {
    if (!usedIds.has(assetId)) { usedIds.add(assetId); out.push({ unitNumber, assetId, matchText, viaAlias }) }
  }

  // 1) Unit-number tokens anywhere in the subject (in subject order)
  const byUnit = new Map(assets.map(a => [a.unit_number.toUpperCase(), a]))
  const candidates = extractUnitCandidates(subject).filter(u => u !== skipUnit.toUpperCase())
  for (const cand of candidates) {
    const a = byUnit.get(cand)
    if (a) add(a.unit_number, a.id, cand, false)
  }

  // 2) Per-asset alias phrases ("mini excavator", "forklift", …)
  for (const a of assets) {
    for (const alias of ((a as any).email_aliases ?? []) as string[]) {
      if (!alias?.trim()) continue
      const escaped = alias.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`\\b${escaped}\\b`, 'i').test(subject)) { add(a.unit_number, a.id, alias.trim(), true); break }
    }
  }

  return out
}

// ── Attachment helpers ────────────────────────────────────────────────────────

type GmailAttachment = { attachmentId: string; filename: string; mimeType: string }

/** Walk a message payload and collect image/PDF attachments. */
function collectAttachments(payload: any): GmailAttachment[] {
  const out: GmailAttachment[] = []
  function walk(p: any) {
    if (!p) return
    const fn  = p.filename
    const aid = p.body?.attachmentId
    const mt  = p.mimeType ?? ''
    if (fn && aid && (/^image\//i.test(mt) || /application\/pdf/i.test(mt))) {
      out.push({ attachmentId: aid, filename: fn, mimeType: mt })
    }
    for (const part of p.parts ?? []) walk(part)
  }
  walk(payload)
  return out
}

/** Download a message's attachments and attach them to a ticket (idempotent by filename). */
async function syncMessageAttachments(
  admin: ReturnType<typeof createAdminClient>,
  messageId: string,
  payload: any,
  ticketId: string
): Promise<number> {
  let added = 0
  for (const att of collectAttachments(payload)) {
    try {
      const { data: exists } = await admin
        .from('repair_ticket_attachments')
        .select('id').eq('ticket_id', ticketId).eq('file_name', att.filename).maybeSingle()
      if (exists) continue

      const buf  = await getAttachment(messageId, att.attachmentId)
      const safe = att.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `gmail/${ticketId}/${Date.now()}-${safe}`

      const { error: upErr } = await admin.storage
        .from('ticket-attachments')
        .upload(path, buf, { contentType: att.mimeType || 'application/octet-stream', upsert: false })
      if (upErr) continue

      const { data: urlData } = admin.storage.from('ticket-attachments').getPublicUrl(path)
      await admin.from('repair_ticket_attachments').insert({
        ticket_id:   ticketId,
        uploaded_by: null,
        file_url:    urlData.publicUrl,
        file_name:   att.filename,
        file_type:   att.mimeType || null,
      })
      added++
    } catch { /* skip bad attachment, keep going */ }
  }
  return added
}

// ── Reporter helpers ──────────────────────────────────────────────────────────

async function findReporter(
  admin: ReturnType<typeof createAdminClient>,
  email: string
): Promise<string | null> {
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('company_id', COMPANY_ID)
    .ilike('email', email)
    .maybeSingle()
  return data?.id ?? null
}

// ── Ticket number helpers ─────────────────────────────────────────────────────

async function buildTicketNumber(
  admin: ReturnType<typeof createAdminClient>,
  date: Date,
  unitNumber: string
): Promise<string> {
  const m    = date.getMonth() + 1
  const d    = date.getDate()
  const y    = date.getFullYear().toString().slice(-2)
  const base = `${m}${d}${y}${unitNumber}`

  const { data: existing } = await admin
    .from('repair_tickets')
    .select('ticket_number')
    .eq('company_id', COMPANY_ID)
    .or(`ticket_number.eq.${base},ticket_number.like.${base}[A-Z]`)

  const existingNums = (existing ?? []).map((t: any) => t.ticket_number)
  return generateTicketNumber(date, unitNumber, existingNums)
}

// ── Main sync function ────────────────────────────────────────────────────────

export interface SyncResult {
  processed:     number
  created:       number
  updated:       number
  attached:      number   // forwards / follow-ups filed onto an existing ticket
  skipped:       number
  ignored:       number   // attendance notes, due-lists, outbound mail — logged, no ticket
  review:        number   // unmatched assets parked in the review queue
  queued:        number   // threads with unlogged mail found this run
  more:          boolean  // time budget ran out — call again to continue
  errors:        string[]
}

export interface SyncOptions {
  historical?: boolean    // true = include 2024+ emails (legacy flag; same as after=2024/01/01)
  maxThreads?: number     // cap on messages listed per query
  after?: string          // Gmail date YYYY/MM/DD — backfill window start
  before?: string         // Gmail date YYYY/MM/DD — backfill window end (exclusive)
  skipUnmatched?: boolean // backfill mode: don't review-queue unmatched emails, just log them
  recentDays?: number     // regular mode: also read mail received this many days back, archived or not (default 3)
  budgetMs?: number       // stop starting new threads after this long (default 40s)
  recheckPending?: boolean // backfill: re-try review-queue emails (after new vehicles / name variations were added)
}

type ThreadCtx = {
  skipUnmatched: boolean
  markRead: boolean
  recheckPending?: boolean
}

type ProcessOutcome = 'created' | 'updated' | 'attached' | 'skipped' | 'ignored' | 'review'

export async function syncGmailToTickets(options: SyncOptions): Promise<SyncResult> {
  const admin = createAdminClient()
  // One run at a time — pg_cron, GitHub Actions, the daily summary and the Settings
  // button can all fire close together, and two runs could file the same email twice.
  const { data: gotLock } = await admin.rpc('try_sync_lock', { p_name: 'gmail_maintenance', p_seconds: 120 })
  if (gotLock === false) {
    return { processed: 0, created: 0, updated: 0, attached: 0, skipped: 0, ignored: 0, review: 0,
      queued: 0, more: true, errors: ['skipped: another sync is running'] }
  }
  try {
    return await runSync(admin, options)
  } finally {
    await admin.rpc('release_sync_lock', { p_name: 'gmail_maintenance' }).then(() => {}, () => {})
  }
}

async function runSync(admin: Admin, options: SyncOptions): Promise<SyncResult> {
  const started = Date.now()
  const budget  = options.budgetMs ?? 40_000
  const result: SyncResult = {
    processed: 0, created: 0, updated: 0, attached: 0, skipped: 0, ignored: 0, review: 0,
    queued: 0, more: false, errors: [],
  }

  const backfill = !!(options.after || options.before || options.historical)
  const max = options.maxThreads ?? (backfill ? 2000 : 500)
  let queries: string[]
  if (backfill) {
    const df = [
      `after:${options.after ?? '2024/01/01'}`,
      options.before && `before:${options.before}`,
    ].filter(Boolean).join(' ')
    queries = [`in:all -in:spam -in:trash -in:drafts -in:chats ${df}`]
  } else {
    // The Inbox (open jobs) + everything from the last few days, archived or not —
    // a job emailed and archived between two runs is no longer missed.
    queries = ['in:inbox', `newer_than:${options.recentDays ?? 3}d -in:spam -in:trash -in:drafts -in:chats`]
  }

  // 1) Gather message refs, newest first, deduped
  const refs: { id: string; threadId: string }[] = []
  const seenMsg = new Set<string>()
  for (const q of queries) {
    try {
      for (const r of await listMessageRefs(q, max)) {
        if (!seenMsg.has(r.id)) { seenMsg.add(r.id); refs.push(r) }
      }
    } catch (e: any) {
      result.errors.push(`List failed (${q}): ${e.message}`)
    }
  }

  // 2) Drop messages already logged; keep threads that have something new
  const known = await loggedMessageIds(admin, refs.map(r => r.id))
  const threadOrder: string[] = []
  const pendingThreads = new Set<string>()
  for (const r of [...refs].reverse()) {            // oldest first, so originals land before their forwards
    if (known.has(r.id) || pendingThreads.has(r.threadId)) continue
    pendingThreads.add(r.threadId)
    threadOrder.push(r.threadId)
  }

  // Threads parked in review / dismissed: nothing to do until someone assigns them
  const parked = await parkedThreadIds(admin, threadOrder, !!options.recheckPending)
  const todo = threadOrder.filter(t => !parked.has(t))
  result.queued = todo.length

  const ctx: ThreadCtx = { skipUnmatched: options.skipUnmatched ?? false, markRead: !backfill, recheckPending: !!options.recheckPending }
  for (const threadId of todo) {
    if (Date.now() - started > budget) { result.more = true; break }
    try {
      result.processed++
      const r = await processThread(admin, threadId, ctx)
      result[r === 'created' ? 'created' : r === 'updated' ? 'updated' : r === 'attached' ? 'attached'
        : r === 'review' ? 'review' : r === 'ignored' ? 'ignored' : 'skipped']++
    } catch (e: any) {
      result.errors.push(`Thread ${threadId}: ${e.message}`)
    }
  }

  // 3) Reconcile archived threads: close finished tickets + catch missed "complete" replies
  if (!backfill && Date.now() - started < budget + 5_000) {
    try {
      const inboxThreadIds = new Set(await listThreadIds('in:inbox'))
      await refreshArchivedOpenTickets(admin, inboxThreadIds, result, ctx)
    } catch (e: any) {
      result.errors.push(`Archived refresh failed: ${e.message}`)
    }
  }

  return result
}

/** Which of these Gmail message ids are already logged in gmail_imports. */
async function loggedMessageIds(admin: Admin, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await admin.from('gmail_imports').select('gmail_message_id')
      .in('gmail_message_id', ids.slice(i, i + 150))
    for (const r of data ?? []) out.add(r.gmail_message_id as string)
  }
  return out
}

/** Threads whose only rows are in the review queue or dismissed (no ticket yet). */
async function parkedThreadIds(admin: Admin, threadIds: string[], includePendingAsActive = false): Promise<Set<string>> {
  const conv = new Set<string>(); const other = new Set<string>()
  for (let i = 0; i < threadIds.length; i += 150) {
    const { data } = await admin.from('gmail_imports').select('gmail_thread_id, status, converted_ticket_id')
      .eq('company_id', COMPANY_ID).in('gmail_thread_id', threadIds.slice(i, i + 150))
    for (const r of data ?? []) {
      if (r.converted_ticket_id || (includePendingAsActive && r.status === 'pending')) conv.add(r.gmail_thread_id as string)
      else other.add(r.gmail_thread_id as string)
    }
  }
  return new Set([...other].filter(t => !conv.has(t)))
}

// ── Backfill: attach existing email tickets' photos/files ─────────────────────

export async function backfillAttachments(opts: { max?: number; offset?: number }): Promise<{ scanned: number; attached: number; nextOffset: number; done: boolean }> {
  const admin = createAdminClient()
  const max = opts.max ?? 25
  const offset = opts.offset ?? 0

  const { data: tickets } = await admin
    .from('repair_tickets')
    .select('id, gmail_thread_id')
    .eq('company_id', COMPANY_ID)
    .eq('source', 'gmail')
    .not('gmail_thread_id', 'is', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + max - 1)

  let attached = 0
  const scanned = (tickets ?? []).length
  for (const t of tickets ?? []) {
    try {
      const thread = await getThread(t.gmail_thread_id as string)
      for (const msg of thread.messages ?? []) {
        attached += await syncMessageAttachments(admin, msg.id, msg.payload, t.id)
      }
    } catch { /* skip unreadable thread */ }
  }

  return { scanned, attached, nextOffset: offset + scanned, done: scanned < max }
}

// ── Archived-thread reconciliation ────────────────────────────────────────────
//
// Walks every open Gmail-sourced ticket. A ticket counts as "still in the Inbox"
// if ANY thread filed on it (the original or a forward) is in the Inbox. If none
// is, its replies are picked up first (a "Complete" note closes it with notes),
// and if it is still open it is treated as done: archived = finished.
// (We never archive anything ourselves — archiving is the shop's job.)

async function refreshArchivedOpenTickets(
  admin: Admin,
  inboxThreadIds: Set<string>,
  result: SyncResult,
  ctx: ThreadCtx,
) {
  const { data: openTickets } = await admin
    .from('repair_tickets')
    .select('id, gmail_thread_id, status')
    .eq('company_id', COMPANY_ID)
    .eq('source', 'gmail')
    .not('gmail_thread_id', 'is', null)
    .not('status', 'in', '(closed,completed,deferred)')
  if (!openTickets?.length) return

  // Every thread filed on each open ticket (original + forwards/follow-ups)
  const threadsByTicket = new Map<string, Set<string>>()
  for (const t of openTickets) threadsByTicket.set(t.id, new Set([t.gmail_thread_id as string]))
  const ids = openTickets.map(t => t.id)
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await admin.from('gmail_imports').select('converted_ticket_id, gmail_thread_id')
      .in('converted_ticket_id', ids.slice(i, i + 150))
    for (const r of data ?? []) {
      if (r.gmail_thread_id) threadsByTicket.get(r.converted_ticket_id as string)?.add(r.gmail_thread_id as string)
    }
  }

  for (const t of openTickets) {
    const threads = [...(threadsByTicket.get(t.id) ?? [])]
    if (threads.some(th => inboxThreadIds.has(th))) continue   // still open in the Inbox

    try {
      // 1) Pick up any notes not seen yet (a "Complete" note closes it properly)
      for (const th of threads) await processThread(admin, th, { ...ctx, markRead: false })

      // 2) Still open + every thread archived ⇒ finished
      const { data: tk } = await admin.from('repair_tickets').select('status').eq('id', t.id).single()
      if (tk && !TERMINAL_STATUSES.includes(tk.status)) {
        let lastMsg: any = null; let lastTs = 0
        for (const th of threads) {
          const thread = await getThread(th)
          for (const m of thread.messages ?? []) {
            const ts = Number(m.internalDate ?? 0)
            if (ts >= lastTs) { lastTs = ts; lastMsg = m }
          }
        }
        const note = lastMsg ? ownText(extractBody(lastMsg.payload)).slice(0, 1000) : ''
        const dateStr = new Date(lastTs || Date.now()).toISOString().split('T')[0]
        await admin.from('repair_tickets').update({
          status:           'completed',
          date_completed:   dateStr,
          waiting_on_parts: false,
          completion_notes: note || 'Email archived by the shop — marked complete.',
        }).eq('id', t.id)
        await applyCompletedWork(admin, t.id, { date: dateStr, text: note })
        result.updated++
      }
    } catch (e: any) {
      result.errors.push(`Refresh ${t.gmail_thread_id}: ${e.message}`)
    }
  }
}

// ── Message → ticket status ───────────────────────────────────────────────────

function msgDateOf(msg: any): Date {
  const hdr = getHeader(msg.payload?.headers ?? [], 'Date')
  const d = hdr ? new Date(hdr) : new Date(Number(msg.internalDate ?? Date.now()))
  return isNaN(d.getTime()) ? new Date(Number(msg.internalDate ?? Date.now())) : d
}
const ymd = (d: Date) => d.toISOString().split('T')[0]

/**
 * File one or more email messages onto an existing ticket as notes, applying
 * the shop's status words. Skips messages already logged. Returns true if the
 * ticket's status or flags changed.
 */
async function fileMessagesOnTicket(
  admin: Admin,
  ticketId: string,
  threadId: string,
  subject: string,
  unitNumber: string,
  messages: any[],
  pendingMsgIds: Set<string> = new Set(),
): Promise<boolean> {
  const { data: cur } = await admin.from('repair_tickets').select('status').eq('id', ticketId).single()
  let curStatus: string = cur?.status ?? 'open'
  let changed = false

  for (const msg of messages) {
    const { data: alreadyLogged } = await admin.from('gmail_imports').select('id')
      .eq('gmail_message_id', msg.id).maybeSingle()
    if (alreadyLogged && !pendingMsgIds.has(msg.id)) continue

    const headers = msg.payload?.headers ?? []
    const body    = extractBody(msg.payload)
    const own     = ownText(body)
    const { email } = parseSender(getHeader(headers, 'From'))
    const when    = msgDateOf(msg)
    const intent  = replyIntent(body)
    const status  = detectStatus(body)
    const updates: Record<string, unknown> = {}

    if (intent === 'duplicate') {
      if (!TERMINAL_STATUSES.includes(curStatus)) {
        updates.status = 'closed'
        updates.date_completed = ymd(when)
        updates.completion_notes = 'Duplicate email (per the shop).'
        updates.waiting_on_parts = false
      }
    } else if (intent === 'complete') {
      if (!TERMINAL_STATUSES.includes(curStatus)) {
        updates.status = 'completed'
        updates.date_completed = ymd(when)
        updates.waiting_on_parts = false
        if (own) updates.completion_notes = own.slice(0, 1000)
        const by = await findReporter(admin, email)
        if (by) updates.completed_by = by
      }
    } else if (status.partsReceived) {
      updates.parts_needed = false
      updates.parts_ordered = true
      updates.waiting_on_parts = false
      if (curStatus === 'waiting_parts') updates.status = 'in_progress'
    } else if (status.partsOrdered) {
      updates.parts_needed = false
      updates.parts_ordered = true
      updates.waiting_on_parts = true
      if (OPEN_STATUSES_EARLY.includes(curStatus)) updates.status = 'waiting_parts'
    } else if (status.partsNeeded) {
      updates.parts_needed = true
      updates.waiting_on_parts = true
      if (OPEN_STATUSES_EARLY.includes(curStatus)) updates.status = 'waiting_parts'
    } else if (own && OPEN_STATUSES_EARLY.includes(curStatus)) {
      updates.status = 'in_progress'   // any note means work has started
    }

    if (Object.keys(updates).length) {
      await admin.from('repair_tickets').update(updates).eq('id', ticketId)
      if (typeof updates.status === 'string') curStatus = updates.status
      changed = true
      if (updates.status === 'completed') {
        await applyCompletedWork(admin, ticketId, { date: ymd(when), text: own })
      }
    }

    const authorId = await findReporter(admin, email)
    if (body.trim()) {
      await admin.from('repair_ticket_comments').insert({
        ticket_id:   ticketId,
        author_id:   authorId,
        comment:     `[Via Email] ${(own || body).trim().slice(0, 2000)}`,
        is_internal: false,
        created_at:  when.toISOString(),
      })
    }

    if (pendingMsgIds.has(msg.id)) {
      await admin.from('gmail_imports').update({ status: 'converted', converted_ticket_id: ticketId, detected_asset: unitNumber })
        .eq('gmail_message_id', msg.id)
    } else {
      await admin.from('gmail_imports').insert({
        company_id:          COMPANY_ID,
        gmail_message_id:    msg.id,
        gmail_thread_id:     threadId,
        subject:             getHeader(headers, 'Subject') || `RE: ${subject}`,
        sender:              email,
        received_at:         when.toISOString(),
        body_preview:        body.slice(0, 500),
        status:              'converted',
        converted_ticket_id: ticketId,
        detected_asset:      unitNumber,
      })
    }

    await syncMessageAttachments(admin, msg.id, msg.payload, ticketId)
  }
  return changed
}

// ── Forwards / follow-ups → the ticket they belong to ─────────────────────────

function tokenSim(a: string, b: string): number {
  const A = new Set(a.split(' ').filter(w => w.length > 1)); const B = new Set(b.split(' ').filter(w => w.length > 1))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / Math.min(A.size, B.size)
}

/**
 * A new thread that is really a follow-up on an existing job: the shop forwarded
 * the original with "Update …"/"Complete …" on top, or re-sent the same subject.
 * Returns the ticket to file it on, or null to create a new ticket.
 */
async function findTicketForFollowUp(
  admin: Admin,
  assetId: string,
  unitNumber: string,
  subject: string,
  firstBody: string,
  msgDate: Date,
): Promise<string | null> {
  const isForward = /^\s*(?:(?:re|fwd?|fw)\s*:\s*)*(?:fwd?|fw)\s*:/i.test(subject) || /^\s*(?:re\s*:\s*)/i.test(subject)
  const intent = replyIntent(firstBody)
  const followUpish = isForward || intent === 'update' || intent === 'complete' || intent === 'duplicate'

  const since = new Date(msgDate.getTime() - 60 * 86400_000).toISOString()
  const until = new Date(msgDate.getTime() + 3600_000).toISOString()
  const { data: cands } = await admin.from('repair_tickets')
    .select('id, title, status, created_at, source')
    .eq('company_id', COMPANY_ID).eq('asset_id', assetId)
    .gte('created_at', since).lte('created_at', until)
    .order('created_at', { ascending: false })
  if (!cands?.length) return null

  const core = coreSubject(subject, unitNumber)
  const oil = isOilChangeText(subject); const insp = isStateInspectionText(subject)
  let best: { id: string; score: number } | null = null
  for (const c of cands) {
    const open = !TERMINAL_STATUSES.includes(c.status)
    // A finished job only takes forwards/updates (a fresh report with the same subject is a new job)
    if (!open && !followUpish) continue
    // Auto-tickets ("Oil Change — T20") are closed by the shop's OCD / inspection emails
    if (c.source === 'preventive') {
      if (open && ((oil && /oil change/i.test(c.title)) || (insp && /inspection/i.test(c.title)))) {
        best = { id: c.id, score: 2 }; break
      }
      continue
    }
    const cc = coreSubject(c.title ?? '', unitNumber)
    if (!core || !cc) continue
    let score = 0
    if (core === cc) score = 1.5
    else if (core.length >= 8 && cc.length >= 8 && (core.includes(cc) || cc.includes(core))) score = 1.2
    else score = tokenSim(core, cc)
    if (score >= 0.75 && (!best || score > best.score)) best = { id: c.id, score }
  }
  return best?.id ?? null
}

// ── Per-thread processing ─────────────────────────────────────────────────────

async function processThread(
  admin: Admin,
  threadId: string,
  ctx: ThreadCtx,
): Promise<ProcessOutcome> {

  const { data: rows } = await admin
    .from('gmail_imports')
    .select('id, converted_ticket_id, status, created_at')
    .eq('gmail_thread_id', threadId)
    .eq('company_id', COMPANY_ID)
    .order('created_at')
  const converted = (rows ?? []).find(r => r.converted_ticket_id)

  const thread = await getThread(threadId)
  const messages: any[] = thread.messages ?? []
  if (!messages.length) return 'skipped'
  const isInbox = messages.some(m => (m.labelIds ?? []).includes('INBOX'))

  const firstMsg  = messages[0]
  const headers   = firstMsg.payload?.headers ?? []
  const subject   = getHeader(headers, 'Subject')
  const fromRaw   = getHeader(headers, 'From')
  const msgDate   = msgDateOf(firstMsg)
  const { email: senderEmail } = parseSender(fromRaw)
  let { unitNumber, title } = parseSubject(subject)

  // ── Thread already filed on a ticket — new messages are notes on it ────────
  if (converted?.converted_ticket_id) {
    const { data: tk } = await admin.from('repair_tickets').select('id, asset_id').eq('id', converted.converted_ticket_id).maybeSingle()
    if (!tk) return 'skipped'
    const changed = await fileMessagesOnTicket(admin, tk.id, threadId, subject, unitNumber, messages)
    return changed ? 'updated' : 'skipped'
  }

  // Already in the review queue or dismissed — leave it alone (unless re-checking the queue)
  const pendingRows = (rows ?? []).filter(r => r.status === 'pending')
  const recheck = !!ctx.recheckPending && !!rows?.length && pendingRows.length === rows.length
  if (rows?.length && !recheck) return 'skipped'
  const pendingMsgIds = new Set<string>()
  if (recheck) {
    const { data: pm } = await admin.from('gmail_imports').select('gmail_message_id')
      .eq('gmail_thread_id', threadId).eq('status', 'pending')
    for (const r of pm ?? []) pendingMsgIds.add(r.gmail_message_id as string)
  }

  const body = extractBody(firstMsg.payload)
  const logOnly = async (status: 'rejected' | 'pending', reason: string | null, detected = unitNumber) => {
    if (recheck) {
      // Already queued: only a dismissal changes anything
      if (status === 'rejected') {
        await admin.from('gmail_imports').update({
          status, raw_payload: { title: title || subject, body: body.trim().slice(0, 3000), ...(reason ? { reason } : {}) },
        }).eq('gmail_thread_id', threadId).eq('status', 'pending')
      }
      return
    }
    await admin.from('gmail_imports').insert({
      company_id:       COMPANY_ID,
      gmail_message_id: firstMsg.id,
      gmail_thread_id:  threadId,
      subject,
      sender:           senderEmail,
      received_at:      msgDate.toISOString(),
      body_preview:     body.slice(0, 500),
      status,
      detected_asset:   detected,
      raw_payload:      { title: title || subject, body: body.trim().slice(0, 3000), ...(reason ? { reason } : {}) },
    })
  }

  // ── Not a job: automated Google mail, the shop's own outgoing mail, attendance notes, due-lists ─
  if (isGoogleSender(senderEmail)) { await logOnly('rejected', 'automated'); return 'ignored' }
  if (SHOP_ADDRESSES.includes(senderEmail)) {
    const to = `${getHeader(headers, 'To')} ${getHeader(headers, 'Cc')}`.toLowerCase()
    if (!SHOP_ADDRESSES.some(a => to.includes(a))) { await logOnly('rejected', 'outbound'); return 'ignored' }
  }
  const notJob = nonTicketReason(subject)
  if (notJob) { await logOnly('rejected', notJob); return 'ignored' }

  let assetId = await findOrCreateAsset(admin, unitNumber)

  // If the first word wasn't a real asset, look for the unit elsewhere in the
  // subject ("Breaks sound bad on t20"). Auto-link only on a single confident
  // match; ambiguous multi-asset subjects fall through to the review queue.
  if (!assetId && !isPersonalVehicle(unitNumber)) {
    const found = await findAssetsInSubject(admin, subject, unitNumber)
    if (found.length === 1) {
      unitNumber = found[0].unitNumber
      assetId    = found[0].assetId
      // Unit-number tokens (e.g. "T20") are just IDs — strip them from the title.
      // Alias phrases (e.g. "fiberglass heat wrap") describe the actual problem,
      // so keep the full subject as the title.
      title      = found[0].viaAlias ? subject.trim() : titleWithoutUnit(subject, found[0].matchText)
    }
  }
  title = (title || subject).replace(/^\s*(?:(?:re|fwd?|fw)\s*:\s*)+/i, '').trim() || subject

  // ── Unmatched asset → park in review queue (do NOT create an orphan ticket) ─
  // In backfill mode (skipUnmatched), record it as 'rejected' so it's deduped but
  // stays OUT of the review queue — old history shouldn't flood the queue.
  if (!assetId && !isPersonalVehicle(unitNumber)) {
    await logOnly(ctx.skipUnmatched ? 'rejected' : 'pending', ctx.skipUnmatched ? 'unmatched (backfill)' : null)
    return ctx.skipUnmatched ? 'skipped' : 'review'
  }
  if (!assetId) return 'skipped'

  // ── A forward / follow-up of a job we already have → file it there ─────────
  const followUpOf = await findTicketForFollowUp(admin, assetId, unitNumber, subject, body, msgDate)
  if (followUpOf) {
    await fileMessagesOnTicket(admin, followUpOf, threadId, subject, unitNumber, messages, pendingMsgIds)
    return 'attached'
  }

  // ── New job — create the ticket ────────────────────────────────────────────
  const reporterId = await findReporter(admin, senderEmail)

  // Status from the shop's words. Archived threads are done.
  let finalStatus: string = isInbox ? 'open' : 'completed'
  let partsNeeded = false, partsOrdered = false, partsReceived = false
  let dateCompleted: string | null = null
  let completedBy: string | null = null
  let completionNote: string | null = null
  let duplicate = false

  for (const msg of messages) {
    const b = extractBody(msg.payload)
    const intent = replyIntent(b)
    if (intent === 'complete' || intent === 'duplicate') {
      finalStatus = 'completed'
      duplicate = intent === 'duplicate'
      dateCompleted = ymd(msgDateOf(msg))
      completionNote = ownText(b).slice(0, 1000) || null
      const { email } = parseSender(getHeader(msg.payload?.headers ?? [], 'From'))
      completedBy = (await findReporter(admin, email)) ?? completedBy
    } else if (intent === 'update' && finalStatus === 'completed' && isInbox) {
      finalStatus = 'in_progress'   // an update after a "complete" re-opens the work
      dateCompleted = null
    }
    const s = detectStatus(b)
    if (s.partsNeeded)   partsNeeded   = true
    if (s.partsOrdered)  partsOrdered  = true
    if (s.partsReceived) { partsReceived = true; partsNeeded = false; partsOrdered = partsOrdered }
  }

  const partsPending = (partsNeeded || partsOrdered) && !partsReceived
  if (finalStatus !== 'completed' && partsPending) finalStatus = 'waiting_parts'
  else if (finalStatus !== 'completed' && messages.length > 1) finalStatus = 'in_progress'
  if (duplicate) finalStatus = 'closed'

  // Archived with no "Complete" note: done as of the last message
  if (['completed', 'closed'].includes(finalStatus) && !dateCompleted) {
    dateCompleted = ymd(msgDateOf(messages[messages.length - 1]))
  }

  const ticketNumber = await buildTicketNumber(admin, msgDate, unitNumber)
  const { data: ticket } = await admin.from('repair_tickets').insert({
    company_id:          COMPANY_ID,
    asset_id:            assetId,
    created_by:          reporterId,
    ticket_number:       ticketNumber,
    title:               title,
    description:         body.trim().slice(0, 3000) || null,
    source:              'gmail',
    priority:            'normal',
    status:              finalStatus,
    parts_needed:        partsPending && !partsOrdered,
    parts_ordered:       partsOrdered || partsReceived,
    waiting_on_parts:    finalStatus === 'completed' || finalStatus === 'closed' ? false : partsPending,
    gmail_message_id:    firstMsg.id,
    gmail_thread_id:     threadId,
    date_completed:      dateCompleted,
    completed_by:        completedBy,
    completion_notes:    duplicate ? 'Duplicate email (per the shop).' : completionNote,
    created_at:          msgDate.toISOString(),   // backdate to the email
  }).select('id').single()
  if (!ticket) return 'skipped'

  if (pendingMsgIds.size) {
    await admin.from('gmail_imports').update({ status: 'converted', converted_ticket_id: ticket.id, detected_asset: unitNumber })
      .eq('gmail_thread_id', threadId).eq('status', 'pending')
  }
  if (!pendingMsgIds.has(firstMsg.id)) await admin.from('gmail_imports').insert({
    company_id:          COMPANY_ID,
    gmail_message_id:    firstMsg.id,
    gmail_thread_id:     threadId,
    subject,
    sender:              senderEmail,
    received_at:         msgDate.toISOString(),
    body_preview:        body.slice(0, 500),
    status:              'converted',
    converted_ticket_id: ticket.id,
    detected_asset:      unitNumber,
  })

  // Replies → notes on the ticket (logged so they aren't re-read)
  for (const reply of messages.slice(1)) {
    const rHeaders  = reply.payload?.headers ?? []
    const replyDate = msgDateOf(reply)
    const replyFrom = parseSender(getHeader(rHeaders, 'From'))
    const replyBody = extractBody(reply.payload)
    if (!pendingMsgIds.has(reply.id)) await admin.from('gmail_imports').insert({
      company_id:          COMPANY_ID,
      gmail_message_id:    reply.id,
      gmail_thread_id:     threadId,
      subject:             getHeader(rHeaders, 'Subject') || `RE: ${subject}`,
      sender:              replyFrom.email,
      received_at:         replyDate.toISOString(),
      body_preview:        replyBody.slice(0, 500),
      status:              'converted',
      converted_ticket_id: ticket.id,
      detected_asset:      unitNumber,
    })
    if (replyBody.trim()) {
      const authorId = await findReporter(admin, replyFrom.email)
      await admin.from('repair_ticket_comments').insert({
        ticket_id:   ticket.id,
        author_id:   authorId,
        comment:     `[Via Email] ${(ownText(replyBody) || replyBody).trim().slice(0, 2000)}`,
        is_internal: false,
        created_at:  replyDate.toISOString(),
      })
    }
  }

  for (const msg of messages) {
    await syncMessageAttachments(admin, msg.id, msg.payload, ticket.id)
  }

  if (finalStatus === 'completed') {
    await applyCompletedWork(admin, ticket.id, { date: dateCompleted, text: completionNote })
  }

  // Regular runs mark the new job's first email read (existing behaviour); backfills never touch the mailbox
  if (ctx.markRead && isInbox) { try { await markAsRead(firstMsg.id) } catch {} }

  return 'created'
}
