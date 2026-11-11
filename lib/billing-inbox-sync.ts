/**
 * Billing inbox sync — Phase 5 of the Billing + Inventory module.
 *
 * Two passes, each cheap enough for one cron tick:
 *
 *   sync    Gmail → billing_inbox_documents. For every connected RPS inbox,
 *           pull recent emails that carry paperwork (packing slips, vendor
 *           invoices, receipts, vendor quotes), save the attachments to the
 *           private `billing-inbox` bucket, and file one row per email.
 *
 *   extract Claude reads the attachment(s) and pulls the line items out
 *           (part number, description, qty, unit cost), then each line is
 *           matched against the parts catalog. Nothing touches the ledger
 *           here — a human confirms the lines from the Receive queue.
 *
 * Idempotent: (inbox, gmail_message_id) is unique, so re-running never
 * duplicates. Read-only against Gmail: nothing is archived or marked read.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  type BillingInbox, connectedInboxes, listMessages, getMessage, getThread, getAttachment,
  header, parseAddress, listAttachments, extractText,
} from '@/lib/billing-gmail-client'

export const INBOX_BUCKET = 'billing-inbox'
const EXTRACT_MODEL = process.env.BILLING_EXTRACT_MODEL ?? 'claude-sonnet-5'
const FALLBACK_MODEL = 'claude-sonnet-4-6'
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024
const MAX_ATTACHMENTS = 6

// Gmail search per inbox. constructionreceipts is a receipts-only mailbox, so no keyword gate there.
const PAPERWORK = '(invoice OR "packing slip" OR "packing list" OR "pack slip" OR "pick ticket" OR receipt OR quote OR quotation OR proposal OR estimate OR "order confirmation" OR "order acknowledgment" OR shipment OR shipped OR "bill of lading")'
// Tech completion forwards ("Fwd: 7-Eleven … Work Order WOT…", "WAWA Work Order … is Dispatched") carry jobsite
// photos, not paperwork — Service Dispatch already handles them, so they are excluded here.
const NOT_DISPATCH = '-subject:"Work Order" -subject:Dispatched -subject:WOT'
const INBOX_QUERY: Record<BillingInbox, string> = {
  econstruction:        `has:attachment -in:spam -in:trash ${PAPERWORK} ${NOT_DISPATCH}`,
  constructionreceipts: 'has:attachment -in:spam -in:trash',
  rpinvoicing:          `has:attachment -in:spam -in:trash ${PAPERWORK} ${NOT_DISPATCH} (filename:pdf OR filename:xlsx OR filename:xls OR filename:csv)`,
  maintenance:          `has:attachment -in:spam -in:trash (invoice OR receipt OR "packing slip" OR "packing list") ${NOT_DISPATCH}`,
}

/** A tech forwarding a portal dispatch back with photos — never paperwork for the receive queue. */
export function isDispatchTraffic(subject: string, senderEmail: string): boolean {
  return /work order|dispatched|\bWOT\d|\bFWKD\d|\bINC\d{4,}/i.test(subject) && RPS_SENDER.test(senderEmail)
}

const KEEP_MIME = /^(application\/pdf|image\/(jpeg|jpg|png|gif|webp|heic)|text\/csv|text\/plain|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel)$/i
const KEEP_EXT = /\.(pdf|jpe?g|png|gif|webp|heic|csv|txt|xlsx|xls)$/i

// RPS's own addresses — mail from these is *our* paperwork (a ticket workup, an invoice we sent), not a vendor's.
const RPS_SENDER = /(^|[.@])(rpinvoicing|rpdispatcher|econstruction\.rp|constructionreceipts|constructioninvoicing|maintenance\.rps|maintenancereceipt|rptrailerlog)@gmail\.com$|\.rp@gmail\.com$|@rappahannockpetroleum\.com$/i

