/**
 * Claude read of the completed-ticket photos/scans captured off rpinvoicing
 * (see svc-gmail-sync.ts's captureWorkOrderDocument).
 *
 * Version 2 (Nov 2026, the ticket log): every attachment is read, not just
 * the first four; big phone photos are shrunk first; and the read comes back
 * in pieces — the FRONT of the ticket, the BACK (parts / materials), a parts
 * list, and the header fields — so the log can show and search them.
 *
 * Still a DRAFT: `transcript` (front + back + other pages) pre-fills the
 * review queue's editable text, and manager_signature_visible is only a hint.
 * A human sets manager_signature_verified themselves before anything is ready.
 */

import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'
import { createAdminClient } from '@/lib/supabase/admin'
import { WORK_ORDER_DOCS_BUCKET } from '@/lib/svc-gmail-sync'

const EXTRACT_MODEL = process.env.BILLING_EXTRACT_MODEL ?? 'claude-sonnet-5'
const FALLBACK_MODEL = 'claude-sonnet-4-6'

export const TICKET_EXTRACT_VERSION = 2
/** Pages read per ticket email. */
const MAX_PAGES = 10
/** Long edge, in pixels, a photo is shrunk to before it is read. */
const PHOTO_EDGE = 2200

export const PAGE_KINDS = ['ticket_front', 'ticket_back', 'parts_tag', 'packing_list', 'printout', 'portal_screenshot', 'site_photo', 'other'] as const
export type PageKind = typeof PAGE_KINDS[number]

export type TicketPart = { qty: number | null; description: string; part_number: string | null; source: string | null }
export type TicketPage = { name: string; kind: PageKind; note: string | null }

const RECORD_TOOL: Anthropic.Tool = {
  name: 'record_ticket',
  description: 'Record what is written on a completed field ticket, page by page.',
  input_schema: {
    type: 'object',
    properties: {
      pages: {
        type: 'array',
        description: 'One entry per attachment, in the order given.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The attachment name exactly as given' },
            kind: { type: 'string', enum: [...PAGE_KINDS], description: 'ticket_front = the written work ticket; ticket_back = the reverse side / parts and materials list; parts_tag = a photo of a part label, box or tag; packing_list = vendor packing slip; printout = ATG / Veeder-Root / register tape; portal_screenshot = customer work-order app screen; site_photo = a picture of the work with no writing to transcribe; other' },
            note: { type: ['string', 'null'], description: 'For a site photo or anything not transcribed: five to ten words on what it shows' },
          },
          required: ['name', 'kind'],
        },
      },
      front_text: { type: ['string', 'null'], description: 'Everything written or printed on the FRONT of the ticket, in reading order, exactly as written. Leave out the empty pre-printed boxes (blank totals, the "No one home" checkboxes, the acknowledgement sentence).' },
      back_text: { type: ['string', 'null'], description: 'Everything written on the BACK of the ticket and on any parts / materials list, exactly as written, one line per item. Null when no back or parts page was sent.' },
      other_text: { type: ['string', 'null'], description: 'Text from the remaining pages (part tags, packing lists, printouts, portal screens), each under a line naming the page.' },
      parts: {
        type: 'array',
        description: 'Every part or material used, from the back of the ticket, a "parts used" box on the front, tags and packing lists. One entry per item; do not repeat an item that appears on both the ticket and its tag.',
        items: {
          type: 'object',
          properties: {
            qty: { type: ['number', 'null'] },
            description: { type: 'string', description: 'As written' },
            part_number: { type: ['string', 'null'], description: 'Manufacturer / stock number as written (e.g. GRD-OPW10P-0152, VDR-0514100-30, GIL-K94254-01)' },
            source: { type: ['string', 'null'], enum: ['back', 'front', 'tag', 'packing_list', null] },
          },
          required: ['description'],
        },
      },
      wo_number: { type: ['string', 'null'], description: 'Work order / service request number written on the ticket (WOT…, FWKD…, INC…, SR#)' },
      site: { type: ['string', 'null'], description: 'Store / site as written under job name and location, e.g. "7-Eleven 45988 Waynesboro, VA", "SU-2333", "Wawa 8622"' },
      work_date: { type: ['string', 'null'], description: 'Date of the work as YYYY-MM-DD' },
      technician_name: { type: ['string', 'null'], description: 'The technician (mechanic) — full name from the staff list when the initials or signature match one, else as written' },
      helper: { type: ['string', 'null'], description: 'Helper(s), same rule' },
      truck: { type: ['string', 'null'], description: 'Truck number if written (e.g. L12, F6, BB2)' },
      onsite_hours: { type: ['number', 'null'], description: 'On-site hours for the visit as written (one man\'s hours, not multiplied by the crew)' },
      crew_size: { type: ['integer', 'null'], description: 'Number of men on site (the "x2" in "2.5x2")' },
      completion: { type: 'string', enum: ['complete', 'rtn', 'unclear'], description: 'rtn when the ticket says return / RTN / need to return / incomplete / parts on order; complete when the work described is finished and nothing says return; unclear only when it cannot be told' },
      rtn_needed: { type: ['string', 'null'], description: 'What the return trip is for, as written' },
      manager_signature_visible: { type: 'boolean', description: 'True only if there is a second, distinct signature / name on a customer, manager, supervisor or approved-by line — separate from the technician\'s own. False if unsure.' },
      notes: { type: ['string', 'null'], description: 'Only what a person should double-check: words you could not read, numbers you are unsure of. One short line each. Do not list empty boxes.' },
    },
    required: ['pages', 'front_text', 'parts', 'completion', 'manager_signature_visible'],
  },
}

