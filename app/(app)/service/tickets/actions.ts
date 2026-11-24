'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeDocumentTotals } from '@/lib/billing'
import { sellPriceForLine } from '@/lib/inventory'
import { brandFromWorkOrder, buildInvoiceLines, canWriteServiceTickets, rateCardNameForBrand, DEFAULT_SERVICE_TAX } from '@/lib/service-tickets'

export type ActionState = { error?: string; ok?: boolean }

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' && v.trim() ? v.trim() : null }
const num = (fd: FormData, k: string) => { const v = str(fd, k); if (v == null) return null; const n = Number(v.replace(/[$,]/g, '')); return isFinite(n) ? n : null }

async function me() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin.from('profiles').select('id, company_id, role, full_name').eq('id', user.id).single()
  return data
}
function paths(id: string) {
  for (const p of ['/service/tickets', `/service/tickets/${id}`, '/mobile/service-ticket', `/mobile/service-ticket/${id}`]) revalidatePath(p)
}

/** Start a ticket, optionally pre-filled from a Service Dispatch work order. */
export async function createServiceTicket(formData: FormData): Promise<void> {
  const p = await me()
  if (!p || !canWriteServiceTickets(p.role)) return
  const admin = createAdminClient()
  const workOrderId = str(formData, 'work_order_id')
  const mobile = formData.get('from') === 'mobile'

  const { data: tech } = await admin.from('svc_technicians').select('id').eq('company_id', p.company_id).eq('profile_id', p.id).maybeSingle()
  let truck: { id: string } | null = null
  if (tech) ({ data: truck } = await admin.from('stock_locations').select('id').eq('company_id', p.company_id).eq('kind', 'truck').eq('technician_id', tech.id).maybeSingle())
  if (!truck) ({ data: truck } = await admin.from('stock_locations').select('id').eq('company_id', p.company_id).eq('kind', 'truck').eq('assigned_tech', p.id).maybeSingle())

  const row: Record<string, unknown> = { company_id: p.company_id, department: 'service', status: 'open', created_by: p.id, technician_id: tech?.id ?? null, truck_location_id: truck?.id ?? null }
  if (workOrderId) {
    const { data: w } = await admin.from('svc_work_orders').select('*').eq('id', workOrderId).eq('company_id', p.company_id).single()
    if (w) Object.assign(row, {
      work_order_id: w.id, store_number: w.site_number, csr_number: w.portal_wo_number, portal_wo_number: w.portal_wo_number,
      brand: brandFromWorkOrder(w.source_portal, w.client_name),
      site_address: w.site_address, city_state_zip: [w.site_city, w.site_state].filter(Boolean).join(', ') || null,
      problem_reported: w.description || w.subject_raw || null, status: 'dispatched',
      technician_id: row.technician_id ?? w.assigned_technician_id ?? null,
    })
  } else {
    Object.assign(row, { store_number: str(formData, 'store_number'), brand: str(formData, 'brand') ?? 'Independent', problem_reported: str(formData, 'problem_reported') })
  }
  const { data, error } = await admin.from('service_tickets').insert(row).select('id').single()
  if (error || !data) return
  paths(data.id)
  redirect(mobile ? `/mobile/service-ticket/${data.id}` : `/service/tickets/${data.id}`)
}

export async function saveTicketDetails(id: string, _s: ActionState, formData: FormData): Promise<ActionState> {
  const p = await me()
  if (!p || !canWriteServiceTickets(p.role)) return { error: 'No permission.' }
  const admin = createAdminClient()
  const { error } = await admin.from('service_tickets').update({
    store_number: str(formData, 'store_number'), csr_number: str(formData, 'csr_number'), po_number: str(formData, 'po_number'),
    brand: str(formData, 'brand'), site_address: str(formData, 'site_address'), city_state_zip: str(formData, 'city_state_zip'),
    problem_reported: str(formData, 'problem_reported'), work_performed: str(formData, 'work_performed'),
    truck_location_id: str(formData, 'truck_location_id'), technician_id: str(formData, 'technician_id'),
    charge_type: str(formData, 'charge_type') ?? 'billable', needs_quote: formData.get('needs_quote') === 'on',
    status: str(formData, 'status') ?? undefined,
  }).eq('id', id).eq('company_id', p.company_id)
  if (error) return { error: error.message }
  paths(id); return { ok: true }
}

export async function addLabor(id: string, formData: FormData): Promise<void> {
  const p = await me(); if (!p || !canWriteServiceTickets(p.role)) return
  const admin = createAdminClient()
  const hours = num(formData, 'hours'); const work_date = str(formData, 'work_date')
  if (!hours || !work_date) return
  await admin.from('service_ticket_labor').insert({ ticket_id: id, tech_id: str(formData, 'tech_id') ?? p.id, work_date, kind: str(formData, 'kind') ?? 'labor', hours, note: str(formData, 'note') })
  const trip = num(formData, 'trip_hours')
  if (trip) await admin.from('service_ticket_labor').insert({ ticket_id: id, tech_id: str(formData, 'tech_id') ?? p.id, work_date, kind: 'trip', hours: trip })
  paths(id)
}
export async function removeLabor(id: string, laborId: string): Promise<void> {
  const p = await me(); if (!p || !canWriteServiceTickets(p.role)) return
  await createAdminClient().from('service_ticket_labor').delete().eq('id', laborId).eq('ticket_id', id); paths(id)
}

