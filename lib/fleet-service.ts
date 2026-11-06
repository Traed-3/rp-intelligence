/**
 * Keep a vehicle's maintenance dates in step with completed shop work.
 *
 * The shop reports finished oil changes as "T20 OCD … / Complete 334,286" and
 * finished state inspections as "Complete truck inspected". Until now those
 * emails only became tickets — the truck's "last oil change" and "inspection
 * due" never moved, so the maintenance pages kept showing them overdue and the
 * auto-ticket job kept re-opening "Oil Change — T20" / "State Inspection — H8".
 *
 * applyCompletedWork() is called whenever a ticket is completed (email sync,
 * status buttons, "complete" comments). It only ever moves dates FORWARD.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { isOilChangeText, isStateInspectionText, parseServiceMileage } from '@/lib/gmail-parser'

type Admin = ReturnType<typeof createAdminClient>

export interface AppliedWork {
  oilChange: boolean
  inspection: boolean
}

/** Last day of the month, 12 months after the inspection (Virginia stickers run to month end). */
export function nextInspectionDue(inspectedOn: string): string {
  const d = new Date(`${inspectedOn}T12:00:00Z`)
  const end = new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth() + 1, 0))
  return end.toISOString().slice(0, 10)
}

async function maintenanceTypeId(admin: Admin, companyId: string, name: string): Promise<string | null> {
  const { data } = await admin.from('maintenance_types').select('id')
    .eq('company_id', companyId).eq('name', name).maybeSingle()
  return data?.id ?? null
}

/**
 * Record an oil change on the vehicle (record + history + asset fields).
 * Skips silently when the vehicle already shows this oil change or a later one.
 */
export async function applyOilChange(admin: Admin, opts: {
  assetId: string
  companyId: string
  date: string               // YYYY-MM-DD
  mileage: number | null
  ticketId?: string | null
  performedBy?: string | null
  note?: string | null
}): Promise<boolean> {
  const { data: asset } = await admin.from('assets')
    .select('id, current_mileage, last_oil_change_date, last_oil_change_mileage, oil_change_interval_miles')
    .eq('id', opts.assetId).maybeSingle()
  if (!asset) return false

  const lastDate = (asset.last_oil_change_date as string | null) ?? null
  if (lastDate && lastDate >= opts.date) return false
  // A mileage lower than what's on file, or a jump of more than 40,000 miles past the
  // highest known reading, is a typo or a different vehicle — keep the date, drop the miles
  const known = Math.max(asset.last_oil_change_mileage ?? 0, asset.current_mileage ?? 0)
  const miles = opts.mileage != null
    && (asset.last_oil_change_mileage == null || opts.mileage >= asset.last_oil_change_mileage)
    && (known === 0 || opts.mileage <= known + 40_000)
    ? opts.mileage : null

  const { data: rec } = await admin.from('oil_change_records').insert({
    asset_id:     opts.assetId,
    service_date: opts.date,
    mileage:      miles,
    completed_by: opts.performedBy ?? null,
    notes:        (opts.note ?? 'Logged from shop email').slice(0, 1000),
  }).select('id').single()

  const typeId = await maintenanceTypeId(admin, opts.companyId, 'Oil Change')
  const nextDue = miles != null && asset.oil_change_interval_miles ? miles + asset.oil_change_interval_miles : null
  const { data: ev } = await admin.from('maintenance_events').insert({
    company_id:          opts.companyId,
    asset_id:            opts.assetId,
    maintenance_type_id: typeId,
    repair_ticket_id:    opts.ticketId ?? null,
    performed_by:        opts.performedBy ?? null,
    performed_date:      opts.date,
    mileage_at_service:  miles,
    next_due_mileage:    nextDue,
    notes:               (opts.note ?? 'Logged from shop email').slice(0, 1000),
  }).select('id').single()
  if (rec && ev) await admin.from('oil_change_records').update({ maintenance_event_id: ev.id }).eq('id', rec.id)

  const updates: Record<string, unknown> = { last_oil_change_date: opts.date }
  if (miles != null) {
    updates.last_oil_change_mileage = miles
    if (nextDue != null) updates.next_oil_change_mileage = nextDue
    if (asset.current_mileage == null || miles > asset.current_mileage) updates.current_mileage = miles
  }
  await admin.from('assets').update(updates).eq('id', opts.assetId)

  if (miles != null) {
    await admin.from('mileage_entries').insert({
      company_id:   opts.companyId,
      asset_id:     opts.assetId,
      entry_date:   opts.date,
      mileage:      miles,
      source:       'manual',
      notes:        'Oil change (shop email)',
      submitted_by: opts.performedBy ?? null,
    })
  }
  return true
}