/**
 * Reading rules. The second half was written from a side-by-side of our first
 * reads against what the crews typed into the Smartsheet ticket tracker for
 * the same tickets (Oct–Nov 2026): every rule there fixes a mistake that was
 * actually made.
 */
const SYSTEM = `You read scanned and photographed field tickets for Rappahannock Petroleum (RPS), a petroleum equipment contractor in Winchester, VA: gas station service calls and construction work at 7-Eleven, Sunoco, Wawa, Sheetz and Global sites. A technician fills in the paper ticket by hand, photographs both sides, and emails it in with pictures of the job.

Transcribe what is written, exactly as written. Do not paraphrase, tidy up wording, or add anything that is not on the page. Keep the tech's own spelling. Sort every attachment into its kind, put the front of the ticket in front_text, the back / parts list in back_text, and list the parts.

How these tickets are written:
- On-site time is written "OS" or "O.S." followed by start-end-hours and the crew: "OS 11:30-13:00-1.5 x2" means on site 11:30 to 13:00, 1.5 hours, 2 men. "OS" is never "05". Times are 24-hour; minutes are 00, 15, 30 or 45 and hours are in quarter steps (.25 .5 .75). If you read "13:95", it is "13:45".
- Crew ticket email subjects carry the same numbers: "SU-597 1.75 (X2)" = site SU-597, 1.75 hours, 2 men; "40013 11:30-12:15-.75x2". Use the subject to settle a digit you cannot read on the page.
- Dates are in the current year and within a few days before the email date given below. Written "10/29/26" is October 29, 2026 — never 2016, 2020, 2024 or 2025. If the day you read is after the email date, you misread it: read again.
- Fuel grades and equipment are abbreviations. They are: RUL (regular), PUL (premium, never "PVL" or "POL"), MID, DSL (diesel, never "OSL"), KERO, DEF, E85; STP (submersible pump), UDC (under-dispenser containment), ATG (tank gauge, never "AT6"), VR / Veeder-Root, PLLD, MAG sensor, LD (leak detector), CNI, SB (spill bucket), FRP, shear valve, drop tube, drain valve, swivel, breakaway, whip hose, functional element, check valve, manhole, riser, Fibrelite lid / skirt, DOT barrel, W&M (weights and measures), P1…P16 = pump / fueling position, DSP = dispenser.
- Part numbers start with a vendor prefix: GRD-, VDR-, GIL-, OPW, FIL-, IRF-, IAC-, FSA-, EMCO, RJ. Copy every character; do not guess a digit — if one is unclear put the number in notes.
- Sites: 7-Eleven stores are 5 digits (often written "7/11 33962"); Sunoco is SU-#### ; Wawa is 3 or 4 digits; Global is "Global #####". Work orders: WOT + 7 digits (7-Eleven), FWKD + 7 digits (Wawa), INC + 8 digits.
- Mechanic / helper boxes hold initials. Match them, and the signature, to the staff list below and give the full name. If nothing matches, give what is written; never invent a name from a scrawled signature.
- A second ticket page with a list of items, quantities or part numbers is the back of the ticket even if it is on plain paper.
- If a "ticket tracker entry" is given below, it is what the same crew typed for this visit. Use it only to decide between readings of handwriting you are unsure of. The ticket itself is the record: where the two differ in substance, transcribe the ticket and say so in notes.

Return only the record_ticket tool call.`

