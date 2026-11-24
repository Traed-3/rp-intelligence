'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBillingProfile } from '@/lib/billing-guard'
import { money } from '@/lib/billing'
import { computeRev19, categoryFromItemType, REV19_DEFAULTS, type Rev19Inputs, type Rev19LineInput } from '@/lib/rev19'
import { classifySite } from '@/lib/site-number'

export type ActionState = { error: string } | null

const str = (v: FormDataEntryValue | null) => { const s = (v as string | null)?.trim(); return s || null }
const num = (v: FormDataEntryValue | null) => { const s = (v as string | null)?.trim(); if (!s) return null; const x = Number(s.replace(/[$,%]/g, '')); return isFinite(x) ? x : null }
const pct = (v: FormDataEntryValue | null, dflt: number) => { const x = num(v); return x == null ? dflt : x / 100 }   // whole number on the form → decimal

function refresh(kind: 'quotes' | 'invoices', id?: string | null, jobId?: string | null) {
  revalidatePath('/billing'); revalidatePath(`/billing/${kind}`)
  if (id) revalidatePath(`/billing/${kind}/${id}`)
  if (jobId) revalidatePath(`/construction/jobs/${jobId}`)
  revalidatePath('/construction')
}

/** The REV19 INPUTS block off the form. */
function parseInputs(fd: FormData): Rev19Inputs {
  return {
    material_markup_pct: pct(fd.get('material_markup_pct'), REV19_DEFAULTS.material_markup_pct),
    material_tax_pct:    pct(fd.get('material_tax_pct'), REV19_DEFAULTS.material_tax_pct),
    sub_markup_pct:      pct(fd.get('sub_markup_pct'), REV19_DEFAULTS.sub_markup_pct),
    labor_rate:          num(fd.get('labor_rate')) ?? 0,
    contingency_pct:     pct(fd.get('contingency_pct'), 0),
    contingency_flat:    num(fd.get('contingency_flat')) ?? 0,
    profit_overhead_pct: pct(fd.get('profit_overhead_percent'), 0),
    sales_tax_pct:       pct(fd.get('sales_tax_percent'), 0),
  }
}

function parseLines(fd: FormData): Rev19LineInput[] {
  const raw = fd.get('line_items')
  if (!raw) return []
  try {
    const arr = JSON.parse(raw as string) as Record<string, unknown>[]
    const N = (v: unknown) => (v === '' || v == null ? null : isFinite(Number(v)) ? Number(v) : null)
    const S = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    return arr.map((r, i): Rev19LineInput => {
      const category = Number(r.category) >= 1 && Number(r.category) <= 12 ? Number(r.category) : categoryFromItemType(S(r.item_type))
      return {
        section: r.section === 'additional' ? 'additional' : 'basic', category, line_no: i + 1,
        description: S(r.description), part_number: S(r.part_number), part_id: S(r.part_id), subcategory: S(r.subcategory),
        quantity: N(r.quantity), unit_cost: N(r.unit_cost), sales_tax_pct: N(r.sales_tax_pct), markup_pct: N(r.markup_pct),
        freight_per_unit: N(r.freight_per_unit), markup_applies: !!r.markup_applies, men: N(r.men), hrs_each: N(r.hrs_each),
        labor_rate: N(r.labor_rate), travel_days: N(r.travel_days), techs: N(r.techs), day_label: S(r.day_label), crew: S(r.crew),
        source_note: S(r.source_note), price_flag: S(r.price_flag) ?? 'ok', is_stock: !!r.is_stock, item_type: S(r.item_type),
      }
    }).filter(l => l.description || l.quantity || l.unit_cost || l.men || l.travel_days)
  } catch { return [] }
}

function parseScopeRows(fd: FormData): { scope: string; description: string }[] {
  try { const a = JSON.parse((fd.get('scope_rows') as string) || '[]') as { scope?: string; description?: string }[]; return a.map(r => ({ scope: (r.scope ?? '').trim(), description: (r.description ?? '').trim() })).filter(r => r.scope || r.description) } catch { return [] }
}

