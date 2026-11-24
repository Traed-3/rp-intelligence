/**
 * Put a price on one quote line and re-run the REV19 math for the whole quote, the same computeRev19() the
 * quote builder uses, so the plate's "answer it" control and the builder can never disagree. Optionally the
 * same price is written to the parts catalog (category 9 equipment, a rate card item, …) so the next quote
 * picks it up without asking again.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeRev19, type Rev19Inputs, type Rev19LineInput } from '@/lib/rev19'

type Admin = SupabaseClient

export function inputsFromQuote(q: Record<string, unknown>): Rev19Inputs {
  const num = (v: unknown, d = 0) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v !== '' && isFinite(Number(v)) ? Number(v) : d)
  return {
    material_markup_pct: num(q.material_markup_pct, 0.2), material_tax_pct: num(q.material_tax_pct, 0.053), sub_markup_pct: num(q.sub_markup_pct, 0.15),
    labor_rate: num(q.labor_rate, 0), contingency_pct: num(q.contingency_pct, 0), contingency_flat: num(q.contingency_flat, 0),
    profit_overhead_pct: num(q.profit_overhead_percent, 0), sales_tax_pct: num(q.sales_tax_percent, 0),
  }
}

/** A stored line → the builder's input shape. Stored quantity is the effective quantity, which the math reproduces. */
export function lineInputFromRow(r: Record<string, unknown>): Rev19LineInput {
  const n = (v: unknown) => (v == null || v === '' ? null : Number(v))
  return {
    section: (r.section as 'basic' | 'additional') ?? 'basic', category: Number(r.category), line_no: n(r.line_no), description: (r.description as string) ?? null,
    part_number: (r.part_number as string) ?? null, part_id: (r.part_id as string) ?? null, subcategory: (r.subcategory as string) ?? null,
    quantity: n(r.quantity), unit_cost: n(r.unit_cost), sales_tax_pct: n(r.sales_tax_pct), markup_pct: n(r.markup_pct), freight_per_unit: n(r.freight_per_unit),
    markup_applies: r.markup_applies == null ? null : !!r.markup_applies, men: n(r.men), hrs_each: n(r.hrs_each), labor_rate: Number(r.category) === 7 ? n(r.labor_rate) : null,
    travel_days: n(r.travel_days), techs: n(r.techs), day_label: (r.day_label as string) ?? null, crew: (r.crew as string) ?? null,
    source_note: (r.source_note as string) ?? null, price_flag: (r.price_flag as string) ?? null, is_stock: !!r.is_stock, item_type: (r.item_type as string) ?? null,
  }
}

/** Re-run the math over the stored lines and write every computed column back. Returns the new final total. */
export async function recomputeQuote(admin: Admin, quoteId: string): Promise<{ final_total: number; grand_total: number }> {
  const { data: q, error: qErr } = await admin.from('con_quotes').select('*').eq('id', quoteId).single()
  if (qErr || !q) throw new Error(qErr?.message ?? 'quote not found')
  const { data: rows, error: lErr } = await admin.from('con_quote_line_items').select('*').eq('quote_id', quoteId).order('sort_order').order('line_no')
  if (lErr) throw new Error(lErr.message)
  const inp = inputsFromQuote(q as Record<string, unknown>)
  const { lines, totals } = computeRev19((rows ?? []).map(r => lineInputFromRow(r as Record<string, unknown>)), inp)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], id = (rows ?? [])[i].id as string
    const { error } = await admin.from('con_quote_line_items').update({
      quantity: l.quantity_effective, sell_unit: l.sell_unit, labor_hours: l.labor_hours || null, labor_rate: l.category === 7 ? l.sell_unit : null,
      total_labor: l.total_labor, material_total: l.material_total, total_material_labor: l.total_material_labor,
    }).eq('id', id)
    if (error) throw new Error(error.message)
  }
  const { error: uErr } = await admin.from('con_quotes').update({
    basic_subtotal_material: totals.basic_subtotal_material, basic_subtotal_labor: totals.basic_subtotal_labor, basic_total: totals.basic_total,
    additional_subtotal_material: totals.additional_subtotal_material, additional_subtotal_labor: totals.additional_subtotal_labor, additional_total: totals.additional_total,
    grand_total: totals.grand_total, contingency_amount: totals.contingency_amount, profit_overhead_amount: totals.profit_overhead_amount, tax_amount: totals.tax_amount,
    category_totals: totals.category_totals, taxable_material_total: totals.taxable_material_total, concrete_equipment_total: totals.concrete_equipment_total,
    labor_mobilization_total: totals.labor_mobilization_total, final_total: totals.final_total, updated_at: new Date().toISOString(),
  }).eq('id', quoteId)
  if (uErr) throw new Error(uErr.message)
  return { final_total: totals.final_total, grand_total: totals.grand_total }
}

export type CatalogEntry = { partNumber: string; description: string; category: number; subcategory?: string; uom?: string; itemType?: string }

/** Write the price on the line (flag ok, note with who and when), optionally into the catalog, then recompute. */
export async function applyQuoteLinePrice(admin: Admin, args: { companyId: string; quoteId: string; lineId: string; unitCost: number; note: string; description?: string | null; partNumber?: string | null; catalog?: CatalogEntry | null }) {
  const patch: Record<string, unknown> = { unit_cost: args.unitCost, price_flag: 'ok', source_note: args.note }
  if (args.description) patch.description = args.description
  if (args.partNumber) patch.part_number = args.partNumber
  let partId: string | null = null
  if (args.catalog) {
    const c = args.catalog
    const { data: existing } = await admin.from('parts').select('id').eq('company_id', args.companyId).eq('part_number', c.partNumber).eq('sku', 'PRICE_BOOK').maybeSingle()
    const row = {
      company_id: args.companyId, sku: 'PRICE_BOOK', part_number: c.partNumber, description: c.description, category: c.category,
      category_name: c.category === 9 ? 'CATEGORY 9 - EQUIPMENT DAY RATES' : c.category === 10 ? 'CATEGORY 10 - MISC / DISPOSABLES' : `CATEGORY ${c.category}`,
      subcategory: c.subcategory ?? null, uom: c.uom ?? 'EA', item_type: c.itemType ?? (c.category === 9 ? 'equipment' : 'material'), taxable: false, is_stocked: false, is_serialized: false,
      unit_cost: args.unitCost, cost_source: 'rate_card', cost_vendor: 'RPS rate card', cost_date: new Date().toISOString().slice(0, 10), price_status: 'ok', freight_per_unit: 0,
      notes: args.note, active: true, quick_pick: true, updated_at: new Date().toISOString(),
    }
    const res = existing
      ? await admin.from('parts').update(row).eq('id', existing.id).select('id').single()
      : await admin.from('parts').insert(row).select('id').single()
    if (res.error) throw new Error(res.error.message)
    partId = res.data.id
    patch.part_id = partId
    patch.part_number = c.partNumber
  }
  const { error } = await admin.from('con_quote_line_items').update(patch).eq('id', args.lineId).eq('quote_id', args.quoteId)
  if (error) throw new Error(error.message)
  const totals = await recomputeQuote(admin, args.quoteId)
  return { ...totals, partId }
}