type Att = { name: string; mime: string; path: string; size: number }

function mediaTypeFor(att: { name: string; mime: string }): 'pdf' | 'image' | null {
  const m = (att.mime ?? '').toLowerCase(), n = (att.name ?? '').toLowerCase()
  if (m === 'application/pdf' || n.endsWith('.pdf')) return 'pdf'
  if (/^image\//.test(m) || /\.(jpe?g|png|gif|webp|heic|heif|tiff?|bmp)$/.test(n)) return 'image'
  return null
}

/** Turn any photo upright, shrink it and re-save as JPEG so it is always inside the reader's size limit. */
async function preparePhoto(buf: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(buf, { failOn: 'none' }).rotate()
      .resize({ width: PHOTO_EDGE, height: PHOTO_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 }).toBuffer()
  } catch {
    return null   // a format sharp cannot open (some HEIC) — the page is skipped and named in the notes
  }
}

export type TicketExtracted = {
  pages?: TicketPage[]
  front_text?: string | null
  back_text?: string | null
  other_text?: string | null
  parts?: TicketPart[]
  wo_number?: string | null
  site?: string | null
  work_date?: string | null
  technician_name?: string | null
  helper?: string | null
  truck?: string | null
  onsite_hours?: number | null
  crew_size?: number | null
  completion?: 'complete' | 'rtn' | 'unclear'
  rtn_needed?: string | null
  manager_signature_visible: boolean
  notes: string | null
  /** front + back + other pages as one block — what the review box is pre-filled with */
  transcript: string
  model?: string
  version?: number
  unread_pages?: string[]
}

const clean = (s: unknown): string | null => {
  const t = typeof s === 'string' ? s.trim() : ''
  return t && !/^(null|n\/?a|none)$/i.test(t) ? t : null
}

export function composeTranscript(x: { front_text?: string | null; back_text?: string | null; other_text?: string | null }): string {
  const parts: string[] = []
  if (clean(x.front_text)) parts.push(clean(x.front_text)!)
  if (clean(x.back_text)) parts.push(`--- BACK OF TICKET / PARTS ---\n${clean(x.back_text)}`)
  if (clean(x.other_text)) parts.push(`--- OTHER PAGES ---\n${clean(x.other_text)}`)
  return parts.join('\n\n')
}