function headerFields(fd: FormData, inp: Rev19Inputs) {
  return {
    job_id: str(fd.get('job_id')), customer_id: str(fd.get('customer_id')), department: str(fd.get('department')) === 'service' ? 'service' : 'construction',
    attn: str(fd.get('attn')), store_label: str(fd.get('store_label')), site_number: str(fd.get('site_number')),
    facility_address: str(fd.get('facility_address')), city_state_zip: str(fd.get('city_state_zip')), project_description: str(fd.get('project_description')),
    csr_number: str(fd.get('csr_number')), po_number: str(fd.get('po_number')), portal_wo_number: str(fd.get('portal_wo_number')), work_order_number: str(fd.get('work_order_number')),
    project_manager: str(fd.get('project_manager')), construction_manager: str(fd.get('construction_manager')), foreman: str(fd.get('foreman')), compiled_by: str(fd.get('compiled_by')),
    signer_id: str(fd.get('signer_id')), prepared_by: [str(fd.get('signer_name')), str(fd.get('signer_title'))].filter(Boolean).join(', ') || null, rate_card_id: str(fd.get('rate_card_id')),
    material_markup_pct: inp.material_markup_pct, material_tax_pct: inp.material_tax_pct, sub_markup_pct: inp.sub_markup_pct, labor_rate: inp.labor_rate,
    contingency_pct: inp.contingency_pct, contingency_flat: inp.contingency_flat, profit_overhead_percent: inp.profit_overhead_pct, sales_tax_percent: inp.sales_tax_pct,
    scope_rows: parseScopeRows(fd), exclusions: str(fd.get('exclusions')), warranty_line: str(fd.get('warranty_line')),
  }
}

function lineRows(lines: ReturnType<typeof computeRev19>['lines'], fk: 'quote_id' | 'invoice_id', id: string) {
  return lines.map((l, i) => ({
    [fk]: id, section: l.section, line_no: i + 1, sort_order: i + 1, category: l.category, subcategory: l.subcategory ?? null,
    description: l.description ?? null, part_number: l.part_number ?? null, part_id: l.part_id ?? null, item_type: l.item_type ?? null, is_stock: !!l.is_stock,
    quantity: l.quantity_effective, unit_cost: l.unit_cost ?? null, sales_tax_pct: l.sales_tax_pct ?? null, markup_pct: l.markup_pct ?? null,
    freight_per_unit: l.freight_per_unit ?? null, markup_applies: !!l.markup_applies, sell_unit: l.sell_unit,
    men: l.men ?? null, hrs_each: l.hrs_each ?? null, travel_days: l.travel_days ?? null, techs: l.techs ?? null, day_label: l.day_label ?? null, crew: l.crew ?? null,
    labor_hours: l.labor_hours || null, labor_rate: l.category === 7 ? l.sell_unit : null, total_labor: l.total_labor, material_total: l.material_total, total_material_labor: l.total_material_labor,
    source_note: l.source_note ?? null, price_flag: l.price_flag ?? 'ok',
  }))
}

function totalsRow(t: ReturnType<typeof computeRev19>['totals']) {
  return {
    basic_subtotal_material: t.basic_subtotal_material, basic_subtotal_labor: t.basic_subtotal_labor, basic_total: t.basic_total,
    additional_subtotal_material: t.additional_subtotal_material, additional_subtotal_labor: t.additional_subtotal_labor, additional_total: t.additional_total,
    grand_total: t.grand_total, contingency_amount: t.contingency_amount, profit_overhead_amount: t.profit_overhead_amount, tax_amount: t.tax_amount,
    category_totals: t.category_totals, taxable_material_total: t.taxable_material_total, concrete_equipment_total: t.concrete_equipment_total, labor_mobilization_total: t.labor_mobilization_total,
  }
}

