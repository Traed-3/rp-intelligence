// Historical field-ticket backfill: files a job's real hours/description into
// con_daily_updates from the two Gmail sources Trae validated on a real
// example (WOT0104603 / SU-9901, 2026-09-24):
//   - econstruction.rp@gmail.com typed daily update  -> work description
//   - const.inv.rp@gmail.com handwritten ticket photo -> hours/crew/trucks
// Every row this files lands as review_status='needs_review' — per Trae's
// explicit rule that a ticket transcription is a draft until a human
// confirms it (same principle as the Service ticket signature flow), never
// auto-trusted into billing. Confirming happens via confirmFieldTicketDraft()
// in app/(app)/construction/actions.ts, the same 'filed'/'needs_review'
// vocabulary con_documents already uses.
import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'construction-docs'

export type TechEntry = { name: string; initials?: string | null; onsite_hours: number }

export type TripFeeCalc = {
  rateCardName: string | null
  perTechFee: number | null
  afterHours: boolean
  techCount: number
  total: number | null
  note: string
}

export type EquipmentFeeFlag = {
  applies: boolean | null // null = ask, don't assume
  amount: number
  reason: string
}

export type FieldTicketDraftInput = {
  companyId: string
  jobId: string
  workDate: string // YYYY-MM-DD
  description: string
  techs: TechEntry[]
  trucks: string[]
  afterHours?: boolean
  equipmentFee?: EquipmentFeeFlag
  crossCheckNotes?: string[]
  pendingCorrectionNote?: string
  sourceRefs: Record<string, string | undefined>
  attachments?: { bytes: Uint8Array; filename: string; mimeType: string; kind: 'daily_ticket' | 'photo' }[]
}

export type FieldTicketDraftResult =
  | { status: 'filed'; dailyUpdateId: string }
  | { status: 'duplicate'; dailyUpdateId: string }
  | { status: 'error'; error: string }

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
}

/** Trip fee is per Trae's explicit rule: onsite hours are NOT summed into a
 * total — only actual onsite time per tech, plus one flat trip fee PER TECH
 * (not per ticket). Sourced from billing_rate_cards.trip_fee_flat, keyed off
 * the job's gas_brand — never invented if the brand has no rate-card row. */
export async function calcTripFee(admin: SupabaseClient, companyId: string, gasBrand: string | null, techCount: number, afterHours: boolean): Promise<TripFeeCalc> {
  if (!gasBrand) return { rateCardName: null, perTechFee: null, afterHours, techCount, total: null, note: 'Job has no gas brand set — cannot look up a trip fee. Ask Trae.' }
  const { data: card } = await admin.from('billing_rate_cards')
    .select('name, trip_fee_flat, trip_fee_flat_afterhours')
    .eq('company_id', companyId).ilike('name', gasBrand).maybeSingle()
  if (!card) return { rateCardName: gasBrand, perTechFee: null, afterHours, techCount, total: null, note: `No rate card found for brand "${gasBrand}" — ask Trae for the trip fee before billing.` }
  const fee = afterHours ? (card.trip_fee_flat_afterhours ?? null) : (card.trip_fee_flat ?? null)
  if (fee == null) return { rateCardName: card.name, perTechFee: null, afterHours, techCount, total: null, note: `${card.name} has no ${afterHours ? 'after-hours ' : ''}flat trip fee on file — ask Trae before billing.` }
  return { rateCardName: card.name, perTechFee: fee, afterHours, techCount, total: fee * techCount, note: `${techCount} tech${techCount === 1 ? '' : 's'} x $${fee.toFixed(2)}${afterHours ? ' (after-hours)' : ''} = $${(fee * techCount).toFixed(2)}` }
}

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function buildBillingPreview(input: FieldTicketDraftInput, trip: TripFeeCalc): string {
  const lines: string[] = ['BILLING PREVIEW (draft — confirm before invoicing)']
  for (const t of input.techs) lines.push(`  ${t.name}${t.initials ? ` (${t.initials})` : ''} — ${t.onsite_hours} hr onsite`)
  lines.push(`  Trip fee: ${trip.note}`)
  if (input.equipmentFee) {
    lines.push(input.equipmentFee.applies === null
      ? `  Equipment fee: NEEDS CONFIRMATION — ${input.equipmentFee.reason}. Apply ${money(input.equipmentFee.amount)}?`
      : input.equipmentFee.applies
        ? `  Equipment fee: ${money(input.equipmentFee.amount)} — ${input.equipmentFee.reason}`
        : `  Equipment fee: not applied — ${input.equipmentFee.reason}`)
  }
  if (input.trucks.length) lines.push(`  Trucks: ${input.trucks.join(', ')}`)
  if (input.crossCheckNotes?.length) { lines.push('  Cross-check:'); for (const n of input.crossCheckNotes) lines.push(`    - ${n}`) }
  if (input.pendingCorrectionNote) lines.push(`  PENDING CORRECTION: ${input.pendingCorrectionNote}`)
  return lines.join('\n')
}