/** Site digits used to find the crew's tracker entry: "SU-2333 10:15-18:00" -> 2333, "7/11 33962" -> 33962. */
export function siteKeys(...texts: (string | null | undefined)[]): string[] {
  const out = new Set<string>()
  for (const t of texts) {
    if (!t) continue
    for (const m of t.matchAll(/(?:su[-\s]?|global\s*|wawa\s*|sheetz\s*|7[-/]?(?:11|eleven)\s*#?)?(\d{3,5})(?![\d:.])/gi)) {
      // skip clock times and hours ("11:30", "1.75") — the lookahead drops "11:" and the test below drops "1.75"
      const i = m.index! + m[0].length - m[1].length
      if (t[i - 1] === ':' || t[i - 1] === '.') continue
      out.add(m[1])
    }
  }
  return [...out]
}

function validDate(s: unknown, received: Date): string | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T12:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null
  // A ticket is written before it is emailed and rarely more than a few weeks before.
  const days = (received.getTime() - d.getTime()) / 86_400_000
  if (days < -2 || days > 45) {
    // Right month and day, wrong year is the usual misread — try the email's year.
    const fixed = `${received.getUTCFullYear()}${s.slice(4)}`
    const fd = new Date(`${fixed}T12:00:00Z`)
    const fdays = (received.getTime() - fd.getTime()) / 86_400_000
    return !Number.isNaN(fd.getTime()) && fdays >= -2 && fdays <= 45 ? fixed : null
  }
  return s
}

/** Run Claude over one document's attachments and store the read. */
export async function extractWorkOrderDocument(docId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient()
  const { data: doc } = await admin.from('svc_work_order_documents').select('*').eq('id', docId).single()
  if (!doc) return { ok: false, error: 'not found' }
  const fail = async (status: 'failed' | 'skipped', error: string) => {
    await admin.from('svc_work_order_documents').update({ extract_status: status, extract_error: error.slice(0, 500) }).eq('id', docId)
    return { ok: false, error }
  }
  if (!process.env.ANTHROPIC_API_KEY) return fail('failed', 'ANTHROPIC_API_KEY is not set')

  // A forwarded copy of a ticket already on file takes the original's read instead of paying for a second one.
  if (doc.duplicate_of) {
    const { data: orig } = await admin.from('svc_work_order_documents').select('*').eq('id', doc.duplicate_of).single()
    if (orig && orig.extract_status === 'done' && orig.extract_version >= TICKET_EXTRACT_VERSION) {
      await admin.from('svc_work_order_documents').update({
        extracted: orig.extracted, extract_status: 'done', extract_error: null, extract_version: orig.extract_version,
        front_text: orig.front_text, back_text: orig.back_text, other_text: orig.other_text, parts: orig.parts,
        ticket_wo_number: orig.ticket_wo_number, ticket_site: orig.ticket_site, work_date: orig.work_date,
        technician: orig.technician, helper: orig.helper, truck: orig.truck, onsite_hours: orig.onsite_hours, crew_size: orig.crew_size,
        completion: orig.completion, rtn_needed: orig.rtn_needed, tracker_row_id: orig.tracker_row_id,
        work_order_id: doc.work_order_id ?? orig.work_order_id, con_job_id: doc.con_job_id ?? orig.con_job_id,
        ...(doc.status === 'new' ? { transcript: orig.transcript, status: 'needs_review' } : {}),
      }).eq('id', docId)
      return { ok: true }
    }
    if (orig && orig.extract_status === 'pending') return { ok: false, error: 'waiting for the original' }
  }

  const all = (doc.attachments as Att[]).map(a => ({ a, kind: mediaTypeFor(a) })).filter(x => x.kind)
  if (!all.length) return fail('skipped', 'No readable attachment (PDF or photo) — type up the ticket by hand.')
  // PDFs first (a scanned ticket), then photos in the order sent.
  const atts = [...all.filter(x => x.kind === 'pdf'), ...all.filter(x => x.kind === 'image')].slice(0, MAX_PAGES)

  const content: Anthropic.ContentBlockParam[] = []
  const unread: string[] = all.slice(atts.length).map(x => x.a.name)
  let budget = 24 * 1024 * 1024
  for (const { a, kind } of atts) {
    const { data, error } = await admin.storage.from(WORK_ORDER_DOCS_BUCKET).download(a.path)
    if (error || !data) { unread.push(a.name); continue }
    let buf: Buffer = Buffer.from(await data.arrayBuffer())
    if (kind === 'image') {
      const small = await preparePhoto(buf)
      if (!small) { unread.push(a.name); continue }
      buf = small
    }
    if (buf.length > budget) { unread.push(a.name); continue }
    budget -= buf.length
    content.push({ type: 'text', text: `Attachment: ${a.name}` })
    if (kind === 'pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } })
    else content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } })
  }
  if (!content.length) return fail('skipped', 'Could not open any attachment for reading — type up the ticket by hand.')

  // Context the reader needs: who works here, when it was emailed, and what the crew typed for the same visit.
  const received = doc.received_at ? new Date(doc.received_at) : new Date()
  const [{ data: techs }, { data: people }] = await Promise.all([
    admin.from('svc_technicians').select('full_name').eq('company_id', doc.company_id).eq('is_active', true),
    admin.from('profiles').select('full_name').eq('company_id', doc.company_id),
  ])
  const staff = [...new Set([...(techs ?? []), ...(people ?? [])].map(p => (p.full_name ?? '').trim()).filter(n => n.includes(' ')))].sort()

  let tracker: { smartsheet_row_id: number; work_date: string | null; site: string | null; technicians: string | null; onsite_hours: number | null; description: string | null; parts: string | null; status: string | null } | null = null
  const keys = siteKeys(doc.subject)
  if (keys.length) {
    const from = new Date(received.getTime() - 4 * 86_400_000).toISOString().slice(0, 10)
    const { data: rows } = await admin.from('ticket_tracker_entries')
      .select('smartsheet_row_id, work_date, site, technicians, onsite_hours, description, parts, status')
      .eq('company_id', doc.company_id).in('site_key', keys).gte('work_date', from).lte('work_date', received.toISOString().slice(0, 10))
      .order('work_date', { ascending: false })
    // Several visits to one site in the window: the hours in the subject ("… 2.5x2") pick the right one.
    const hrs = [...(doc.subject ?? '').matchAll(/(?<![\d:])(\d{0,2}\.\d{1,2}|\d{1,2})(?=\s*\(?\s*x\s*\d|\s*$)/gi)].map(m => parseFloat(m[1]))
    tracker = (rows ?? []).find(r => r.onsite_hours != null && hrs.includes(Number(r.onsite_hours))) ?? ((rows ?? []).length === 1 ? rows![0] : null)
  }

  content.push({
    type: 'text',
    text: [
      `Email subject: ${doc.subject ?? ''}`,
      `From: ${doc.sender ?? ''} <${doc.sender_email ?? ''}>`,
      `Email date: ${received.toISOString().slice(0, 10)}`,
      staff.length ? `Staff list: ${staff.join('; ')}` : '',
      tracker ? `Ticket tracker entry typed by the crew for ${tracker.site} on ${tracker.work_date}: techs ${tracker.technicians ?? '—'}; on-site ${tracker.onsite_hours ?? '—'} h; work: ${tracker.description ?? '—'}; parts: ${tracker.parts ?? '—'}; status: ${tracker.status ?? '—'}` : '',
      '',
      'Read this ticket with record_ticket.',
    ].filter(l => l !== '').join('\n'),
  })

  const client = new Anthropic()
  const call = (model: string) => client.messages.create({ model, max_tokens: 8000, system: SYSTEM, tools: [RECORD_TOOL], tool_choice: { type: 'tool', name: 'record_ticket' }, messages: [{ role: 'user', content }] })
  let model = EXTRACT_MODEL
  let response: Anthropic.Message
  try {
    try { response = await call(model) }
    catch (e) {
      const msg = (e as Error).message
      if (/not_found|model/i.test(msg) && model !== FALLBACK_MODEL) { model = FALLBACK_MODEL; response = await call(model) } else throw e
    }
  } catch (e) {
    return fail('failed', (e as Error).message)
  }

  const tool = response.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined
  if (!tool) return fail('failed', 'Model returned no record')
  const raw = tool.input as Omit<TicketExtracted, 'transcript'>

  const parts: TicketPart[] = (Array.isArray(raw.parts) ? raw.parts : [])
    .map(p => ({ qty: typeof p?.qty === 'number' ? p.qty : null, description: clean(p?.description) ?? '', part_number: clean(p?.part_number), source: clean(p?.source) }))
    .filter(p => p.description || p.part_number)
  const pages: TicketPage[] = (Array.isArray(raw.pages) ? raw.pages : [])
    .map(p => ({ name: String(p?.name ?? ''), kind: (PAGE_KINDS as readonly string[]).includes(p?.kind) ? p.kind : 'other', note: clean(p?.note) }))
  const transcript = composeTranscript(raw)
  const notes = [clean(raw.notes), unread.length ? `Not read (too many pages or could not open): ${unread.join(', ')}` : null].filter(Boolean).join('\n') || null
  const extracted: TicketExtracted = { ...raw, parts, pages, notes, transcript, model, version: TICKET_EXTRACT_VERSION, unread_pages: unread }

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100 ? v : null)
  const updates: Record<string, unknown> = {
    extracted, extract_status: 'done', extract_error: null, extract_version: TICKET_EXTRACT_VERSION,
    front_text: clean(raw.front_text), back_text: clean(raw.back_text), other_text: clean(raw.other_text),
    parts, pages,
    ticket_wo_number: clean(raw.wo_number), ticket_site: clean(raw.site),
    work_date: validDate(raw.work_date, received),
    technician: clean(raw.technician_name), helper: clean(raw.helper), truck: clean(raw.truck),
    onsite_hours: num(raw.onsite_hours), crew_size: num(raw.crew_size) == null ? null : Math.round(num(raw.crew_size)!),
    completion: ['complete', 'rtn', 'unclear'].includes(raw.completion as string) ? raw.completion : 'unclear',
    rtn_needed: clean(raw.rtn_needed),
    tracker_row_id: tracker?.smartsheet_row_id ?? null,
  }
  // The editable transcript is only replaced while nobody has touched it: on the
  // first read, or on a re-read when it still equals the previous draft.
  const previousDraft = (doc.extracted as { transcript?: string } | null)?.transcript ?? null
  if (doc.status === 'new' || !doc.transcript || doc.transcript === previousDraft) updates.transcript = transcript || null
  if (doc.status === 'new') updates.status = 'needs_review'

  // Tie it to its call when the email subject did not carry the work order number but the ticket does.
  if (!doc.work_order_id && updates.ticket_wo_number) {
    const wo = String(updates.ticket_wo_number).match(/(WOT\d{6,8}|FWKD\d{6,8}|INC\d{7,9})/i)?.[1]
    if (wo) {
      const { data: w } = await admin.from('svc_work_orders').select('id').eq('company_id', doc.company_id)
        .or(`portal_wo_number.ilike.${wo},incident_number.ilike.${wo}`).limit(1).maybeSingle()
      if (w) updates.work_order_id = w.id
    }
  }

  const { error: saveErr } = await admin.from('svc_work_order_documents').update(updates).eq('id', docId)
  if (saveErr) return fail('failed', `Could not save the read: ${saveErr.message}`)
  return { ok: true }
}