// ── QUOTES ────────────────────────────────────────────────────────────────────
export async function saveQuote(id: string | null, _s: ActionState, fd: FormData): Promise<ActionState> {
  const p = await getBillingProfile()
  if (!p) return { error: 'Not authenticated.' }
  if (!p.canWrite) return { error: 'You do not have permission to edit quotes.' }
  const inp = parseInputs(fd)
  const { lines, totals } = computeRev19(parseLines(fd), inp)
  const admin = createAdminClient()
  const row = {
    ...headerFields(fd, inp), company_id: p.company_id, customer_email: str(fd.get('customer_email')),
    proposal_date: str(fd.get('proposal_date')), bid_due: str(fd.get('bid_due')), valid_until: str(fd.get('valid_until')), nte_amount: num(fd.get('nte_amount')),
    status: str(fd.get('status')) ?? 'draft', is_starting_quote: fd.get('is_starting_quote') === 'true',
    ...totalsRow(totals), final_total: totals.final_total,
  }
  let quoteId = id
  if (id) {
    const { error } = await admin.from('con_quotes').update(row).eq('id', id).eq('company_id', p.company_id)
    if (error) return { error: error.message }
    await admin.from('con_quote_line_items').delete().eq('quote_id', id)
  } else {
    const { data, error } = await admin.from('con_quotes').insert(row).select('id').single()
    if (error || !data) return { error: error?.message ?? 'Could not create the quote.' }
    quoteId = data.id
  }
  if (lines.length) {
    const { error } = await admin.from('con_quote_line_items').insert(lineRows(lines, 'quote_id', quoteId!))
    if (error) return { error: error.message }
  }
  refresh('quotes', quoteId, row.job_id)
  redirect(`/billing/quotes/${quoteId}`)
}

/**
 * An approved quote becomes a project: a Construction job at the "permitting" stage,
 * carrying the site, customer, scope and CSR/work-order number, linked both ways.
 * Idempotent — if the quote already has a job it just opens it.
 */
export async function startProjectFromQuote(quoteId: string): Promise<void> {
  const p = await getBillingProfile(); if (!p?.canWrite) return
  const admin = createAdminClient()
  const { data: q } = await admin.from('con_quotes').select('*').eq('id', quoteId).eq('company_id', p.company_id).single()
  if (!q) return
  if (q.job_id) redirect(`/construction/jobs/${q.job_id}`)

  const { siteNumber, brand } = classifySite(q.site_number ?? q.store_label)
  let siteId: string | null = null
  if (siteNumber) {
    const { data: site } = await admin.from('con_sites').select('id').eq('company_id', p.company_id).eq('site_number', siteNumber).limit(1).maybeSingle()
    if (site) siteId = site.id
    else {
      const csz = (q.city_state_zip ?? '').split(',').map((x: string) => x.trim())
      const { data: created } = await admin.from('con_sites').insert({
        company_id: p.company_id, site_number: siteNumber, store_brand: brand, customer_id: q.customer_id ?? null,
        address: q.facility_address ?? null, city: csz[0] || null, state: csz[1]?.split(' ')[0] || null,
      }).select('id').single()
      siteId = created?.id ?? null
    }
  }
  const { data: job, error } = await admin.from('con_jobs').insert({
    company_id: p.company_id, site_id: siteId, site_number: siteNumber || q.site_number, customer_id: q.customer_id ?? null,
    work_order_number: q.work_order_number ?? q.csr_number ?? q.portal_wo_number ?? null,
    stage: 'permitting', scope_of_work: q.project_description ?? null, facility_address: q.facility_address ?? null, gas_brand: brand,
    date_received: q.proposal_date ?? null, assigned_manager_id: q.signer_id ?? null,
    notes: `Started from quote ${q.quote_number} (${money(Number(q.final_total ?? 0))} approved).`,
  }).select('id').single()
  if (error || !job) return
  await admin.from('con_quotes').update({ job_id: job.id }).eq('id', quoteId)
  revalidatePath('/construction'); revalidatePath('/construction/jobs'); revalidatePath(`/billing/quotes/${quoteId}`)
  redirect(`/construction/jobs/${job.id}`)
}