/** Move the state-inspection due date forward after a passed inspection. */
export async function applyStateInspection(admin: Admin, opts: {
  assetId: string
  companyId: string
  date: string
  ticketId?: string | null
  performedBy?: string | null
  note?: string | null
}): Promise<boolean> {
  const { data: asset } = await admin.from('assets').select('id, inspection_due_date').eq('id', opts.assetId).maybeSingle()
  if (!asset) return false
  const due = nextInspectionDue(opts.date)
  if (asset.inspection_due_date && asset.inspection_due_date >= due) return false

  const typeId = await maintenanceTypeId(admin, opts.companyId, 'State Inspection')
    ?? await maintenanceTypeId(admin, opts.companyId, 'Inspection')
  await admin.from('maintenance_events').insert({
    company_id:          opts.companyId,
    asset_id:            opts.assetId,
    maintenance_type_id: typeId,
    repair_ticket_id:    opts.ticketId ?? null,
    performed_by:        opts.performedBy ?? null,
    performed_date:      opts.date,
    next_due_date:       due,
    notes:               (opts.note ?? 'Logged from shop email').slice(0, 1000),
  })
  await admin.from('assets').update({ inspection_due_date: due }).eq('id', opts.assetId)
  return true
}

/**
 * A ticket was just completed: if it was an oil change or a state inspection,
 * carry that onto the vehicle. `text` is the completion note (for the mileage).
 */
export async function applyCompletedWork(admin: Admin, ticketId: string, opts: {
  date?: string | null
  text?: string | null
  performedBy?: string | null
  companyId?: string | null   // when given, the ticket must belong to this company
} = {}): Promise<AppliedWork> {
  const out: AppliedWork = { oilChange: false, inspection: false }
  let q = admin.from('repair_tickets')
    .select('id, company_id, asset_id, title, description, completion_notes, date_completed, completed_by, status')
    .eq('id', ticketId)
  if (opts.companyId) q = q.eq('company_id', opts.companyId)
  const { data: t } = await q.maybeSingle()
  if (t && t.status !== 'completed') return out
  if (!t?.asset_id) return out

  const date = opts.date ?? t.date_completed ?? new Date().toISOString().slice(0, 10)
  const note = opts.text ?? t.completion_notes ?? null
  const who = opts.performedBy ?? t.completed_by ?? null

  if (isOilChangeText(t.title ?? '') || /^\s*OCD\b/i.test(note ?? '')) {
    out.oilChange = await applyOilChange(admin, {
      assetId: t.asset_id, companyId: t.company_id, date, ticketId,
      mileage: parseServiceMileage(note ?? '') ?? parseServiceMileage(t.description ?? ''),
      performedBy: who, note: note ? `Ticket: ${t.title}\n${note}` : `Ticket: ${t.title}`,
    })
  }
  const inspected = isStateInspectionText(t.title ?? '') ||
    /\b(?:truck|van|trailer|vehicle)\s+(?:was\s+|is\s+)?inspected\b|\bpassed\b[^.\n]{0,25}\binspection|\b(?:state|va)\s+inspection\s+(?:passed|complete)/i.test(note ?? '')
  if (inspected) {
    out.inspection = await applyStateInspection(admin, {
      assetId: t.asset_id, companyId: t.company_id, date, ticketId, performedBy: who,
      note: note ? `Ticket: ${t.title}\n${note}` : `Ticket: ${t.title}`,
    })
  }
  return out
}