/**
 * Read pending documents, newest first (so today's tickets are never stuck behind a backlog), a few at a
 * time side by side, stopping before the route's time limit. Anything not reached stays pending for the next run.
 */
export async function extractPendingWorkOrderDocuments(limit = 5, opts: { concurrency?: number; budgetMs?: number } = {}): Promise<{ processed: number; ok: number; errors: string[]; remaining: number }> {
  const admin = createAdminClient()
  const started = Date.now()
  const budgetMs = opts.budgetMs ?? 38_000
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 3, 8))
  // Originals before their forwarded copies, so a copy can take the original's read.
  const { data: pending } = await admin.from('svc_work_order_documents').select('id, duplicate_of')
    .eq('extract_status', 'pending').order('received_at', { ascending: false }).limit(limit * 3)
  const queue = [...(pending ?? []).filter(r => !r.duplicate_of), ...(pending ?? []).filter(r => r.duplicate_of)].slice(0, limit)
  const out = { processed: 0, ok: 0, errors: [] as string[], remaining: 0 }
  const worker = async () => {
    for (;;) {
      if (Date.now() - started > budgetMs) return
      const row = queue.shift()
      if (!row) return
      out.processed++
      const r = await extractWorkOrderDocument(row.id).catch(e => ({ ok: false, error: (e as Error).message }))
      if (r.ok) out.ok++
      else if (r.error && r.error !== 'waiting for the original') out.errors.push(`${row.id}: ${r.error}`)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  const { count } = await admin.from('svc_work_order_documents').select('id', { count: 'exact', head: true }).eq('extract_status', 'pending')
  out.remaining = count ?? 0
  return out
}