export async function setQuoteStatus(id: string, status: string): Promise<void> {
  const p = await getBillingProfile(); if (!p?.canWrite) return
  const today = new Date().toISOString().slice(0, 10)
  const updates: Record<string, unknown> = { status }
  if (status === 'sent') updates.sent_date = today
  if (status === 'approved' || status === 'rejected') updates.decision_date = today
  await createAdminClient().from('con_quotes').update(updates).eq('id', id).eq('company_id', p.company_id)
  refresh('quotes', id)
}

export async function deleteQuote(id: string): Promise<void> {
  const p = await getBillingProfile(); if (!p?.canWrite) return
  await createAdminClient().from('con_quotes').delete().eq('id', id).eq('company_id', p.company_id)
  refresh('quotes')
  redirect('/billing/quotes')
}

/** Duplicate a quote (header + lines) as a new draft — a quick way to clone a job type. */
export async function duplicateQuote(id: string): Promise<void> {
  const p = await getBillingProfile(); if (!p?.canWrite) return
  const admin = createAdminClient()
  const { data: q } = await admin.from('con_quotes').select('*').eq('id', id).eq('company_id', p.company_id).single()
  if (!q) return
  const { data: items } = await admin.from('con_quote_line_items').select('*').eq('quote_id', id).order('sort_order').order('line_no')
  const { id: _id, quote_number: _qn, created_at: _c, updated_at: _u, sent_date: _s, decision_date: _d, ...rest } = q
  const { data: nq } = await admin.from('con_quotes').insert({ ...rest, status: 'draft', proposal_date: new Date().toISOString().slice(0, 10), project_description: `${q.project_description ?? ''} (COPY)`.trim() }).select('id').single()
  if (!nq) return
  if (items?.length) await admin.from('con_quote_line_items').insert(items.map(({ id: _li, quote_id: _q, created_at: _lc, ...l }) => ({ ...l, quote_id: nq.id })))
  refresh('quotes', nq.id)
  redirect(`/billing/quotes/${nq.id}`)
}

/**
 * Start a real Change Order document against an already-approved (or any)
 * quote — distinct from the informal "additional scope" section on the same
 * document, which stays for changes discovered before the original is signed.
 * Starts blank (no copied line items): a change order is its own document.
 */
export async function createChangeOrder(parentQuoteId: string): Promise<void> {
  const p = await getBillingProfile(); if (!p?.canWrite) return
  const admin = createAdminClient()
  const { data: q } = await admin.from('con_quotes').select('*').eq('id', parentQuoteId).eq('company_id', p.company_id).single()
  if (!q) return
  const { id: _id, quote_number: _qn, created_at: _c, updated_at: _u, sent_date: _s, decision_date: _d, kind: _k, parent_quote_id: _p, status: _st, ...rest } = q
  const { data: co } = await admin.from('con_quotes').insert({
    ...rest, kind: 'change_order', parent_quote_id: parentQuoteId, status: 'draft',
    proposal_date: new Date().toISOString().slice(0, 10),
    project_description: `Change Order — ${q.project_description ?? ''}`.trim(),
  }).select('id').single()
  if (!co) return
  refresh('quotes', co.id, q.job_id)
  redirect(`/billing/quotes/${co.id}/edit`)
}

