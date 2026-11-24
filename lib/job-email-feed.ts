/**
 * Job email feed — keeps each construction job current from the mail that already flows through the RPS inboxes.
 * Runs as `pass=updates` on the inbox-sync route (every 15 minutes with the Gmail sync).
 *
 *   1. Tech updates  (econstruction, "38646 update hydrx stage 1" from a *.rp@gmail.com tech, photos attached)
 *        → con_daily_updates row on the job (work_date, description) + the photos as con_documents.
 *   2. Field tickets (rpinvoicing, handwritten ticket photo with "(x<crew>)" in the subject)
 *        → the existing backfillFieldTicketsForJob() pairs them with the typed update and files a needs_review draft.
 *   3. Invoice workups (Peggy → econstruction, "40043 Invoice Wire Pull" + the .xlsx, Starsky and Star reply in-thread)
 *        → the workbook lands on the job under Invoices, the job moves to Need Invoiced, and Star's
 *          "Received. Will move to IRTS with tickets" reply moves it to Complete (Trae 9/30/26: that loop = finished and invoiced).
 *
 * Every step is idempotent: updates dedupe on the Gmail message id (and on day + subject for Starsky's re-forwards),
 * invoices dedupe on the inbox document's storage path, tickets dedupe inside the backfill.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { listMessages, getMessage, getThread, getAttachment, listAttachments, header, parseAddress, extractText, connectedInboxes } from '@/lib/billing-gmail-client'
import { stripQuoted, INBOX_BUCKET, type ThreadReply } from '@/lib/billing-inbox-sync'
import { backfillFieldTicketsForJob } from '@/lib/field-ticket-gmail-match'

const DOCS_BUCKET = 'construction-docs'
const MAX_PHOTO_BYTES = 12 * 1024 * 1024
const MAX_PHOTOS_PER_UPDATE = 6
const MAX_UPDATES_PER_PASS = 4
/** Vercel gives the route 60 s; each pass stops starting new work after this many ms and finishes on the next tick. */
const PASS_BUDGET_MS = 40_000
const MAX_TICKET_JOBS_PER_PASS = 3
const PHOTO_MIME = /^image\/(jpeg|jpg|png|heic|heif|webp)$/i
const PHOTO_EXT = /\.(jpe?g|png|heic|heif|webp)$/i
const RPS_TECH = /@rappahannockpetroleum\.com$|\.rp@gmail\.com$|^econstruction\.rp@gmail\.com$/i
const NOISE_SUBJECT = /action required|work order|status updates|shared folders|returns spreadsheet|packing slip|invoice/i

type Budget = { deadline: number }
const over = (b?: Budget) => !!b && Date.now() > b.deadline

export type FeedResult = {
  updates: { filed: number; skipped: number; unmatched: string[]; errors: string[]; budget_hit?: boolean }
  tickets: { jobs: number; filed: number; errors: string[]; budget_hit?: boolean }
  invoices: { filed: number; completed: number; unmatched: string[]; errors: string[]; budget_hit?: boolean }
  orders: { sent: number; po: number; replied: number; errors: string[]; budget_hit?: boolean }
}

type Job = { id: string; company_id: string; site_number: string | null; work_order_number: string | null; stage: string; status_detail: string | null; updated_at: string | null }

