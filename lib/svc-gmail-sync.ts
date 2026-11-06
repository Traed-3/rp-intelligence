/**
 * Service-dispatch Gmail → svc_work_orders sync engine.
 *
 * Two mailboxes, two passes:
 *  1. rpdispatcher@gmail.com — every "work order dispatched" notice from
 *     7HELP (7-Eleven), WTSC (Wawa), and IT Service Desk (Sunoco) creates or
 *     updates a row in svc_work_orders.
 *  2. rpinvoicing@gmail.com — field techs forward the dispatch email back
 *     here with a one-line COMPLETE / INCOMPLETE / RTN note. We match it to
 *     the work order by WO# and update status + return-trip flag from it.
 *     This is the ONLY source of real completion status — never trust the
 *     dispatch mailbox alone for "is this done."
 *
 * A completion email marked COMPLETE also archives the original dispatch
 * email out of rpdispatcher's inbox (best-effort — a Gmail-side failure
 * never blocks the status update itself). RTN/incomplete emails only update
 * status; nothing gets archived until the job is actually done.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { listMessages, getMessage, archiveThread, archiveMessage, listAttachments, getAttachment } from '@/lib/svc-gmail-client'
import {
  extractBody, getHeader, parseSender,
  parseDispatchEmail, parseCompletionEmail, isTrustedPortalNotice, isOfficeSender, isTicketSender,
} from '@/lib/svc-work-order-parser'
import { CON_DONE_STAGES, woTokens } from '@/lib/svc-construction-link'

export const WORK_ORDER_DOCS_BUCKET = 'svc-work-order-docs'
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024
const MAX_ATTACHMENTS = 6

function safeName(name: string) {
  return name.replace(/[^\w.\-() ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'attachment'
}

/**
 * A tech's completion forward often carries a photo of the paper ticket (or a
 * PDF scan) — download it and file it against the matched work order so it's
 * ready for the human review step (manager-signature check + transcription)
 * before it can become a service ticket. Best-effort: never let a Gmail or
 * storage hiccup block the completion-status update itself.
 */