const VENDOR_BY_DOMAIN: [RegExp, string][] = [
  [/sourcena|sourcenorthamerica/i, 'Source North America'], [/gilbarco/i, 'Gilbarco Veeder-Root'], [/veeder/i, 'Veeder-Root'],
  [/opwglobal|opw-fc|opw\.com/i, 'OPW'], [/franklinfueling|fele\.com/i, 'Franklin Fueling'], [/jfpetro/i, 'JF Petroleum'],
  [/cpetro|petroleumequipment/i, 'Central Petroleum'], [/fastenal/i, 'Fastenal'], [/grainger/i, 'Grainger'], [/graybar/i, 'Graybar'],
  [/ferguson/i, 'Ferguson'], [/homedepot/i, 'Home Depot'], [/lowes\.com/i, "Lowe's"], [/amazon/i, 'Amazon'], [/husky/i, 'Husky'],
  [/cimtek|cim-tek/i, 'Cim-Tek'], [/petroclear/i, 'PetroClear'], [/icontrols|iconcontrols/i, 'ICON'], [/tannercompanies|tanner/i, 'Tanner'],
]

export type ExtractedLine = {
  part_number: string | null
  description: string
  qty: number | null
  unit_cost: number | null
  line_total: number | null
  backordered?: boolean
  source_file?: string | null
  part_id?: string | null
  match?: 'exact' | 'fuzzy' | 'none'
  match_part_number?: string | null
  match_description?: string | null
  catalog_cost?: number | null
}

export type Extracted = {
  document_kind: string | null
  vendor: string | null
  reference: string | null
  document_date: string | null
  po_or_job: string | null
  lines: ExtractedLine[]
  subtotal: number | null
  tax: number | null
  freight: number | null
  total: number | null
  notes: string | null
  model?: string
}

export type SyncResult = { inbox: BillingInbox; listed: number; new: number; skipped: number; replies: number; errors: string[] }

/** One reply in a packing-slip thread, e.g. Shannon's "SU-8605 material" or Starsky's "Stock". */
export type ThreadReply = { message_id: string; from: string; from_email: string; at: string; text: string }
/** Replies are looked for on slips this recent. Chris asks the day a box lands and the answer comes within days. */
const REPLY_WINDOW_DAYS = 45

// ── helpers ──────────────────────────────────────────────────────────────────

async function companyId(admin: ReturnType<typeof createAdminClient>): Promise<string> {
  const { data } = await admin.from('companies').select('id').order('created_at').limit(1).single()
  if (!data) throw new Error('No company row')
  return data.id
}