/** Quote → draft invoice. Copies the INPUTS block and every categorized line. */
export async function convertQuoteToInvoice(quoteId: string): Promise<void> {
  const p = await getBillingProfile(); if (!p?.canWrite) return
  const admin = createAdminClient()
  const { data: q } = await admin.from('con_quotes').select('*').eq('id', quoteId).eq('company_id', p.company_id).single()
  if (!q) return
  const { data: items } = await admin.from('con_quote_line_items').select('*').eq('quote_id', quoteId).order('sort_order').order('line_no')
  const copy = ['job_id', 'customer_id', 'attn', 'store_label', 'site_number', 'facility_address', 'city_state_zip', 'project_description', 'department', 'portal_wo_number', 'work_order_number', 'csr_number',
    'project_manager', 'construction_manager', 'foreman', 'compiled_by', 'prepared_by', 'signer_id', 'rate_card_id', 'material_markup_pct', 'material_tax_pct', 'sub_markup_pct', 'labor_rate',
    'contingency_pct', 'contingency_flat', 'contingency_amount', 'profit_overhead_percent', 'sales_tax_percent', 'scope_rows', 'exclusions', 'warranty_line', 'category_totals',
    'taxable_material_total', 'concrete_equipment_total', 'labor_mobilization_total', 'basic_subtotal_material', 'basic_subtotal_labor', 'basic_total',
    'additional_subtotal_material', 'additional_subtotal_labor', 'additional_total', 'grand_total', 'profit_overhead_amount', 'tax_amount'] as const
  const row: Record<string, unknown> = { company_id: p.company_id, quote_id: q.id, invoice_date: new Date().toISOString().slice(0, 10), status: 'draft', invoice_grand_total: q.final_total, is_starting_quote: false }
  for (const k of copy) row[k] = (q as Record<string, unknown>)[k] ?? null
  const { data: inv, error } = await admin.from('con_invoices').insert(row).select('id').single()
  if (error || !inv) return
  if (items?.length) await admin.from('con_invoice_line_items').insert(items.map(({ id: _li, quote_id: _q, created_at: _c, ...l }) => ({ ...l, invoice_id: inv.id })))
  refresh('invoices', inv.id, q.job_id); refresh('quotes', quoteId)
  redirect(`/billing/invoices/${inv.id}`)
}

// ── INVOICES ──────────────────────────────────────────────────────────────────
export async function saveInvoice(id: string | null, _s: ActionState, fd: FormData): Promise<ActionState> {
  const p = await getBillingProfile()
  if (!p) return { error: 'Not authenticated.' }
  if (!p.canWrite) return { error: 'You do not have permission to edit invoices.' }
  const inp = parseInputs(fd)
  const { lines, totals } = computeRev19(parseLines(fd), inp)
  const admin = createAdminClient()
  const row = {
    ...headerFields(fd, inp), company_id: p.company_id, quote_id: str(fd.get('quote_id')), service_ticket_id: str(fd.get('service_ticket_id')),
    invoice_date: str(fd.get('invoice_date')), due_date: str(fd.get('due_date')), status: str(fd.get('status')) ?? 'draft', is_starting_quote: false,
    ...totalsRow(totals), invoice_grand_total: totals.final_total,
  }
  let invId = id
  if (id) {
    const { error } = await admin.from('con_invoices').update(row).eq('id', id).eq('company_id', p.company_id)
    if (error) return { error: error.message }
    await admin.from('con_invoice_line_items').delete().eq('invoice_id', id)
  } else {
    const { data, error } = await admin.from('con_invoices').insert(row).select('id').single()
    if (error || !data) return { error: error?.message ?? 'Could not create the invoice.' }
    invId = data.id
  }
  if (lines.length) {
    const { error } = await admin.from('con_invoice_line_items').insert(lineRows(lines, 'invoice_id', invId!))
    if (error) return { error: error.message }
  }
  refresh('invoices', invId, row.job_id)
  redirect(`/billing/invoices/${invId}`)
}

export async function setInvoiceStatus(id: string, status: string): Promise<void> {
  const p = await getBillingProfile(); if (!p?.canWrite) return
  const updates: Record<string, unknown> = { status }
  if (status === 'sent') updates.sent_date = new Date().toISOString().slice(0, 10)
  await createAdminClient().from('con_invoices').update(updates).eq('id', id).eq('company_id', p.company_id)
  refresh('invoices', id)
}