async function captureWorkOrderDocument(
  admin: ReturnType<typeof createAdminClient>,
  msg: any,
  msgId: string,
  subject: string,
  from: { name: string; email: string },
  receivedAt: Date,
  workOrderId: string | null,
  backfill = false,
): Promise<void> {
  const atts = listAttachments(msg).filter(a => a.size <= MAX_ATTACHMENT_BYTES).slice(0, MAX_ATTACHMENTS)
  if (!atts.length) return

  const stored: { name: string; mime: string; path: string; size: number }[] = []
  for (const a of atts) {
    const bytes = await getAttachment('invoicing', msgId, a.attachmentId)
    const path = `rpinvoicing/${msgId}/${safeName(a.filename)}`
    const { error } = await admin.storage.from(WORK_ORDER_DOCS_BUCKET).upload(path, bytes, { contentType: a.mimeType, upsert: true })
    if (error) throw new Error(`upload ${a.filename}: ${error.message}`)
    stored.push({ name: a.filename, mime: a.mimeType, path, size: bytes.length })
  }
  const primary = stored.find(s => /pdf/i.test(s.mime)) ?? stored.find(s => /^image\//i.test(s.mime)) ?? stored[0]
  const readable = stored.some(s => /pdf|^image\/(jpeg|jpg|png|gif|webp)$/i.test(s.mime) || /\.(pdf|jpe?g|png|gif|webp)$/i.test(s.name))
  // The one-time catch-up files old tickets on their calls but does not queue hundreds of automatic transcripts.
  const extractable = readable && !backfill

  const { error: insertErr } = await admin.from('svc_work_order_documents').insert({
    company_id: COMPANY_ID, work_order_id: workOrderId,
    gmail_message_id: msgId, gmail_thread_id: msg.threadId,
    sender: from.name || from.email, sender_email: from.email, subject, received_at: receivedAt.toISOString(),
    attachments: stored, primary_path: primary?.path ?? null,
    extract_status: extractable ? 'pending' : 'skipped',
    extract_error: extractable ? null
      : readable ? 'Filed by the Nov 2026 catch-up import — not transcribed automatically. Open the attachment to read it.'
      : 'Attachment type not readable automatically — type up the ticket by hand.',
    // svc_work_order_documents.status is the document-review state (new / needs_review / ready /
    // linked / dismissed), not the work-order status. 'dispatched' violated its CHECK constraint and
    // every insert since 9/22 failed silently, so check the error instead of discarding it.
    status: 'new',
  })
  if (insertErr) throw new Error(`svc_work_order_documents insert: ${insertErr.message}`)
}

// Single-company deployment today (same constant used by the fleet gmail-sync) —
// every write is scoped to it so app-level company_id filtering (see app/(app)/service/*)
// actually has something to match against instead of silently returning nothing.
const COMPANY_ID = 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'

export interface SvcSyncResult {
  dispatcher: { processed: number; created: number; updated: number; skipped: number; listed: number; remaining: number; errors: string[] }
  invoicing:  { processed: number; matched: number; noMatch: number; skipped: number; listed: number; remaining: number; unknownSenders: string[]; errors: string[] }
}

export interface SvcPassOptions {
  /** Most messages to read (fetch + process) in this run. */
  max?: number
  /** Window to list, in days counted back from now. */
  sinceDays?: number
  untilDays?: number
  /** Extra Gmail search terms ANDed onto the window (e.g. a catch-up slice that only wants closure notices). */
  query?: string
  /** false = leave the mailboxes exactly as they are (no archiving). The one-time catch-up runs this way. */
  archive?: boolean
  /** One-time catch-up: file ticket attachments on the call without queueing an automatic transcript. */
  backfill?: boolean
}

/** Never list more than this many ids per run — a week of rpdispatcher or two of rpinvoicing is well under it. */
const LIST_CAP = 4000
/** Vercel gives the route 60 s; stop starting new messages at 45 s and let the next run carry on. */
const RUN_BUDGET_MS = 45_000

/** Short-lived link to a work order document's attachment in the private bucket. */
export async function signedWorkOrderDocUrl(path: string, seconds = 600): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin.storage.from(WORK_ORDER_DOCS_BUCKET).createSignedUrl(path, seconds)
  return data?.signedUrl ?? null
}

async function alreadyLogged(admin: ReturnType<typeof createAdminClient>, mailbox: string, messageId: string): Promise<boolean> {
  const { data } = await admin
    .from('svc_gmail_imports')
    .select('id')
    .eq('mailbox', mailbox)
    .eq('gmail_message_id', messageId)
    .maybeSingle()
  return !!data
}

/** The ids svc_gmail_imports has not logged yet for this mailbox (one query per 200 ids). */
async function unloggedIds(admin: ReturnType<typeof createAdminClient>, mailbox: string, ids: string[]): Promise<string[]> {
  const seen = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin
      .from('svc_gmail_imports')
      .select('gmail_message_id')
      .eq('mailbox', mailbox)
      .in('gmail_message_id', ids.slice(i, i + 200))
    if (error) throw new Error(`svc_gmail_imports lookup: ${error.message}`)
    for (const r of data ?? []) seen.add(r.gmail_message_id)
  }
  return ids.filter(id => !seen.has(id))
}

/** Is there a logged rpdispatcher billing notice for this WO# of the given kind, newer than `after`? */
async function laterBillingNotice(admin: ReturnType<typeof createAdminClient>, woNumber: string, kind: 'approved' | 'rejected', after: Date): Promise<boolean> {
  let q = admin.from('svc_gmail_imports').select('id').eq('mailbox', 'rpdispatcher')
    .eq('parsed->>woNumber', woNumber).gt('received_at', after.toISOString()).limit(1)
  q = kind === 'approved' ? q.ilike('subject', '%invoice approved%') : q.eq('parsed->>isInvoiceRejection', 'true')
  const { data } = await q
  return !!data?.length
}