/** "Re: Fwd: SU-9901 update MUL boots" -> ["SU-9901"]; "45967/58802 Invoice Wire Pull" -> ["45967","58802"]; "Wawa 8659 Update" -> ["Wawa 8659","8659"]. */
export function siteKeysFromSubject(subject: string): string[] {
  // Techs sometimes lead with the word: "Update SU 9901", "UPDATE 32361".
  const head = subject.replace(/^\s*(?:(?:re|fwd?)\s*:\s*)+/i, '').replace(/^update\s*[:\-]?\s+(?=\S)/i, '').trim()
  let m = head.match(/^((?:SU|IP|CP|CPG|F)\s*-?\s*\d{3,5})\b/i)
  if (m) { const p = m[1].toUpperCase().replace(/\s+/g, ''); return [p.startsWith('IP') ? p.replace('-', '') : p.replace(/^(SU|CP|CPG|F)-?/, '$1-')] }
  m = head.match(/^((?:Wawa|Global|Sheetz|Sunoco|Royal Farms|Handy Mart)\s*#?\s*(\d{2,5}))\b/i)
  if (m) return [m[1].replace(/\s+/g, ' '), m[2]]
  m = head.match(/^(\d{4,5}(?:\s*\/\s*\d{4,5})*)\b/)
  if (m) return m[1].split('/').map(s => s.trim())
  return []
}

/** The open job for a site; a completed one only when `allowComplete` (an invoice can trail completion). */
export async function findJobForKeys(admin: ReturnType<typeof createAdminClient>, keys: string[], allowComplete = false): Promise<Job | null> {
  if (!keys.length) return null
  const ors = keys.flatMap(k => [`site_number.ilike.${k}`, `site_number.ilike.${k} (%`, `site_number.ilike.% ${k}`, `site_number.ilike.${k}/%`, `site_number.ilike.%/${k}`]).join(',')
  const { data } = await admin.from('con_jobs').select('id, company_id, site_number, work_order_number, stage, status_detail, updated_at').or(ors).order('updated_at', { ascending: false }).limit(20)
  const rows = (data ?? []) as Job[]
  const rank = (j: Job) => ['in_progress', 'scheduled', 'return_needed', 'needs_scheduled', 'on_hold', 'material_ordering', 'close_out', 'invoicing', 'permitting', 'quoting', 'survey', 'overspill_program'].indexOf(j.stage)
  const open = rows.filter(j => j.stage !== 'complete').sort((a, b) => (rank(a) === -1 ? 99 : rank(a)) - (rank(b) === -1 ? 99 : rank(b)))
  if (open.length) return open[0]
  return allowComplete ? rows[0] ?? null : null
}

function ymdET(internalDate?: string): string {
  const d = internalDate ? new Date(Number(internalDate)) : new Date()
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
const safeName = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
const subjectKey = (s: string) => s.replace(/^\s*(?:(?:re|fwd?)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim().toLowerCase()

/** 1. Typed tech updates → con_daily_updates + photos. */
export async function syncTechUpdates(opts: { sinceDays?: number; budget?: Budget } = {}): Promise<FeedResult['updates']> {
  const out: FeedResult['updates'] = { filed: 0, skipped: 0, unmatched: [], errors: [] }
  if (!connectedInboxes().includes('econstruction')) { out.errors.push('econstruction not connected'); return out }
  const admin = createAdminClient()
  const days = opts.sinceDays ?? 3
  let ids: string[]
  try { ids = await listMessages('econstruction', `newer_than:${days}d subject:update -subject:"Action Required" -subject:"Work Order" -subject:"Status Updates" -from:no-reply`, 40) }
  catch (e) { out.errors.push(`list: ${(e as Error).message}`); return out }
  let filedThisPass = 0
  for (const id of ids) {
    if (filedThisPass >= MAX_UPDATES_PER_PASS) break
    if (over(opts.budget)) { out.budget_hit = true; break }
    try {
      const { data: dup } = await admin.from('con_daily_updates').select('id').contains('source_refs', { update_message_id: id }).maybeSingle()
      if (dup) { out.skipped++; continue }
      const msg = await getMessage('econstruction', id)
      const subject = header(msg, 'Subject')
      const from = parseAddress(header(msg, 'From'))
      if (NOISE_SUBJECT.test(subject) || !RPS_TECH.test(from.email) || !/update/i.test(subject)) { out.skipped++; continue }
      const keys = siteKeysFromSubject(subject)
      const job = await findJobForKeys(admin, keys)
      if (!job) { out.unmatched.push(subject); continue }
      const workDate = ymdET(msg.internalDate)
      const skey = subjectKey(subject)
      // Starsky re-forwards a tech's update (sometimes with the site number fixed): same day + same wording = same update.
      const { data: twin } = await admin.from('con_daily_updates').select('id').eq('job_id', job.id).eq('work_date', workDate).contains('source_refs', { subject_key: skey }).maybeSingle()
      if (twin) { out.skipped++; continue }
      const body = stripQuoted(extractText(msg)) || '(photos only)'
      // Starsky re-forwards a tech's update with the site number fixed (a different subject, so the check
      // above misses it) — and the tech's original, carrying the wrong site, can resolve to some other job.
      // Same day + identical text anywhere = the same update, so file it once.
      if (body !== '(photos only)') {
        const { data: sameText } = await admin.from('con_daily_updates').select('id, job_id').eq('company_id', job.company_id).eq('work_date', workDate).eq('source', 'gmail_update').eq('work_description', body.slice(0, 4000)).limit(1)
        const prior = sameText?.[0]
        if (prior) {
          // The office's own forward carries the corrected site: if the original already landed on a different
          // job, move it (and its photos) to the right one instead of leaving it on the wrong job.
          // Trust the SENT label (set by Gmail only on mail this mailbox sent), not the spoofable From header.
          if (prior.job_id !== job.id && msg.labelIds?.includes('SENT')) {
            await admin.from('con_daily_updates').update({ job_id: job.id }).eq('id', prior.id).eq('company_id', job.company_id)
            await admin.from('con_documents').update({ job_id: job.id }).eq('daily_update_id', prior.id).eq('company_id', job.company_id)
          }
          out.skipped++; continue
        }
      }
      const { data: du, error: duErr } = await admin.from('con_daily_updates').insert({
        company_id: job.company_id, job_id: job.id, work_date: workDate, work_description: body.slice(0, 4000),
        notes: `Emailed to econstruction by ${from.name || from.email} · "${subject}"`,
        review_status: 'filed', source: 'gmail_update',
        source_refs: { update_message_id: id, thread_id: msg.threadId, subject, subject_key: skey, from_email: from.email },
      }).select('id').single()
      if (duErr || !du) throw new Error(duErr?.message ?? 'insert failed')
      const photos = listAttachments(msg).filter(a => (PHOTO_MIME.test(a.mimeType) || PHOTO_EXT.test(a.filename)) && a.size <= MAX_PHOTO_BYTES).slice(0, MAX_PHOTOS_PER_UPDATE)
      for (const a of photos) {
        const bytes = await getAttachment('econstruction', id, a.attachmentId)
        const path = `${job.company_id}/${job.id}/daily/${workDate}-${id}-${safeName(a.filename)}`
        const { error: upErr } = await admin.storage.from(DOCS_BUCKET).upload(path, bytes, { contentType: a.mimeType, upsert: true })
        if (upErr) { out.errors.push(`${subject}: photo ${a.filename}: ${upErr.message}`); continue }
        await admin.from('con_documents').insert({
          company_id: job.company_id, job_id: job.id, daily_update_id: du.id, file_name: a.filename, original_filename: a.filename, storage_path: path,
          category: 'photos', doc_type: 'photo', review_status: 'filed', imported_by: 'gmail_update_feed', imported_at: new Date().toISOString(),
        })
      }
      out.filed++; filedThisPass++
    } catch (e) {
      out.errors.push(`${id}: ${(e as Error).message}`)
    }
  }
  return out
}

/** 2. New handwritten tickets in rpinvoicing → the existing per-job backfill (OCR + needs_review draft), a few jobs per pass. */
export async function syncFieldTickets(opts: { sinceDays?: number; budget?: Budget } = {}): Promise<FeedResult['tickets']> {
  const out: FeedResult['tickets'] = { jobs: 0, filed: 0, errors: [] }
  if (!connectedInboxes().includes('rpinvoicing')) { out.errors.push('rpinvoicing not connected'); return out }
  const admin = createAdminClient()
  let ids: string[]
  try { ids = await listMessages('rpinvoicing', `newer_than:${opts.sinceDays ?? 3}d "(x"`, 40) } catch (e) { out.errors.push(`list: ${(e as Error).message}`); return out }
  const jobs = new Map<string, Job>()
  for (const id of ids) {
    if (jobs.size >= MAX_TICKET_JOBS_PER_PASS) break
    try {
      const msg = await getMessage('rpinvoicing', id)
      const subject = header(msg, 'Subject')
      if (!/\(x\d+\)/i.test(subject)) continue
      const { data: seen } = await admin.from('con_daily_updates').select('id').contains('source_refs', { ticket_message_id: id }).maybeSingle()
      if (seen) continue
      const job = await findJobForKeys(admin, siteKeysFromSubject(subject))
      if (job && !jobs.has(job.id)) jobs.set(job.id, job)
    } catch (e) { out.errors.push(`${id}: ${(e as Error).message}`) }
  }
  for (const job of jobs.values()) {
    if (over(opts.budget)) { out.budget_hit = true; break }
    try {
      const r = await backfillFieldTicketsForJob(job.id, { apply: true })
      out.jobs++
      out.filed += r.results.filter(x => x.status === 'filed').length
      for (const x of r.results) if (x.status === 'error') out.errors.push(`${job.site_number}: ${x.detail}`)
    } catch (e) { out.errors.push(`${job.site_number}: ${(e as Error).message}`) }
  }
  return out
}

const STAR_RECEIVED = /\breceived\b[\s\S]{0,60}\b(irts|rti)\b/i

/** 3. Peggy's invoice workups → the job's Documents (Invoices) and its stage. */
export async function syncInvoiceDocs(opts: { sinceDays?: number; budget?: Budget } = {}): Promise<FeedResult['invoices']> {
  const out: FeedResult['invoices'] = { filed: 0, completed: 0, unmatched: [], errors: [] }
  const admin = createAdminClient()
  const since = new Date(Date.now() - (opts.sinceDays ?? 45) * 86_400_000).toISOString()
  const { data: docs } = await admin.from('billing_inbox_documents')
    .select('id, company_id, subject, received_at, primary_path, attachments, thread_replies, sender_email')
    .eq('inbox', 'econstruction').ilike('subject', '%invoice%').ilike('sender_email', 'pwilmoth%').gte('received_at', since).order('received_at')
  for (const d of docs ?? []) {
    if (over(opts.budget)) { out.budget_hit = true; break }
    try {
      const keys = siteKeysFromSubject(d.subject ?? '')
      const job = await findJobForKeys(admin, keys, true)
      if (!job) { out.unmatched.push(d.subject ?? d.id); continue }
      const replies = (d.thread_replies ?? []) as ThreadReply[]
      const starReceived = replies.some(r => STAR_RECEIVED.test(r.text))
      const atts = (d.attachments ?? []) as { name: string; mime: string; path: string }[]
      let newHere = 0
      for (const a of atts) {
        const { data: have } = await admin.from('con_documents').select('id').eq('job_id', job.id).eq('source_path', a.path).maybeSingle()
        if (have) continue
        const { data: blob, error: dlErr } = await admin.storage.from(INBOX_BUCKET).download(a.path)
        if (dlErr || !blob) { out.errors.push(`${d.subject}: download ${a.name}: ${dlErr?.message ?? 'empty'}`); continue }
        const bytes = Buffer.from(await blob.arrayBuffer())
        const path = `${job.company_id}/${job.id}/invoices/${(d.received_at as string).slice(0, 10)}-${safeName(a.name)}`
        const { error: upErr } = await admin.storage.from(DOCS_BUCKET).upload(path, bytes, { contentType: a.mime, upsert: true })
        if (upErr) { out.errors.push(`${d.subject}: upload ${a.name}: ${upErr.message}`); continue }
        await admin.from('con_documents').insert({
          company_id: job.company_id, job_id: job.id, file_name: a.name, original_filename: a.name, storage_path: path, source_path: a.path,
          category: 'invoices', doc_type: 'invoice', review_status: starReceived ? 'filed' : 'needs_review', imported_by: 'gmail_invoice_feed', imported_at: new Date().toISOString(),
        })
        newHere++
      }
      if (newHere) out.filed += newHere
      // Stage: Peggy's workup = Need Invoiced; Star's "Received … IRTS" = sent to the customer = Complete.
      // Only a job whose work was under way moves. A site can carry a service-call invoice while its open job is still
      // a survey, a quote or waiting to be scheduled (32284 entry boots, 40041 probe daisy chain on 10/1/26) — those keep
      // the document but not the stage change.
      const want = starReceived ? 'complete' : 'invoicing'
      const underWay = ['in_progress', 'return_needed', 'on_hold', 'close_out', 'invoicing'].includes(job.stage)
      const canMove = underWay && job.stage !== 'complete' && (want === 'complete' || job.stage !== 'invoicing')
      if (canMove && (newHere || want === 'complete')) {
        const tag = want === 'complete' ? `Invoiced ${(d.received_at as string).slice(0, 10)} · sent to customer (Star)` : `Invoice workup ${(d.received_at as string).slice(0, 10)} (Peggy) · awaiting Starsky`
        const detail = (job.status_detail ?? '').includes('Invoice') ? job.status_detail : [job.status_detail, tag].filter(Boolean).join('  ->  ')
        const { error } = await admin.from('con_jobs').update({ stage: want, status_detail: detail, updated_at: new Date().toISOString() }).eq('id', job.id)
        if (error) out.errors.push(`${d.subject}: stage: ${error.message}`)
        else if (want === 'complete') out.completed++
        job.stage = want
      }
    } catch (e) { out.errors.push(`${d.subject}: ${(e as Error).message}`) }
  }
  return out
}

const VENDOR_BY_DOMAIN: [RegExp, string][] = [[/icontainment\.com$/i, 'ICON'], [/sourcena\.com$/i, 'Source'], [/spatco\.com$/i, 'Spatco'], [/morgan-brothers\.net$/i, 'Morgan Brothers'], [/chaneyenterprises\.com$/i, 'Chaney']]
const ORDER_SUBJECT = /material order|order request|placing this order|\border\b/i
const PO_REPLY = /\bP\.?O\.?\s*#?\s*:?\s*(\d{4,7})\b/i
const SHANNON = /^sparsons\.rp@gmail\.com$/i

/**
 * 4. Reconcile the plate with the order mail Trae sends. He copies econstruction on every order, so his sent order
 *    shows up there. Trae's rule (10/1/26): no vendor ships without a PO# from Shannon. So a sent order waits on
 *    Shannon for the PO# first; her "PO # 24241" reply in the thread records the PO and moves the wait to the vendor;
 *    the vendor's reply brings the row back to Trae with the words on it.
 */
export async function syncOrderMail(opts: { sinceDays?: number; budget?: Budget } = {}): Promise<FeedResult['orders']> {
  const out: FeedResult['orders'] = { sent: 0, po: 0, replied: 0, errors: [] }
  if (!connectedInboxes().includes('econstruction')) return out
  const admin = createAdminClient()
  let ids: string[]
  try { ids = await listMessages('econstruction', `newer_than:${opts.sinceDays ?? 7}d from:tdodson.rp@proton.me (order OR "take-off")`, 30) } catch (e) { out.errors.push(`list: ${(e as Error).message}`); return out }
  const { data: tasks } = await admin.from('con_tasks').select('id, site_number, status, action, detail, waiting_on').eq('kind', 'order').in('status', ['open', 'waiting'])
  const open = (tasks ?? []) as { id: string; site_number: string | null; status: string; action: Record<string, unknown> | null; detail: string | null; waiting_on: string | null }[]
  for (const id of ids) {
    if (over(opts.budget)) { out.budget_hit = true; break }
    try {
      const msg = await getMessage('econstruction', id)
      const subject = header(msg, 'Subject')
      if (!ORDER_SUBJECT.test(subject)) continue
      const keys = siteKeysFromSubject(subject)
      const task = open.find(t => t.site_number && keys.some(k => k.toUpperCase() === t.site_number!.toUpperCase() || t.site_number!.toUpperCase().endsWith(k.toUpperCase())))
      if (!task) continue
      const a = (task.action ?? {}) as Record<string, unknown>
      const to = parseAddress(header(msg, 'To'))
      const vendor = VENDOR_BY_DOMAIN.find(([re]) => re.test(to.email))?.[1] ?? (to.email.split('@')[1] ?? 'vendor')
      if (a.order_message_id !== id) {
        const sentDay = ymdET(msg.internalDate)
        const patch = { status: 'waiting', waiting_on: 'Shannon (PO#)', waiting_since: sentDay, action: { ...a, type: a.type ?? 'order_email', draft_status: 'sent', sent_at: new Date(Number(msg.internalDate)).toISOString(), order_message_id: id, order_subject: subject, vendor_name: vendor }, detail: [task.detail, `Sent ${sentDay} to ${to.email}: "${subject}" (from the econstruction copy). Waiting on Shannon's PO# — no vendor ships without one.`].filter(Boolean).join('\n'), updated_at: new Date().toISOString() }
        await admin.from('con_tasks').update(patch).eq('id', task.id)
        Object.assign(task, { status: 'waiting', waiting_on: patch.waiting_on, action: patch.action, detail: patch.detail })
        out.sent++
      }
      // Thread: Shannon's PO#, then the vendor's answer.
      const cur = (task.action ?? {}) as Record<string, unknown>
      const thread = await getThread('econstruction', msg.threadId)
      const later = thread.messages.filter(m => m.id !== id && Number(m.internalDate) > Number(msg.internalDate)).map(m => ({ m, from: parseAddress(header(m, 'From')), text: stripQuoted(extractText(m)) }))
      const po = later.find(x => SHANNON.test(x.from.email) && PO_REPLY.test(x.text))
      if (po && !cur.po_number) {
        const num = (po.text.match(PO_REPLY) as RegExpMatchArray)[1]
        const day = ymdET(po.m.internalDate)
        const patch = { waiting_on: vendor, waiting_since: day, action: { ...cur, po_number: num, po_message_id: po.m.id, po_at: new Date(Number(po.m.internalDate)).toISOString() }, detail: [task.detail, `PO# ${num} from Shannon ${day}. Now waiting on ${vendor}.`].filter(Boolean).join('\n'), updated_at: new Date().toISOString() }
        await admin.from('con_tasks').update(patch).eq('id', task.id)
        Object.assign(task, { waiting_on: vendor, action: patch.action, detail: patch.detail })
        out.po++
      }
      const reply = later.find(x => !RPS_TECH.test(x.from.email) && !/proton\.me$/i.test(x.from.email) && !SHANNON.test(x.from.email))
      const cur2 = (task.action ?? {}) as Record<string, unknown>
      if (reply && task.status === 'waiting' && cur2.replied_message_id !== reply.m.id) {
        const noPo = cur2.po_number ? '' : ' (still no PO# from Shannon — they cannot ship)'
        await admin.from('con_tasks').update({ status: 'open', priority: 1, waiting_on: null, waiting_since: null, detail: [task.detail, `Reply from ${reply.from.name || reply.from.email} ${ymdET(reply.m.internalDate)}${noPo}: ${reply.text.slice(0, 500)}`].filter(Boolean).join('\n'), action: { ...cur2, replied_message_id: reply.m.id, replied_at: new Date(Number(reply.m.internalDate)).toISOString() }, updated_at: new Date().toISOString() }).eq('id', task.id)
        task.status = 'open'
        out.replied++
      }
    } catch (e) { out.errors.push(`${id}: ${(e as Error).message}`) }
  }
  return out
}

/** Two route passes so each stays inside the 60 s function budget: 'updates' = tech updates + field tickets, 'orders' = invoice workups + order mail. */
export async function syncJobEmailFeed(opts: { sinceDays?: number; part?: 'updates' | 'orders' | 'all' } = {}): Promise<Partial<FeedResult>> {
  const budget: Budget = { deadline: Date.now() + PASS_BUDGET_MS }
  const part = opts.part ?? 'all'
  const out: Partial<FeedResult> = {}
  if (part !== 'orders') { out.updates = await syncTechUpdates({ ...opts, budget }); out.tickets = await syncFieldTickets({ ...opts, budget }) }
  if (part !== 'updates') { out.invoices = await syncInvoiceDocs({ sinceDays: Math.max(opts.sinceDays ?? 3, 14), budget }); out.orders = await syncOrderMail({ sinceDays: 7, budget }) }
  return out
}