function sinceQuery(days: number) {
  const d = new Date(Date.now() - days * 86_400_000)
  return `after:${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function safeName(name: string) {
  return name.replace(/[^\w.\-() ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'attachment'
}

/** Rough kind from the words on the email. Claude refines it after reading the attachment. */
export function classifyKind(inbox: BillingInbox, subject: string, senderEmail: string, filenames: string[], body: string): string {
  const hay = `${subject} ${filenames.join(' ')}`.toLowerCase()
  const bodyLow = body.slice(0, 600).toLowerCase()
  const ours = RPS_SENDER.test(senderEmail)
  if (/packing|pack slip|pick ticket|shipment|shipped|bill of lading|tracking/.test(hay)) return 'packing_slip'
  if (/receipt/.test(hay) || inbox === 'constructionreceipts') return 'receipt'
  if (/quote|quotation|proposal|estimate/.test(hay)) return 'vendor_quote'
  if (/invoice|statement|bill/.test(hay) || /invoice/.test(bodyLow)) return ours ? 'customer_invoice' : 'vendor_invoice'
  if (/order confirmation|acknowledg/.test(hay)) return 'packing_slip'
  return 'other'
}

export function guessVendor(senderName: string, senderEmail: string): string | null {
  if (RPS_SENDER.test(senderEmail)) return null
  for (const [re, name] of VENDOR_BY_DOMAIN) if (re.test(senderEmail)) return name
  if (senderName && !/gmail|noreply|no-reply/i.test(senderName)) return senderName.replace(/\s*\(.*\)\s*$/, '').trim() || null
  const domain = senderEmail.split('@')[1] ?? ''
  if (!domain || /gmail|yahoo|outlook|hotmail|icloud/.test(domain)) return null
  const core = domain.split('.')[0]
  return core ? core.charAt(0).toUpperCase() + core.slice(1) : null
}

function findReference(subject: string, body: string): string | null {
  const m = `${subject}\n${body.slice(0, 1500)}`.match(/(?:invoice|inv|packing slip|packing list|order|so|po|quote|ref(?:erence)?|receipt)\s*(?:#|no\.?|number|:)?\s*([A-Z0-9][A-Z0-9\-\/]{3,})/i)
  return m ? m[1].replace(/[.,;:]+$/, '') : null
}

// ── pass 1: sync ─────────────────────────────────────────────────────────────

export async function syncInbox(inbox: BillingInbox, opts: { maxResults?: number; sinceDays?: number; after?: string; before?: string } = {}): Promise<SyncResult> {
  const admin = createAdminClient()
  const result: SyncResult = { inbox, listed: 0, new: 0, skipped: 0, replies: 0, errors: [] }
  const company_id = await companyId(admin)

  let ids: string[]
  try {
    // after/before (YYYY-MM-DD) pin a dated slice for historical catch-ups; Gmail lists newest first, so a
    // plain sinceDays window never reaches older mail once the newest page is all already filed.
    const window = opts.after ? `after:${opts.after.replace(/-/g, '/')}${opts.before ? ` before:${opts.before.replace(/-/g, '/')}` : ''}` : sinceQuery(opts.sinceDays ?? 14)
    ids = await listMessages(inbox, `${INBOX_QUERY[inbox]} ${window}`, opts.maxResults ?? 30)
  } catch (e) {
    result.errors.push(`list failed: ${(e as Error).message}`)
    return result
  }
  result.listed = ids.length
  if (!ids.length) return result

  const { data: seen } = await admin.from('billing_inbox_documents').select('gmail_message_id').eq('inbox', inbox).in('gmail_message_id', ids)
  const seenSet = new Set((seen ?? []).map(r => r.gmail_message_id))

  for (const id of ids) {
    if (seenSet.has(id)) { result.skipped++; continue }
    try {
      const msg = await getMessage(inbox, id)
      const subject = header(msg, 'Subject')
      const from = parseAddress(header(msg, 'From'))
      const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(header(msg, 'Date') || Date.now())
      if (isDispatchTraffic(subject, from.email)) { result.skipped++; continue }
      const body = extractText(msg)
      const atts = listAttachments(msg).filter(a => KEEP_MIME.test(a.mimeType) || KEEP_EXT.test(a.filename)).filter(a => a.size <= MAX_ATTACHMENT_BYTES).slice(0, MAX_ATTACHMENTS)
      if (!atts.length) { result.skipped++; continue }   // signature images only — not paperwork

      const stored: { name: string; mime: string; path: string; size: number }[] = []
      for (const a of atts) {
        const bytes = await getAttachment(inbox, id, a.attachmentId)
        const path = `${inbox}/${id}/${safeName(a.filename)}`
        const { error } = await admin.storage.from(INBOX_BUCKET).upload(path, bytes, { contentType: a.mimeType, upsert: true })
        if (error) throw new Error(`upload ${a.filename}: ${error.message}`)
        stored.push({ name: a.filename, mime: a.mimeType, path, size: bytes.length })
      }
      const primary = stored.find(s => /pdf/i.test(s.mime)) ?? stored.find(s => /^image\//i.test(s.mime)) ?? stored[0]
      const kind = classifyKind(inbox, subject, from.email, stored.map(s => s.name), body)
      const extractable = stored.some(s => /pdf|^image\/(jpeg|jpg|png|gif|webp)$|text\/(csv|plain)/i.test(s.mime) || /\.(pdf|jpe?g|png|gif|webp|csv|txt)$/i.test(s.name))
      // Our own paperwork (a tech's startup report, an invoice we sent) is filed under "Our paperwork", not To-do,
      // and Claude is not asked to read it — only vendor documents get line extraction.
      const internal = kind === 'customer_invoice' || (kind === 'other' && RPS_SENDER.test(from.email))

      const { error } = await admin.from('billing_inbox_documents').insert({
        company_id, inbox, gmail_message_id: id, gmail_thread_id: msg.threadId,
        sender: from.name || from.email, sender_email: from.email, subject, received_at: receivedAt.toISOString(),
        body_preview: body.slice(0, 1200), kind, vendor: guessVendor(from.name, from.email), reference: findReference(subject, body),
        attachments: stored, primary_path: primary?.path ?? null,
        extract_status: internal ? 'skipped' : extractable ? 'pending' : 'skipped',
        extract_error: internal ? 'Internal paperwork (sent from an RPS address) — filed, not read.' : extractable ? null : 'Attachment type not readable automatically (spreadsheet/HEIC) — enter the lines by hand.',
        status: internal ? 'linked' : 'new',
      })
      if (error) throw new Error(error.message)
      result.new++
    } catch (e) {
      result.errors.push(`${id}: ${(e as Error).message}`)
    }
  }

  // Pass 1b: the answer to "where does this go?" is a reply in the slip's thread, never a new attachment.
  const replies = await syncThreadReplies(inbox)
  result.replies = replies.updated
  result.errors.push(...replies.errors)
  return result
}

/** Just the new words in a reply: cut the quoted history, the sign-off and the signature. */
export function stripQuoted(text: string): string {
  const t = text.replace(/\r/g, '')
  // Gmail wraps plain text at ~76 columns, so "On Fri, Sep 18, 2026 at 1:45 PM Rappahannock Construction Dept <\neconstruction…> wrote:" spans lines.
  // "On Fri, Sep 18, 2026 at 1:45 PM … wrote:", "On Sep 24, 2026, at 10:17 AM, … wrote:" (iOS), "On Monday, September 21st, 2026 … wrote:" (Proton)
  const quote = t.search(/(\bOn [A-Z][a-z]{2,8}[ ,][\s\S]{0,220}?wrote:|-{2,}\s*(?:Original|Forwarded) Message\s*-{2,}|^From:\s|^>|^--\s*$|Sent from (?:my |Proton))/mi)
  const head = quote >= 0 ? t.slice(0, quote) : t
  const signoff = head.search(/^\s*(?:thank you|thanks|thx|regards|best|sincerely)\b/mi)
  const out = (signoff >= 0 ? head.slice(0, signoff) : head).split('\n').map(l => l.trim()).filter(Boolean).join(' ').trim().slice(0, 600)
  return isAck(out) ? '' : out
}

/** "Ok, thanks." / "Will do. THANKS" / "Got it" say nothing about where a box goes. */
export function isAck(text: string): boolean {
  return /^(?:(?:ok(?:ay)?|will do|got it|sounds good|yes|yep|no problem|np|10-4|thanks?|thank you|thank ya|thx|ty|sd|pw)[\s.,!-]*){1,4}$/i.test(text.trim())
}

/**
 * Store the replies in each recent packing-slip thread on the slip's row (thread_replies, last_reply_at).
 * The construction dashboard reads them to place a shipment on a job or mark it stock; the receive queue shows them.
 */
export async function syncThreadReplies(inbox: BillingInbox, opts: { sinceDays?: number } = {}): Promise<{ checked: number; updated: number; errors: string[] }> {
  const admin = createAdminClient()
  const out = { checked: 0, updated: 0, errors: [] as string[] }
  const since = new Date(Date.now() - (opts.sinceDays ?? REPLY_WINDOW_DAYS) * 86_400_000).toISOString()
  const { data: rows, error: selErr } = await admin.from('billing_inbox_documents')
    .select('id, gmail_message_id, gmail_thread_id, received_at, thread_replies')
    .eq('inbox', inbox).in('kind', ['packing_slip', 'customer_invoice']).gte('received_at', since).not('gmail_thread_id', 'is', null)
  if (selErr) { out.errors.push(`replies: ${selErr.message}`); return out }
  for (const row of rows ?? []) {
    if (!/^[0-9a-f]{10,}$/i.test(row.gmail_thread_id as string)) continue   // smoke-test rows carry fake thread ids
    out.checked++
    try {
      const thread = await getThread(inbox, row.gmail_thread_id as string)
      const replies = [...((row.thread_replies ?? []) as ThreadReply[])]
      const known = new Set(replies.map(r => r.message_id))
      const rowAt = Date.parse(row.received_at)
      let changed = false
      for (const m of thread.messages) {
        if (m.id === row.gmail_message_id || known.has(m.id)) continue
        if (Number(m.internalDate) <= rowAt) continue                       // only what came after this message, not before it
        const text = stripQuoted(extractText(m))
        if (!text) continue                                  // "THANKS" and empty forwards are noise
        const from = parseAddress(header(m, 'From'))
        replies.push({ message_id: m.id, from: from.name || from.email, from_email: from.email, at: new Date(Number(m.internalDate) || Date.now()).toISOString(), text })
        changed = true
      }
      if (!changed) continue
      replies.sort((a, b) => a.at.localeCompare(b.at))
      const { error } = await admin.from('billing_inbox_documents').update({ thread_replies: replies, last_reply_at: replies[replies.length - 1].at }).eq('id', row.id)
      if (error) throw new Error(error.message)
      out.updated++
    } catch (e) {
      out.errors.push(`${row.id}: ${(e as Error).message}`)
    }
  }
  return out
}

export async function syncAllInboxes(opts: { maxResults?: number; sinceDays?: number } = {}): Promise<SyncResult[]> {
  const out: SyncResult[] = []
  for (const inbox of connectedInboxes()) out.push(await syncInbox(inbox, opts))
  return out
}

// ── pass 2: extract ──────────────────────────────────────────────────────────

const RECORD_TOOL: Anthropic.Tool = {
  name: 'record_document',
  description: 'Record every line item on the attached paperwork exactly as printed.',
  input_schema: {
    type: 'object',
    properties: {
      document_kind: { type: 'string', enum: ['packing_slip', 'vendor_invoice', 'receipt', 'vendor_quote', 'customer_invoice', 'other'] },
      vendor: { type: ['string', 'null'], description: 'Company that issued the document' },
      reference: { type: ['string', 'null'], description: 'Invoice / packing slip / order / receipt number' },
      document_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
      po_or_job: { type: ['string', 'null'], description: 'PO number, job, site or store the vendor printed on it' },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            part_number: { type: ['string', 'null'], description: 'Manufacturer or vendor part number as printed; null if none' },
            description: { type: 'string' },
            qty: { type: ['number', 'null'], description: 'Quantity shipped/billed (not ordered)' },
            unit_cost: { type: ['number', 'null'], description: 'Unit price before tax; null if the document shows no prices' },
            line_total: { type: ['number', 'null'] },
            backordered: { type: 'boolean' },
            source_file: { type: ['string', 'null'] },
          },
          required: ['description'],
        },
      },
      subtotal: { type: ['number', 'null'] }, tax: { type: ['number', 'null'] }, freight: { type: ['number', 'null'] }, total: { type: ['number', 'null'] },
      notes: { type: ['string', 'null'], description: 'Anything a bookkeeper should know: partial shipment, credits, missing pages' },
    },
    required: ['document_kind', 'lines'],
  },
}

const SYSTEM = `You read supplier paperwork for Rappahannock Petroleum Services (RPS), a petroleum equipment contractor (fuel dispensers, tanks, sumps, Veeder-Root ATGs, OPW/Franklin hardware).
Extract every line item exactly as printed — part numbers verbatim, quantities actually shipped or billed, unit price before tax. Never invent a price or a part number; use null when the document does not show one. Freight, tax and fees are not line items — put them in the totals. If several documents are attached, record all of their lines and set source_file on each. Return only the record_document tool call.`

function normPN(s: string | null | undefined) {
  return (s ?? '').toUpperCase().replace(/^[A-Z]{3}-(?=[A-Z0-9])/, '').replace(/[^A-Z0-9]/g, '')
}

/** Attach part_id / match to each line using the catalog (exact normalized part number, then a contains search). */
export async function matchLinesToCatalog(admin: ReturnType<typeof createAdminClient>, company_id: string, lines: ExtractedLine[]): Promise<ExtractedLine[]> {
  const raw = [...new Set(lines.map(l => (l.part_number ?? '').trim()).filter(Boolean))]
  if (!raw.length) return lines.map(l => ({ ...l, part_id: null, match: 'none' as const }))
  const { data: exact } = await admin.from('parts').select('id, part_number, description, unit_cost').eq('company_id', company_id).eq('active', true).in('part_number', raw)
  const byNorm = new Map<string, { id: string; part_number: string; description: string; unit_cost: number | null }>()
  for (const p of exact ?? []) byNorm.set(normPN(p.part_number), p)

  const out: ExtractedLine[] = []
  for (const l of lines) {
    const key = normPN(l.part_number)
    let hit = key ? byNorm.get(key) : undefined
    let match: ExtractedLine['match'] = hit ? 'exact' : 'none'
    if (!hit && key.length >= 4) {
      const core = (l.part_number ?? '').trim().replace(/^[A-Z]{3}-/i, '')
      const { data: fuzzy } = await admin.from('parts').select('id, part_number, description, unit_cost').eq('company_id', company_id).eq('active', true).ilike('part_number', `%${core}%`).limit(3)
      const pick = (fuzzy ?? []).find(p => normPN(p.part_number) === key) ?? (fuzzy ?? [])[0]
      if (pick) { hit = pick; match = normPN(pick.part_number) === key ? 'exact' : 'fuzzy' }
    }
    out.push({ ...l, part_id: hit?.id ?? null, match, match_part_number: hit?.part_number ?? null, match_description: hit?.description ?? null, catalog_cost: hit?.unit_cost != null ? Number(hit.unit_cost) : null })
  }
  return out
}

function mediaTypeFor(att: { name: string; mime: string }): { block: 'document' | 'image' | 'text'; media: string } | null {
  const m = att.mime.toLowerCase(), n = att.name.toLowerCase()
  if (m === 'application/pdf' || n.endsWith('.pdf')) return { block: 'document', media: 'application/pdf' }
  if (/^image\/(jpeg|jpg)$/.test(m) || /\.jpe?g$/.test(n)) return { block: 'image', media: 'image/jpeg' }
  if (m === 'image/png' || n.endsWith('.png')) return { block: 'image', media: 'image/png' }
  if (m === 'image/gif' || n.endsWith('.gif')) return { block: 'image', media: 'image/gif' }
  if (m === 'image/webp' || n.endsWith('.webp')) return { block: 'image', media: 'image/webp' }
  if (/text\/(csv|plain)/.test(m) || /\.(csv|txt)$/.test(n)) return { block: 'text', media: 'text/plain' }
  return null
}

/** Run Claude over one document's attachments and store the extracted, catalog-matched lines. */
export async function extractDocument(docId: string): Promise<{ ok: boolean; lines?: number; error?: string }> {
  const admin = createAdminClient()
  const { data: doc } = await admin.from('billing_inbox_documents').select('*').eq('id', docId).single()
  if (!doc) return { ok: false, error: 'not found' }
  if (!process.env.ANTHROPIC_API_KEY) {
    await admin.from('billing_inbox_documents').update({ extract_status: 'failed', extract_error: 'ANTHROPIC_API_KEY is not set' }).eq('id', docId)
    return { ok: false, error: 'ANTHROPIC_API_KEY is not set' }
  }

  const atts = (doc.attachments as { name: string; mime: string; path: string; size: number }[]).map(a => ({ a, kind: mediaTypeFor(a) })).filter(x => x.kind).slice(0, 4)
  if (!atts.length) {
    await admin.from('billing_inbox_documents').update({ extract_status: 'skipped', extract_error: 'No readable attachment (PDF/image/CSV)' }).eq('id', docId)
    return { ok: false, error: 'no readable attachment' }
  }

  const content: Anthropic.ContentBlockParam[] = []
  let budget = 20 * 1024 * 1024
  for (const { a, kind } of atts) {
    const { data, error } = await admin.storage.from(INBOX_BUCKET).download(a.path)
    if (error || !data) continue
    const buf = Buffer.from(await data.arrayBuffer())
    if (buf.length > budget) continue
    budget -= buf.length
    content.push({ type: 'text', text: `Attachment: ${a.name}` })
    if (kind!.block === 'document') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } })
    else if (kind!.block === 'image') content.push({ type: 'image', source: { type: 'base64', media_type: kind!.media as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: buf.toString('base64') } })
    else content.push({ type: 'text', text: buf.toString('utf8').slice(0, 60_000) })
  }
  content.push({ type: 'text', text: `Email subject: ${doc.subject ?? ''}\nFrom: ${doc.sender ?? ''} <${doc.sender_email ?? ''}>\nInbox: ${doc.inbox}\n\nRecord this paperwork with record_document.` })

  const client = new Anthropic()
  const call = (model: string) => client.messages.create({ model, max_tokens: 8000, system: SYSTEM, tools: [RECORD_TOOL], tool_choice: { type: 'tool', name: 'record_document' }, messages: [{ role: 'user', content }] })
  let model = EXTRACT_MODEL
  let response: Anthropic.Message
  try {
    try { response = await call(model) }
    catch (e) {
      const msg = (e as Error).message
      if (/not_found|model/i.test(msg) && model !== FALLBACK_MODEL) { model = FALLBACK_MODEL; response = await call(model) } else throw e
    }
  } catch (e) {
    await admin.from('billing_inbox_documents').update({ extract_status: 'failed', extract_error: (e as Error).message.slice(0, 500) }).eq('id', docId)
    return { ok: false, error: (e as Error).message }
  }

  const tool = response.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined
  if (!tool) {
    await admin.from('billing_inbox_documents').update({ extract_status: 'failed', extract_error: 'Model returned no record' }).eq('id', docId)
    return { ok: false, error: 'no tool call' }
  }
  const raw = tool.input as Extracted
  const lines = await matchLinesToCatalog(admin, doc.company_id, (raw.lines ?? []).map(l => ({
    part_number: l.part_number ?? null, description: l.description ?? '', qty: l.qty ?? null, unit_cost: l.unit_cost ?? null,
    line_total: l.line_total ?? null, backordered: !!l.backordered, source_file: l.source_file ?? null,
  })))
  const extracted: Extracted = { ...raw, lines, model }
  const kindOk = ['packing_slip', 'vendor_invoice', 'receipt', 'vendor_quote', 'customer_invoice', 'other'].includes(raw.document_kind ?? '')
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(raw.document_date ?? '')

  await admin.from('billing_inbox_documents').update({
    extracted, extract_status: 'done', extract_error: null,
    kind: kindOk && raw.document_kind !== 'other' ? raw.document_kind : doc.kind,
    vendor: raw.vendor || doc.vendor, reference: raw.reference || doc.reference,
    document_date: dateOk ? raw.document_date : doc.document_date,
  }).eq('id', docId)
  return { ok: true, lines: lines.length }
}

/** Extract the oldest pending documents (bounded so a cron tick stays inside its time budget). */
export async function extractPending(limit = 3): Promise<{ processed: number; ok: number; errors: string[] }> {
  const admin = createAdminClient()
  const { data: pending } = await admin.from('billing_inbox_documents').select('id').eq('extract_status', 'pending').in('status', ['new']).order('received_at', { ascending: true }).limit(limit)
  const out = { processed: 0, ok: 0, errors: [] as string[] }
  for (const d of pending ?? []) {
    out.processed++
    const r = await extractDocument(d.id)
    if (r.ok) out.ok++; else out.errors.push(`${d.id}: ${r.error}`)
  }
  return out
}

/** Short-lived link to an attachment in the private bucket. */
export async function signedAttachmentUrl(path: string, seconds = 600): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin.storage.from(INBOX_BUCKET).createSignedUrl(path, seconds)
  return data?.signedUrl ?? null
}