/** A finished/closed call: clear its dispatch email (and the notice that closed it) out of rpdispatcher. Best-effort. */
async function archiveDispatchEmails(
  wo: { dispatch_gmail_message_id: string | null; dispatch_gmail_thread_id: string | null },
  noticeMsgId: string | null,
  result: { errors: string[] },
) {
  try {
    if (wo.dispatch_gmail_thread_id) await archiveThread('dispatcher', wo.dispatch_gmail_thread_id)
    else if (wo.dispatch_gmail_message_id) await archiveMessage('dispatcher', wo.dispatch_gmail_message_id)
    if (noticeMsgId) await archiveMessage('dispatcher', noticeMsgId)
  } catch (e: any) {
    result.errors.push(`Archive rpdispatcher email: ${e.message}`)
  }
}

// ── Pass 1: rpdispatcher → create/update work orders ───────────────────────

export async function syncDispatcher(opts: SvcPassOptions = {}): Promise<SvcSyncResult['dispatcher']> {
  const admin = createAdminClient()
  const result = { processed: 0, created: 0, updated: 0, skipped: 0, listed: 0, remaining: 0, errors: [] as string[] }
  const max = opts.max ?? 50
  const archive = opts.archive !== false

  // ALL mail in the window, not just the Inbox. Nearly every 7-Eleven dispatch is filed under the FM label —
  // and so are the Invoice Approved / redirected / Terminated notices — before a run comes round, so reading
  // `in:inbox` (newest 50) missed about a third of the calls (audit 2026-11-05). List the whole window, drop
  // what is already logged, and work oldest first.
  let msgIds: string[]
  try {
    const listed = await listMessages('dispatcher', recentWindowQuery(opts.sinceDays ?? 7, opts.untilDays, `-in:sent -in:drafts ${opts.query ?? ''}`), LIST_CAP)
    result.listed = listed.length
    // Gmail lists newest first. Replaying that order let a later "Messages"/reply create the call
    // before its real dispatch was read, and let a later notice be overwritten by an earlier one.
    msgIds = (await unloggedIds(admin, 'rpdispatcher', listed)).reverse()
  } catch (e: any) {
    result.errors.push(`List failed: ${e.message}`)
    return result
  }
  result.remaining = msgIds.length
  const deadline = Date.now() + RUN_BUDGET_MS

  for (const msgId of msgIds) {
    if (result.processed >= max || Date.now() > deadline) break
    try {
      if (await alreadyLogged(admin, 'rpdispatcher', msgId)) { result.remaining--; continue }
      result.processed++

      const msg = await getMessage('dispatcher', msgId)
      const headers = msg.payload?.headers ?? []
      const subject = getHeader(headers, 'Subject')
      const fromRaw = getHeader(headers, 'From')
      const dateStr = getHeader(headers, 'Date')
      const receivedAt = dateStr ? new Date(dateStr) : new Date()
      const { name: senderName, email: senderEmail } = parseSender(fromRaw)
      const body = extractBody(msg.payload)

      const parsed = parseDispatchEmail(subject, body, senderName)

      let matchedWorkOrderId: string | null = null
      let importStatus = 'ignored'

      // Approval / redirect / termination notices close calls, so a forged one must never act.
      const untrustedClosure = (parsed.isInvoiceApproved || parsed.isRedirected || parsed.isTerminated)
        && !isTrustedPortalNotice(senderEmail, getHeader(headers, 'Authentication-Results'))

      if (!parsed.woNumber) {
        importStatus = 'no_match'
      } else if (untrustedClosure) {
        importStatus = 'ignored'
      } else if (parsed.isInvoiceApproved) {
        // The customer approved our invoice: the job is done and billed. This used to fall through
        // to "create a work order" and put a brand-new "dispatched" call on the board for finished work.
        const { data: woRows } = await admin
          .from('svc_work_orders')
          .select('id, status, completed_at, notes, last_update_at, dispatch_gmail_message_id, dispatch_gmail_thread_id')
          .eq('portal_wo_number', parsed.woNumber)
          .order('dispatched_at', { ascending: false })
        const wo = woRows?.[0] ?? null
        if (wo) {
          const patch: Record<string, unknown> = {
            invoiced: true,
            last_update_at: [wo.last_update_at, receivedAt.toISOString()].filter(Boolean).sort().pop(),
          }
          if (parsed.invoiceNumber) patch.invoice_number = parsed.invoiceNumber
          // An approval clears an earlier rejection (re-billed and accepted), but not one that came after it.
          if (!(await laterBillingNotice(admin, parsed.woNumber, 'rejected', receivedAt))) {
            patch.invoice_rejected = false
            patch.invoice_rejection_reason = null
          }
          // A call still waiting on a return trip stays on Return Trip: the customer paying the first visit does
          // not prove the return happened. The office (or the tech's next ticket) closes it.
          const waitingOnReturn = wo.status === 'rtn_needed'
          const wasOpen = wo.status !== 'completed' && !waitingOnReturn
          const stamp = `[auto ${receivedAt.toISOString().slice(0, 10)}]`
          if (wasOpen) {
            patch.status = 'completed'
            patch.completed_at = wo.completed_at ?? receivedAt.toISOString()
            patch.return_trip_needed = false
            patch.notes = [wo.notes, `${stamp} Completed — invoice ${parsed.invoiceNumber ?? ''} approved by the customer.`].filter(Boolean).join('\n')
          } else if (waitingOnReturn) {
            patch.notes = [wo.notes, `${stamp} Invoice ${parsed.invoiceNumber ?? ''} approved by the customer while a return trip is still marked needed — left on Return Trip for the office to confirm.`].filter(Boolean).join('\n')
          }
          await admin.from('svc_work_orders').update(patch).eq('id', wo.id)
          if (wasOpen && archive) await archiveDispatchEmails(wo, msgId, result)
          matchedWorkOrderId = wo.id
          importStatus = 'updated_wo'
          result.updated++
        } else {
          importStatus = 'no_match'   // never create a call from an approval
        }
      } else if (parsed.isInvoiceRejection) {
        const { data: woRows } = await admin
          .from('svc_work_orders')
          .select('id')
          .eq('portal_wo_number', parsed.woNumber)
          .order('dispatched_at', { ascending: false })
        const wo = woRows?.[0] ?? null
        if (wo) {
          // An older rejection read late (catch-up) must not override an approval that came after it.
          const superseded = await laterBillingNotice(admin, parsed.woNumber, 'approved', receivedAt)
          await admin.from('svc_work_orders').update(superseded ? { last_update_at: receivedAt.toISOString() } : {
            invoice_rejected: true,
            invoice_rejection_reason: parsed.invoiceRejectionReason,
            last_update_at: receivedAt.toISOString(),
          }).eq('id', wo.id)
          matchedWorkOrderId = wo.id
          importStatus = 'updated_wo'
          result.updated++
        } else {
          importStatus = 'no_match'
        }
      } else if (parsed.isAssignmentOnly) {
        importStatus = 'ignored'
      } else {
        // WO# alone is the identity of a call — NOT source_portal too. A later
        // message about the same job (a priority-change notice, a reply, a
        // forward with an unrecognized sender) can get detected as a different
        // source_portal than the original dispatch, and matching on both used
        // to silently spawn a second, detail-blank row for the same real job.
        // That's exactly how completion/RTN notes ended up "attached" to an
        // invisible duplicate instead of the call, ordered so the process below
        // safely tolerates leftover duplicates from before this fix.
        const { data: existingRows } = await admin
          .from('svc_work_orders')
          .select('id, source_portal')
          .eq('portal_wo_number', parsed.woNumber)
          .order('dispatched_at', { ascending: false })
        const existing = existingRows?.[0] ?? null

        const closedAs = parsed.isCancellation ? 'Cancelled by the portal'
          : parsed.isRedirected ? 'Redirected to another service provider'
          : parsed.isTerminated ? 'Terminated by the customer' : null
        if (closedAs) {
          // The call left our hands. Close the work order if we have it, and never create one
          // from a closure notice — doing so used to put a brand new "dispatched" row on the
          // board for a job nobody will ever run.
          if (existing) {
            const { data: full } = await admin.from('svc_work_orders')
              .select('dispatch_gmail_message_id, dispatch_gmail_thread_id').eq('id', existing.id).single()
            await admin.from('svc_work_orders').update({
              archived: true,
              archived_at: new Date().toISOString(),
              archived_reason: `${closedAs} — "${subject.trim().slice(0, 180)}" (${receivedAt.toISOString().slice(0, 10)}).`,
              last_update_at: receivedAt.toISOString(),
            }).eq('id', existing.id).eq('archived', false)
            if (full && archive) await archiveDispatchEmails(full, msgId, result)
            matchedWorkOrderId = existing.id
            result.updated++
          } else {
            importStatus = 'no_match'
          }
          if (existing) importStatus = 'skipped'
        } else if (existing) {
          matchedWorkOrderId = existing.id
          importStatus = 'skipped'
          // An answering-service "Messages" email that merely mentions the WO# used to
          // win the race and create a detail-blank 'unknown' row; the real portal
          // dispatch then hit this branch and was skipped, so the call never got its
          // site/address/priority. Let the real dispatch fill that row in.
          if (existing.source_portal === 'unknown' && parsed.sourcePortal !== 'unknown') {
            await admin.from('svc_work_orders').update({
              source_portal:      parsed.sourcePortal,
              client_name:        parsed.clientName,
              incident_number:    parsed.incidentNumber,
              site_number:        parsed.siteNumber,
              site_name:          parsed.siteName,
              site_address:       parsed.siteAddress,
              site_city:          parsed.siteCity,
              site_state:         parsed.siteState,
              priority_raw:       parsed.priorityRaw,
              priority_rank:      parsed.priorityRank,
              subject_raw:        subject,
              dispatch_gmail_message_id: msgId,
              dispatch_gmail_thread_id: msg.threadId,
              raw_dispatch_payload: parsed,
            }).eq('id', existing.id)
            importStatus = 'updated_wo'
            result.updated++
          } else {
            result.skipped++
          }
        } else if (parsed.sourcePortal === 'unknown') {
          // Not from a recognized portal (answering-service transcript, a forward from
          // a person): it can mention a WO# but it is not a dispatch. Creating a row
          // from it blocks the real dispatch that follows — leave it logged only.
          importStatus = 'ignored'
        } else {
          const slaDueAt = parsed.priorityRank === 1
            ? new Date(receivedAt.getTime() + 4 * 60 * 60 * 1000).toISOString()
            : null

          const { data: inserted } = await admin.from('svc_work_orders').insert({
            company_id:         COMPANY_ID,
            source_portal:      parsed.sourcePortal,
            client_name:        parsed.clientName,
            portal_wo_number:   parsed.woNumber,
            incident_number:    parsed.incidentNumber,
            site_number:        parsed.siteNumber,
            site_name:          parsed.siteName,
            site_address:       parsed.siteAddress,
            site_city:          parsed.siteCity,
            site_state:         parsed.siteState,
            priority_raw:       parsed.priorityRaw,
            priority_rank:      parsed.priorityRank,
            subject_raw:        subject,
            status:             'dispatched',
            dispatched_at:      receivedAt.toISOString(),
            last_update_at:     receivedAt.toISOString(),
            sla_due_at:         slaDueAt,
            dispatch_gmail_message_id: msgId,
            raw_dispatch_payload: parsed,
          }).select('id').single()

          matchedWorkOrderId = inserted?.id ?? null
          importStatus = inserted ? 'created_wo' : 'no_match'
          if (inserted) result.created++
        }
      }

      await admin.from('svc_gmail_imports').insert({
        company_id:         COMPANY_ID,
        mailbox:            'rpdispatcher',
        gmail_message_id:   msgId,
        sender:             senderEmail,
        subject,
        received_at:        receivedAt.toISOString(),
        parsed,
        status:             importStatus,
        matched_work_order_id: matchedWorkOrderId,
      })
      result.remaining--

    } catch (e: any) {
      result.errors.push(`Message ${msgId}: ${e.message}`)
    }
  }

  return result
}