export async function addPart(id: string, formData: FormData): Promise<void> {
  const p = await me(); if (!p || !canWriteServiceTickets(p.role)) return
  const admin = createAdminClient()
  const description = str(formData, 'description'); if (!description) return
  const partId = str(formData, 'part_id')
  let unit_cost = num(formData, 'unit_cost'), sell_price = num(formData, 'sell_price'), is_stock = false
  if (partId) {
    const { data: part } = await admin.from('parts').select('unit_cost, freight_per_unit, taxable, markup_pct, sell_price, is_stocked').eq('id', partId).maybeSingle()
    if (part) { unit_cost = unit_cost ?? part.unit_cost; sell_price = sell_price ?? (part.sell_price != null ? Number(part.sell_price) : sellPriceForLine(part, 0)); is_stock = !!part.is_stocked }
  }
  await admin.from('service_ticket_parts').insert({ ticket_id: id, part_id: partId, description, quantity: num(formData, 'quantity') ?? 1, unit_cost, sell_price, charge_type: str(formData, 'charge_type') ?? 'billable', from_location: str(formData, 'from_location'), serial_number: str(formData, 'serial_number'), is_stock })
  paths(id)
}
export async function removePart(id: string, partRowId: string): Promise<void> {
  const p = await me(); if (!p || !canWriteServiceTickets(p.role)) return
  await createAdminClient().from('service_ticket_parts').delete().eq('id', partRowId).eq('ticket_id', id); paths(id)
}

export async function addPhoto(id: string, url: string, kind: string): Promise<void> {
  const p = await me(); if (!p || !canWriteServiceTickets(p.role) || !url) return
  await createAdminClient().from('service_ticket_photos').insert({ ticket_id: id, url, kind: kind || 'after' }); paths(id)
}

/** Save a drawn signature (PNG data URL) and, once both parties have signed, lock the ticket and post the stock issues. */
export async function signTicket(id: string, who: 'tech' | 'site', dataUrl: string, signerName?: string, signerTitle?: string): Promise<{ error?: string }> {
  const p = await me(); if (!p || !canWriteServiceTickets(p.role)) return { error: 'No permission.' }
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl ?? '')
  if (!m) return { error: 'Signature is empty.' }
  const admin = createAdminClient()
  const path = `signatures/${id}/${who}-${Date.now()}.png`
  const { error: upErr } = await admin.storage.from('ticket-attachments').upload(path, Buffer.from(m[1], 'base64'), { contentType: 'image/png', upsert: false })
  if (upErr) return { error: upErr.message }
  const url = admin.storage.from('ticket-attachments').getPublicUrl(path).data.publicUrl
  const now = new Date().toISOString()
  const patch = who === 'tech'
    ? { tech_signature_url: url, tech_signed_by: p.id, tech_signed_at: now }
    : { site_signature_url: url, site_signer_name: signerName ?? null, site_signer_title: signerTitle ?? null, site_signed_at: now }
  const { data: t, error } = await admin.from('service_tickets').update(patch).eq('id', id).eq('company_id', p.company_id).select('id, status, tech_signature_url, site_signature_url').single()
  if (error || !t) return { error: error?.message ?? 'Not found' }

  if (t.tech_signature_url && t.site_signature_url && !['signed', 'invoiced'].includes(t.status)) {
    await admin.from('service_tickets').update({ status: 'signed' }).eq('id', id)
    await postStockIssues(id, p.company_id, p.id)
  }
  paths(id); return {}
}

/** issue_to_ticket ledger rows for every part pulled from a truck/shelf (once per part row). */
async function postStockIssues(ticketId: string, companyId: string, userId: string) {
  const admin = createAdminClient()
  const [{ data: parts }, { data: posted }] = await Promise.all([
    admin.from('service_ticket_parts').select('id, part_id, quantity, unit_cost, from_location, returned_qty, serial_number').eq('ticket_id', ticketId).not('part_id', 'is', null).not('from_location', 'is', null),
    admin.from('inventory_transactions').select('ref_label').eq('ref_type', 'service_ticket').eq('ref_id', ticketId),
  ])
  const done = new Set((posted ?? []).map(r => r.ref_label))
  const rows = (parts ?? []).filter(r => !done.has(r.id)).map(r => ({
    company_id: companyId, txn_type: 'issue_to_ticket', part_id: r.part_id, location_id: r.from_location,
    qty: -(Number(r.quantity) - Number(r.returned_qty ?? 0)), unit_cost: r.unit_cost, ref_type: 'service_ticket', ref_id: ticketId, ref_label: r.id,
    serial_number: r.serial_number, created_by: userId, note: 'posted when ticket was signed',
  })).filter(r => r.qty !== 0)
  if (rows.length) await admin.from('inventory_transactions').insert(rows)
}