export async function deleteInvoice(id: string): Promise<void> {
  const p = await getBillingProfile(); if (!p?.canWrite) return
  await createAdminClient().from('con_invoices').delete().eq('id', id).eq('company_id', p.company_id)
  refresh('invoices')
  redirect('/billing/invoices')
}

// ============================================================
// QUOTE TEMPLATES — reusable starting points for the builder
// ============================================================
function parseJsonArray(fd: FormData, field: string): Record<string, unknown>[] {
  const raw = fd.get(field)
  if (!raw) return []
  try { const arr = JSON.parse(raw as string); return Array.isArray(arr) ? arr : [] } catch { return [] }
}
function parseJsonObject(fd: FormData, field: string): Record<string, string> {
  const raw = fd.get(field)
  if (!raw) return {}
  try { const obj = JSON.parse(raw as string); return obj && typeof obj === 'object' ? obj : {} } catch { return {} }
}

export async function saveQuoteTemplate(id: string | null, _state: ActionState, fd: FormData): Promise<ActionState> {
  const p = await getBillingProfile(); if (!p?.canWrite) return { error: 'You do not have permission to edit templates.' }
  const admin = createAdminClient()
  const name = str(fd.get('name'))
  if (!name) return { error: 'Name is required.' }

  const scopeRows = parseJsonArray(fd, 'scope_rows_json')
    .map(r => ({ scope: String(r.scope ?? '').trim(), description: String(r.description ?? '').trim() }))
    .filter(r => r.scope || r.description)
  const lines = parseJsonArray(fd, 'lines_json')
    .map(r => ({ section: r.section === 'additional' ? 'additional' : 'basic', category: Number(r.category) || 4, description: String(r.description ?? '').trim() }))
    .filter(r => r.description)
  const notesByBrand: Record<string, string> = {}
  for (const [k, v] of Object.entries(parseJsonObject(fd, 'notes_by_brand_json'))) {
    const text = String(v ?? '').trim()
    if (k && text) notesByBrand[k] = text
  }

  const row = {
    company_id: p.company_id,
    name,
    category: str(fd.get('category')),
    description: str(fd.get('description')),
    department: str(fd.get('department')) === 'service' ? 'service' : 'construction',
    scope_rows: scopeRows,
    lines,
    exclusions: str(fd.get('exclusions')),
    warranty_line: str(fd.get('warranty_line')),
    notes_by_brand: notesByBrand,
    is_active: fd.get('is_active') != null,
  }

  let templateId = id
  if (id) {
    const { error } = await admin.from('con_quote_templates').update(row).eq('id', id).eq('company_id', p.company_id)
    if (error) return { error: error.message }
  } else {
    const { data, error } = await admin.from('con_quote_templates').insert({ ...row, created_by: p.id }).select('id').single()
    if (error || !data) return { error: error?.message ?? 'Could not create the template.' }
    templateId = data.id
  }
  revalidatePath('/billing/quotes/templates')
  revalidatePath('/billing/quotes/new')
  redirect(`/billing/quotes/templates/${templateId}/edit`)
}

export async function deleteQuoteTemplate(id: string): Promise<void> {
  const p = await getBillingProfile(); if (!p?.canWrite) return
  await createAdminClient().from('con_quote_templates').delete().eq('id', id).eq('company_id', p.company_id)
  revalidatePath('/billing/quotes/templates')
  revalidatePath('/billing/quotes/new')
  redirect('/billing/quotes/templates')
}

export async function setQuoteTemplateActive(id: string, isActive: boolean): Promise<void> {
  const p = await getBillingProfile(); if (!p?.canWrite) return
  await createAdminClient().from('con_quote_templates').update({ is_active: isActive }).eq('id', id).eq('company_id', p.company_id)
  revalidatePath('/billing/quotes/templates')
  revalidatePath('/billing/quotes/new')
}

