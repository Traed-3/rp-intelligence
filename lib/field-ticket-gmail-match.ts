// Matches a job's handwritten field tickets to their typed daily updates
// (econstruction), OCRs the ticket with Claude, and files a review-required
// draft via fileFieldTicketDraft(). Reads the already-connected `rpinvoicing`
// inbox for the tickets themselves — techs address them to
// const.inv.rp@gmail.com, but that mailbox has Gmail's own "Forward a copy of
// incoming mail to rpinvoicing@gmail.com" rule turned on (confirmed
// 2026-09-26), so every ticket + its photos already lands in rpinvoicing the
// instant it's sent. No separate const.inv.rp connection/token is needed.
// (rpinvoicing sometimes also carries a SECOND copy — someone manually
// re-forwarding the same ticket to themselves to file it under the matching
// Sunoco/portal work-order thread — the dedup below, keyed by day + normalized
// subject, collapses that back down to one.)
//
// Two-source design Trae validated on a real example (WOT0104603/SU-9901,
// 2026-09-24): the typed econstruction update is the description source (a
// tech's handwriting is unreliable — Vac Truck read as HVAC, "product line"
// as "pocket line", etc. on first pass); the ticket photo is the
// hours/crew/trucks source, cross-checked against the ticket's own subject
// line. Every filed row is a draft (`needs_review`) until a human confirms it.
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { listMessages, getMessage, getAttachment, listAttachments, header, extractText } from '@/lib/billing-gmail-client'
import { fileFieldTicketDraft, type FieldTicketDraftInput } from '@/lib/field-ticket-backfill'

const EXTRACT_MODEL = process.env.BILLING_EXTRACT_MODEL ?? 'claude-sonnet-5'
const FALLBACK_MODEL = 'claude-sonnet-4-6'

// Trucks known to be specialized equipment that triggers the $550 equipment
// fee question (never auto-applied — always surfaced for Trae to confirm).
// Add to this as more are identified.
const EQUIPMENT_TRUCKS: Record<string, string> = {
  LL12: '"the Rig" — a truck that permanently pulls a skidsteer with a breaker and bucket attachment',
}

const TICKET_TOOL: Anthropic.Tool = {
  name: 'record_field_ticket',
  description: 'Transcribe the handwritten RAPPAHANNOCK PETROLEUM LLC / JOB WORK ORDER ticket exactly as written.',
  input_schema: {
    type: 'object',
    properties: {
      techs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Tech name or initials as signed/written on the ticket' },
            onsite_hours: { type: 'number', description: 'Actual onsite time for this tech only — never a running total' },
          },
          required: ['name', 'onsite_hours'],
        },
      },
      trucks: { type: 'array', items: { type: 'string' }, description: 'Truck/equipment codes near the printed JOB WORK ORDER title (e.g. Q17, LL12) — read carefully, these are RPS asset codes, not random letters' },
      subject_line_hours: { type: ['number', 'null'], description: 'The OS: line (e.g. "OS: 8-12:30-4.5(x2)") hours value, for cross-checking against the tech hours above' },
      subject_line_crew: { type: ['number', 'null'], description: 'The (x<crew>) count from the OS: line' },
      ticket_scope_notes: { type: ['string', 'null'], description: 'Any handwritten Description of Work text on the ticket — for cross-checking against the typed update only, not as the primary description' },
      illegible: { type: 'boolean', description: 'true if the ticket is too illegible to transcribe with confidence' },
    },
    required: ['techs', 'trucks'],
  },
}

const TICKET_SYSTEM = `You transcribe handwritten RPS (Rappahannock Petroleum) field tickets — fuel dispenser/tank/UST work. Read carefully; these terms are easy to misread on messy handwriting:
- "Vac Truck" (a vacuum excavation truck) — NOT "HVAC truck" (RPS has no HVAC scope).
- "Product line" (underground fuel piping) — NOT "pocket line".
- "Boot" (a containment/sealing fitting) — NOT "duct".
- "STP bow" (a bend in the submersible turbine pump riser) — NOT "STP flow".
- "prepped" — NOT "piped".
- Truck/equipment codes near the printed title (e.g. Q17, LL12) are RPS asset codes — transcribe them exactly, do not drop or guess-correct them.
Never invent a number or a name you cannot read; use null/omit and set illegible if genuinely unclear. Return only the record_field_ticket tool call.`