export async function setTicketStatus(id: string, status: string): Promise<void> {
  const p = await me(); if (!p || !canWriteServiceTickets(p.role)) return
  await createAdminClient().from('service_tickets').update({ status }).eq('id', id).eq('company_id', p.company_id); paths(id)
}

/** Build the invoice from the ticket exactly the way Peggy lays it out, priced from the brand's rate card. */
export async function convertTicketToInvoice(id: string): Promise<void> {
  const p = await me(); if (!p || !canWriteServiceTickets(p.role)) return
  const admin = createAdminClient()
  const [{ data: t }, { data: labor }, { data: parts }] = await Promise.all([
    admin.from('service_tickets').select('*').eq('id', id).eq('company_id', p.company_id).single(),
    admin.from('service_ticket_labor').select('*').eq('ticket_id', id).order('work_date'),
    admin.from('service_ticket_parts').select('*').eq('ticket_id', id),
  ])
  if (!t) return
  const { data: card } = await admin.from('billing_rate_cards').select('*').eq('company_id', p.company_id).eq('name', rateCardNameForBrand(t.brand)).maybeSingle()
  const rate = card ?? { labor_rate: 95, trip_rate: 95, trip_mode: 'per_hour', overtime_rate: null, sales_tax_pct: 0 }
  const lines = buildInvoiceLines(
    (labor ?? []).map(l => ({ work_date: l.work_date, kind: l.kind, hours: Number(l.hours), tech_id: l.tech_id })),
    (parts ?? []).map(r => ({ description: r.description, quantity: Number(r.quantity) - Number(r.returned_qty ?? 0), unit_cost: r.unit_cost, sell_price: r.sell_price, part_id: r.part_id, charge_type: r.charge_type, is_stock: r.is_stock })),
    { labor_rate: Number(rate.labor_rate), trip_rate: rate.trip_rate != null ? Number(rate.trip_rate) : null, trip_mode: rate.trip_mode, overtime_rate: rate.overtime_rate != null ? Number(rate.overtime_rate) : null },
  )
  const taxPct = Number(rate.sales_tax_pct) > 0 ? Number(rate.sales_tax_pct) : DEFAULT_SERVICE_TAX
  const { totals, lines: computed } = computeDocumentTotals(lines, 0, taxPct)
  const { final_total, ...rest } = totals
  const { data: customer } = t.brand ? await admin.from('con_customers').select('id').eq('company_id', p.company_id).ilike('name', `%${t.brand}%`).limit(1).maybeSingle() : { data: null }
  const { data: signer } = await admin.from('profiles').select('full_name, job_title').eq('id', p.id).single()

  const { data: inv, error } = await admin.from('con_invoices').insert({
    company_id: p.company_id, department: 'service', service_ticket_id: t.id, customer_id: customer?.id ?? null,
    invoice_date: new Date().toISOString().slice(0, 10), csr_number: t.csr_number, po_number: t.po_number, portal_wo_number: t.portal_wo_number,
    store_label: t.store_number, facility_address: t.site_address, city_state_zip: t.city_state_zip,
    project_description: t.work_performed, profit_overhead_percent: 0, sales_tax_percent: taxPct,
    ...rest, invoice_grand_total: final_total, status: 'draft', signer_id: p.id, prepared_by: signer ? [signer.full_name, signer.job_title].filter(Boolean).join(', ') : null,
    labor_rate: Number(rate.labor_rate), material_markup_pct: 0, material_tax_pct: 0, sub_markup_pct: 0, project_manager: signer?.full_name ?? null,
  }).select('id').single()
  if (error || !inv) return
  if (computed.length) await admin.from('con_invoice_line_items').insert(computed.map((l, i) => ({
    invoice_id: inv.id, section: l.section, line_no: l.line_no ?? i + 1, description: l.description, quantity: l.quantity, unit_cost: l.unit_cost,
    material_total: l.material_total, labor_hours: l.labor_hours, labor_rate: l.labor_rate, total_labor: l.total_labor, total_material_labor: l.total_material_labor,
    item_type: l.item_type, is_stock: l.is_stock ?? false, part_id: l.part_id ?? null,
    // REV19 category + the pieces the new builder/PDF read; sell prices are already final so markup/tax stay 0 on these lines.
    category: l.item_type === 'labor' ? 7 : l.item_type === 'trip' ? 8 : l.item_type === 'disposables' ? 10 : 4, sort_order: i + 1,
    men: l.item_type === 'labor' ? 1 : null, hrs_each: l.item_type === 'labor' ? l.labor_hours ?? null : null, crew: 'service',
    sales_tax_pct: 0, markup_pct: 0, sell_unit: l.item_type === 'labor' ? l.labor_rate ?? null : l.unit_cost ?? null, price_flag: 'ok',
  })))
  await admin.from('service_tickets').update({ status: 'invoiced' }).eq('id', id)
  paths(id); revalidatePath('/billing/invoices')
  redirect(`/billing/invoices/${inv.id}`)
}