// ── Pass 2: rpinvoicing → update completion status ──────────────────────────

// The office reviews and archives every rpinvoicing message almost immediately
// (the "reviewed" label), so its Inbox is essentially always empty — searching
// in:inbox here would silently process nothing. Search all mail instead.
// Scoped to a recent window for now (this mailbox has 120k+ messages of
// history); a wider one-time historical backfill is a separate, deliberate step.
function ymd(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

/** `untilDays` (also counted back from now) lets a manual catch-up run walk
 * a big historical range in dated slices instead of one huge query — the
 * whole point being to stay well inside the 60s function budget. */
function recentWindowQuery(sinceDays: number, untilDays?: number, extra = ''): string {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
  let q = `-in:spam -in:trash after:${ymd(since)}`
  if (extra.trim()) q += ` ${extra.trim()}`
  if (untilDays != null) {
    const until = new Date(Date.now() - untilDays * 24 * 60 * 60 * 1000)
    q += ` before:${ymd(until)}`
  }
  return q
}

export async function syncInvoicing(opts: SvcPassOptions = {}): Promise<SvcSyncResult['invoicing']> {
  const admin = createAdminClient()
  const result = { processed: 0, matched: 0, noMatch: 0, skipped: 0, listed: 0, remaining: 0, unknownSenders: [] as string[], errors: [] as string[] }
  const max = opts.max ?? 50
  const archive = opts.archive !== false && !opts.backfill

  // The whole window, minus what is already logged — listing only the newest 50 dropped tickets on busy days
  // (audit 2026-11-05: 20 calls had tickets the app never read).
  let msgIds: string[]
  try {
    const listed = await listMessages('invoicing', recentWindowQuery(opts.sinceDays ?? 14, opts.untilDays, opts.query ?? ''), LIST_CAP)
    result.listed = listed.length
    // Oldest first, so a later "Complete" is applied after an earlier "RTN" (newest-first order let the
    // older note win and re-open a finished call).
    msgIds = (await unloggedIds(admin, 'rpinvoicing', listed)).reverse()
  } catch (e: any) {
    result.errors.push(`List failed: ${e.message}`)
    return result
  }
  result.remaining = msgIds.length

  // Stop starting new messages at 45 s and let the next run pick up the rest (unlogged messages are
  // re-listed), instead of timing out with a 504 and failing the whole svc-sync job.
  const deadline = Date.now() + RUN_BUDGET_MS
  const unknown = new Set<string>()

  for (const msgId of msgIds) {
    if (result.processed >= max || Date.now() > deadline) break
    try {
      if (await alreadyLogged(admin, 'rpinvoicing', msgId)) { result.remaining--; continue }
      result.processed++

      const msg = await getMessage('invoicing', msgId)
      const headers = msg.payload?.headers ?? []
      const subject = getHeader(headers, 'Subject')
      const fromRaw = getHeader(headers, 'From')
      const dateStr = getHeader(headers, 'Date')
      const receivedAt = dateStr ? new Date(dateStr) : new Date()
      const { name: techName, email: techEmail } = parseSender(fromRaw)
      const body = extractBody(msg.payload)

      const parsed = parseCompletionEmail(subject, body)

      let matchedWorkOrderId: string | null = null
      let importStatus = 'no_match'

      if (parsed.woNumber) {
        const { data: candidates } = await admin
          .from('svc_work_orders')
          .select('id, source_portal, status, completed_at, assigned_technician_id, dispatched_at, dispatch_gmail_message_id, dispatch_gmail_thread_id')
          .eq('portal_wo_number', parsed.woNumber)
          .order('dispatched_at', { ascending: false })

        // Defense-in-depth against the duplicate-row bug fixed in 47409f7: if
        // a phantom 'unknown'-portal twin ever slips back in, a completion
        // note should still land on the real dispatch row rather than
        // whichever twin happens to be newer.
        const wo = candidates?.find(c => c.source_portal !== 'unknown') ?? candidates?.[0]
        // A note older than the call's completion (picked up late, or listed out of order) must not reopen it.
        const staleNote = !!wo && wo.status === 'completed' && !!wo.completed_at && receivedAt < new Date(wo.completed_at)
        if (wo && staleNote) {
          matchedWorkOrderId = wo.id
          importStatus = 'matched'
          result.matched++
        } else if (wo) {
          const { data: tech } = await admin
            .from('svc_technicians')
            .select('id, role')
            .ilike('personal_email', techEmail)
            .maybeSingle()

          const updates: Record<string, unknown> = {
            last_update_at: receivedAt.toISOString(),
            completion_note_raw: parsed.note || null,
            completion_gmail_message_id: msgId,
          }
          // The tech who sent the ticket is the call's technician; a manager forwarding someone else's ticket
          // must not take it over (they only fill an empty slot).
          if (tech && (tech.role === 'service_tech' || !wo.assigned_technician_id)) updates.assigned_technician_id = tech.id
          // An RPS address sending tickets that is not on the service roster: say so instead of quietly leaving the call unassigned.
          if (!tech && isTicketSender(techEmail)) unknown.add(techEmail.toLowerCase())

          // Standing rule (Trae, 2026-10-12): a ticket for the call that does not say RTN / return trip needed
          // means the call is COMPLETE — "Incomplete", a blank forward and a bare "Sent from my iPhone" included.
          // Only staff tickets count (not vendors/customers), and the office's own re-forward only completes a
          // call nothing else has spoken for.
          const fromTech = isTicketSender(techEmail)
          const fromOffice = isOfficeSender(techEmail)
          const outcome: 'rtn' | 'complete' | null =
            fromTech ? (parsed.status === 'rtn' ? 'rtn' : 'complete')
            : fromOffice && wo.status === 'dispatched' ? 'complete'
            : null

          // A construction job still under way owns the call's status: a routine ticket does not finish it.
          let jobStillOpen = false
          if (outcome === 'complete') {
            const { data: jobs } = await admin.from('con_jobs').select('stage, work_order_number').eq('company_id', COMPANY_ID).ilike('work_order_number', `%${parsed.woNumber}%`)
            const mine = (jobs ?? []).filter(j => woTokens(j.work_order_number).includes(parsed.woNumber!.toUpperCase()))
            jobStillOpen = mine.length > 0 && !mine.some(j => (CON_DONE_STAGES as readonly string[]).includes(j.stage))
          }

          if (outcome === 'complete' && !jobStillOpen) {
            updates.status = 'completed'
            updates.completed_at = receivedAt.toISOString()
            updates.return_trip_needed = false

            // Clean up rpdispatcher now that the job is actually done — prefer
            // archiving the whole thread (a dispatch is often split across more
            // than one message, e.g. "assigned" + "dispatched"). Best-effort:
            // never let a Gmail hiccup (expired token, already gone) block the
            // completion status itself from being recorded.
            try {
              if (!archive) { /* catch-up run: leave the mailbox alone */ }
              else if (wo.dispatch_gmail_thread_id) {
                await archiveThread('dispatcher', wo.dispatch_gmail_thread_id)
              } else if (wo.dispatch_gmail_message_id) {
                await archiveMessage('dispatcher', wo.dispatch_gmail_message_id)
              }
            } catch (archiveErr: any) {
              result.errors.push(`Archive rpdispatcher for ${parsed.woNumber}: ${archiveErr.message}`)
            }
          } else if (outcome === 'rtn') {
            updates.status = 'rtn_needed'
            updates.return_trip_needed = true
            updates.return_trip_reason = parsed.note || null
          }
          // Any other sender (vendor, customer, admin): still log the note + touch last_update_at, leave status alone

          await admin.from('svc_work_orders').update(updates).eq('id', wo.id)
          matchedWorkOrderId = wo.id
          importStatus = 'matched'
          result.matched++
        } else {
          result.noMatch++
        }
      } else {
        result.noMatch++
      }

      try {
        await captureWorkOrderDocument(admin, msg, msgId, subject, { name: techName, email: techEmail }, receivedAt, matchedWorkOrderId, !!opts.backfill)
      } catch (docErr: any) {
        result.errors.push(`Document capture for ${msgId}: ${docErr.message}`)
      }

      await admin.from('svc_gmail_imports').insert({
        company_id:         COMPANY_ID,
        mailbox:            'rpinvoicing',
        gmail_message_id:   msgId,
        sender:              techEmail,
        subject,
        received_at:        receivedAt.toISOString(),
        parsed,
        status:             importStatus,
        matched_work_order_id: matchedWorkOrderId,
      })
      result.remaining--

    } catch (e: any) {
      result.errors.push(`Message ${msgId}: ${e.message}`)
    }
  }

  result.unknownSenders = Array.from(unknown)
  return result
}

// ── Maintenance: archive stale work orders ──────────────────────────────────

export interface SvcArchiveStaleResult {
  days: number
  dryRun: boolean
  candidates: number
  archived: number
  skippedHasInvoicingMail: number
  gmailFailures: number
  details: { woNumber: string; action: string }[]
}

/**
 * A work order that's old, has never had ANY message land in rpinvoicing
 * (not even an unmatched one — checked live against the mailbox, not just
 * svc_gmail_imports, since the rolling sync window can miss one), and hasn't
 * been touched in the system either is dead: nobody is ever going to report
 * back on it. Archive it (and its source rpdispatcher email) the same way
 * the dashboard's own archive button does.
 *
 * Deliberately conservative: ANY rpinvoicing hit for the WO# — even a stray
 * forward that never classified as complete/RTN — excludes it. A human
 * should look at those, not this sweep.
 */
export async function archiveStaleWorkOrders(days = 60, dryRun = true, archivedBy: string | null = null): Promise<SvcArchiveStaleResult> {
  const admin = createAdminClient()
  const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const { data: candidates } = await admin
    .from('svc_work_orders')
    .select('id, portal_wo_number, dispatch_gmail_message_id, dispatch_gmail_thread_id')
    .eq('company_id', COMPANY_ID)
    .eq('archived', false)
    .lt('dispatched_at', cutoffIso)
    .lt('last_update_at', cutoffIso)
    .not('portal_wo_number', 'is', null)
    .order('dispatched_at')

  const result: SvcArchiveStaleResult = {
    days, dryRun, candidates: candidates?.length ?? 0,
    archived: 0, skippedHasInvoicingMail: 0, gmailFailures: 0, details: [],
  }

  for (const w of candidates ?? []) {
    const woNumber = w.portal_wo_number!

    let hasMail = false
    try {
      const ids = await listMessages('invoicing', `subject:${woNumber}`, 3)
      hasMail = ids.length > 0
    } catch (e: any) {
      result.details.push({ woNumber, action: `error: rpinvoicing lookup failed — ${e.message}` })
      continue
    }

    if (hasMail) {
      result.skippedHasInvoicingMail++
      result.details.push({ woNumber, action: 'skipped — has rpinvoicing mail' })
      continue
    }

    if (dryRun) {
      result.archived++
      result.details.push({ woNumber, action: 'would archive' })
      continue
    }

    try {
      if (w.dispatch_gmail_thread_id) await archiveThread('dispatcher', w.dispatch_gmail_thread_id)
      else if (w.dispatch_gmail_message_id) await archiveMessage('dispatcher', w.dispatch_gmail_message_id)
    } catch (e: any) {
      result.gmailFailures++
    }

    await admin.from('svc_work_orders').update({
      archived: true,
      archived_at: new Date().toISOString(),
      archived_reason: `Old — cleanup: ${days}+ days old, no completion ever received in rpinvoicing, no update in ${days}+ days.`,
      archived_by: archivedBy,
    }).eq('id', w.id)

    result.archived++
    result.details.push({ woNumber, action: 'archived' })
  }

  return result
}