/**
 * Files one job-day's backfilled record. Idempotent: if a con_daily_updates
 * row already exists for this job+date with the same ticket_message_id in
 * source_refs, it's returned as 'duplicate' rather than filed again.
 */
export async function fileFieldTicketDraft(admin: SupabaseClient, input: FieldTicketDraftInput): Promise<FieldTicketDraftResult> {
  try {
    const ticketMsgId = input.sourceRefs.ticket_message_id
    if (ticketMsgId) {
      const { data: existing } = await admin.from('con_daily_updates')
        .select('id').eq('job_id', input.jobId).eq('work_date', input.workDate)
        .contains('source_refs', { ticket_message_id: ticketMsgId }).maybeSingle()
      if (existing) return { status: 'duplicate', dailyUpdateId: existing.id }
    }

    const { data: job } = await admin.from('con_jobs').select('gas_brand').eq('id', input.jobId).single()
    const trip = await calcTripFee(admin, input.companyId, job?.gas_brand ?? null, input.techs.length, !!input.afterHours)
    const notes = buildBillingPreview(input, trip)

    const { data: du, error: duErr } = await admin.from('con_daily_updates').insert({
      company_id: input.companyId, job_id: input.jobId, work_date: input.workDate,
      work_description: input.description, notes,
      review_status: 'needs_review', source: 'gmail_backfill', source_refs: input.sourceRefs,
    }).select('id').single()
    if (duErr || !du) return { status: 'error', error: duErr?.message ?? 'insert failed' }

    if (input.techs.length) {
      const { error: techErr } = await admin.from('con_daily_update_techs').insert(
        input.techs.map(t => ({ company_id: input.companyId, daily_update_id: du.id, tech_name: t.name, initials: t.initials ?? null, hours: t.onsite_hours })),
      )
      if (techErr) return { status: 'error', error: techErr.message }
    }

    for (const a of input.attachments ?? []) {
      const path = `${input.companyId}/${input.jobId}/daily/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName(a.filename)}`
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, a.bytes, { contentType: a.mimeType, upsert: true })
      if (upErr) return { status: 'error', error: `attachment upload: ${upErr.message}` }
      const { data: doc } = await admin.from('con_documents').insert({
        company_id: input.companyId, job_id: input.jobId, daily_update_id: du.id,
        file_name: a.filename, original_filename: a.filename, storage_path: path,
        category: a.kind === 'daily_ticket' ? 'daily_updates' : 'photos', doc_type: a.kind,
        review_status: 'filed',
      }).select('id').single()
      if (a.kind === 'daily_ticket' && doc) {
        await admin.from('con_daily_updates').update({ ticket_storage_path: path, ticket_document_id: doc.id }).eq('id', du.id)
      }
    }

    return { status: 'filed', dailyUpdateId: du.id }
  } catch (e) {
    return { status: 'error', error: (e as Error).message }
  }
}