function ymdInET(internalDate: string | undefined): string {
  const d = internalDate ? new Date(Number(internalDate)) : new Date()
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function isWeekendET(ymd: string): boolean {
  const day = new Date(`${ymd}T12:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

export type MatchResult = {
  workDate: string
  ticketMessageId: string
  status: 'filed' | 'duplicate' | 'error' | 'no_matching_update' | 'illegible'
  detail: string
  dailyUpdateId?: string
}

export type JobBackfillSummary = { jobId: string; siteNumber: string | null; ticketsFound: number; results: MatchResult[] }

/** A ticket's real subject convention always carries a "(x<crew>)" count —
 * the Sunoco/portal dispatch notices sharing this inbox never do, so this is
 * what tells a real field ticket apart from the rest of rpinvoicing's traffic. */
const TICKET_SUBJECT = /\(x\d+\)/i

function normalizeSubject(s: string): string {
  return s.replace(/^(fwd|fw|re)\s*:\s*/i, '').trim().toLowerCase()
}

/**
 * Finds every field ticket for this job's site number, pairs each with its
 * same-day econstruction typed update, OCRs the ticket, and files a draft.
 * Dry-run by default (apply=false) — reports what it WOULD file without
 * calling fileFieldTicketDraft, since a ticket OCR should be reviewed before
 * the first real run for a new job, same as the permit-email backfill.
 */
export async function backfillFieldTicketsForJob(jobId: string, opts: { apply?: boolean } = {}): Promise<JobBackfillSummary> {
  const admin = createAdminClient()
  const { data: job } = await admin.from('con_jobs').select('id, company_id, site_number, work_order_number, gas_brand').eq('id', jobId).single()
  if (!job) return { jobId, siteNumber: null, ticketsFound: 0, results: [{ workDate: '', ticketMessageId: '', status: 'error', detail: 'job not found' }] }
  if (!job.site_number) return { jobId, siteNumber: null, ticketsFound: 0, results: [{ workDate: '', ticketMessageId: '', status: 'error', detail: 'job has no site_number to search by' }] }

  const rawIds = await listMessages('rpinvoicing', job.site_number, 100)
  // Same-day tickets can arrive twice — the instant Gmail auto-forward from
  // const.inv.rp, and sometimes a second, later self-forward to file it under
  // the matching work-order thread. Keep only the earliest per (day, normalized
  // subject) so it's never filed twice under two different message ids.
  const seen = new Map<string, { id: string; subject: string; internalDate: string }>()
  for (const id of rawIds) {
    const msg = await getMessage('rpinvoicing', id)
    const subject = header(msg, 'Subject')
    // Same false-positive class caught in the permit backfill: Gmail matches
    // a term anywhere in the thread, not just this message's own subject.
    if (!subject.includes(job.site_number) || !TICKET_SUBJECT.test(subject)) continue
    const key = `${ymdInET(msg.internalDate)}|${normalizeSubject(subject)}`
    const existing = seen.get(key)
    if (!existing || Number(msg.internalDate ?? 0) < Number(existing.internalDate ?? 0)) {
      seen.set(key, { id, subject, internalDate: msg.internalDate ?? '0' })
    }
  }

  const results: MatchResult[] = []
  let ticketsFound = 0

  for (const { id, subject } of seen.values()) {
    const msg = await getMessage('rpinvoicing', id)
    ticketsFound++
    const workDate = ymdInET(msg.internalDate)

    const atts = listAttachments(msg).filter(a => /^image\//i.test(a.mimeType))
    if (!atts.length) { results.push({ workDate, ticketMessageId: id, status: 'error', detail: `"${subject}" has no photo attachment` }); continue }
    const [ticketPhoto, ...extraPhotos] = atts

    // Same-day typed update from econstruction, filtered by the same
    // subject-must-contain-the-site-number rule.
    const updateIds = await listMessages('econstruction', `${job.site_number} update`, 20)
    let updateMsg: Awaited<ReturnType<typeof getMessage>> | null = null
    for (const uid of updateIds) {
      const um = await getMessage('econstruction', uid)
      const usubject = header(um, 'Subject')
      if (!usubject.includes(job.site_number) || !/update/i.test(usubject)) continue
      if (ymdInET(um.internalDate) !== workDate) continue
      updateMsg = um
      break
    }
    if (!updateMsg) {
      results.push({ workDate, ticketMessageId: id, status: 'no_matching_update', detail: `No econstruction "${job.site_number} update" found for ${workDate} — description would need a human read of the ticket photo.` })
      continue
    }
    const description = extractText(updateMsg).trim()
    const updatePhotoAtts = listAttachments(updateMsg).filter(a => /^image\//i.test(a.mimeType)).slice(0, 4)

    const ticketBytes = await getAttachment('rpinvoicing', id, ticketPhoto.attachmentId)
    const ocr = await ocrTicket(ticketBytes, ticketPhoto.mimeType, subject)
    if (!ocr || ocr.illegible) { results.push({ workDate, ticketMessageId: id, status: 'illegible', detail: `Ticket photo for "${subject}" could not be confidently transcribed — file it by hand.` }); continue }

    const crossCheckNotes: string[] = []
    const ticketHours = ocr.techs.reduce((s, t) => s + t.onsite_hours, 0)
    if (ocr.subject_line_hours != null && Math.abs(ticketHours - ocr.subject_line_hours) > 0.26) {
      crossCheckNotes.push(`Ticket hours (${ticketHours}) do not match the subject-line hours (${ocr.subject_line_hours}) — verify.`)
    }
    if (ocr.subject_line_crew != null && ocr.subject_line_crew !== ocr.techs.length) {
      crossCheckNotes.push(`Subject line says crew of ${ocr.subject_line_crew} but the ticket lists ${ocr.techs.length} tech(s) — verify.`)
    }

    const equipmentTruck = ocr.trucks.map(t => t.toUpperCase()).find(t => EQUIPMENT_TRUCKS[t])
    const equipmentFee = equipmentTruck ? { applies: null, amount: 550, reason: `${equipmentTruck} appears on this ticket (${EQUIPMENT_TRUCKS[equipmentTruck]})` } : undefined

    const input: FieldTicketDraftInput = {
      companyId: job.company_id, jobId: job.id, workDate,
      description: description || '(no typed update body — see ticket photo)',
      techs: ocr.techs.map(t => ({ name: t.name, onsite_hours: t.onsite_hours })),
      trucks: ocr.trucks,
      afterHours: isWeekendET(workDate),
      equipmentFee,
      crossCheckNotes: crossCheckNotes.length ? crossCheckNotes : undefined,
      sourceRefs: { ticket_message_id: id, ticket_attachment_id: ticketPhoto.attachmentId, update_message_id: updateMsg.id },
      attachments: opts.apply ? [
        { bytes: ticketBytes, filename: ticketPhoto.filename, mimeType: ticketPhoto.mimeType, kind: 'daily_ticket' },
        ...await Promise.all(extraPhotos.map(async a => ({ bytes: await getAttachment('rpinvoicing', id, a.attachmentId), filename: a.filename, mimeType: a.mimeType, kind: 'photo' as const }))),
        ...await Promise.all(updatePhotoAtts.map(async a => ({ bytes: await getAttachment('econstruction', updateMsg!.id, a.attachmentId), filename: a.filename, mimeType: a.mimeType, kind: 'photo' as const }))),
      ] : undefined,
    }

    if (!opts.apply) {
      results.push({ workDate, ticketMessageId: id, status: 'filed', detail: `DRY RUN — would file: ${input.techs.map(t => `${t.name} ${t.onsite_hours}h`).join(', ')}${equipmentTruck ? ` · equipment fee? (${equipmentTruck})` : ''}${crossCheckNotes.length ? ` · ${crossCheckNotes.join(' ')}` : ''}` })
      continue
    }
    const filed = await fileFieldTicketDraft(admin, input)
    if (filed.status === 'error') results.push({ workDate, ticketMessageId: id, status: 'error', detail: filed.error })
    else results.push({ workDate, ticketMessageId: id, status: filed.status, detail: filed.status, dailyUpdateId: filed.dailyUpdateId })
  }

  return { jobId, siteNumber: job.site_number, ticketsFound, results }
}

type TicketOcr = {
  techs: { name: string; onsite_hours: number }[]
  trucks: string[]
  subject_line_hours?: number | null
  subject_line_crew?: number | null
  ticket_scope_notes?: string | null
  illegible?: boolean
}

async function ocrTicket(bytes: Buffer, mimeType: string, subject: string): Promise<TicketOcr | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const media = /png/i.test(mimeType) ? 'image/png' : /gif/i.test(mimeType) ? 'image/gif' : /webp/i.test(mimeType) ? 'image/webp' : 'image/jpeg'
  const content: Anthropic.ContentBlockParam[] = [
    { type: 'image', source: { type: 'base64', media_type: media, data: bytes.toString('base64') } },
    { type: 'text', text: `Ticket email subject: ${subject}\n\nTranscribe this ticket with record_field_ticket.` },
  ]
  const client = new Anthropic()
  const call = (model: string) => client.messages.create({ model, max_tokens: 2000, system: TICKET_SYSTEM, tools: [TICKET_TOOL], tool_choice: { type: 'tool', name: 'record_field_ticket' }, messages: [{ role: 'user', content }] })
  let response: Anthropic.Message
  try {
    try { response = await call(EXTRACT_MODEL) }
    catch (e) {
      if (/not_found|model/i.test((e as Error).message)) response = await call(FALLBACK_MODEL)
      else throw e
    }
  } catch {
    return null
  }
  const tool = response.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined
  return (tool?.input as TicketOcr) ?? null
}
