/**
 * Apply a verified-price sheet to quotes: for every line whose description or part number
 * matches a rule, set the cost, part number, source note and flag, then re-run the REV19
 * engine and store the new totals. The catalog part (by part number) is created or
 * updated to the same cost/source so the next quote picks it up.
 *
 *   npx tsx scripts/verify-quote-prices.ts <rules.json> <quote_number> [<quote_number>…] [--apply]
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import * as rev19mod from '../lib/rev19'
import type { Rev19Inputs, Rev19LineInput } from '../lib/rev19'

const { computeRev19 } = ((rev19mod as { computeRev19?: unknown }).computeRev19 ? rev19mod : (rev19mod as unknown as { default: typeof rev19mod }).default) as typeof rev19mod
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n').map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m![1], m![2]]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const COMPANY_ID = env.RPS_COMPANY_ID ?? 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

type Rule = { match: string; part_number?: string; unit_cost?: number; labor_rate?: number; flag: string; source: string }
type CatalogOnly = { part_number: string; description: string; unit_cost: number; source: string; category: number }

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const [rulesFile, ...numbers] = args.filter(a => a !== '--apply')
  const { rules, catalog_only = [] } = JSON.parse(readFileSync(rulesFile, 'utf-8')) as { rules: Rule[]; catalog_only?: CatalogOnly[] }
  const dateOf = (s: string) => { const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})\b/); return m ? `20${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null }
  const kindOf = (s: string) => /^RECEIPT/i.test(s) ? 'receipt' : /^QUOTE/i.test(s) ? 'vendor_quote' : /rate card/i.test(s) ? 'rate_card' : 'book'

  for (const qn of numbers) {
    const { data: q } = await sb.from('con_quotes').select('*').eq('company_id', COMPANY_ID).eq('quote_number', qn).single()
    if (!q) { console.error(`${qn}: not found`); continue }
    const { data: lines } = await sb.from('con_quote_line_items').select('*').eq('quote_id', q.id).order('sort_order')
    console.log(`\n${qn} — ${lines!.length} lines, was ${money(Number(q.final_total))}`)
    const patched: { id: string; patch: Record<string, unknown> }[] = []
    for (const l of lines!) {
      const hay = `${l.part_number ?? ''} ${l.description ?? ''}`
      const rule = rules.find(r => new RegExp(r.match, 'i').test(l.description ?? '') || (l.part_number && new RegExp(r.match, 'i').test(l.part_number)))
      if (!rule) continue
      const patch: Record<string, unknown> = { source_note: rule.source, price_flag: rule.flag }
      if (rule.unit_cost != null) patch.unit_cost = rule.unit_cost
      if (rule.labor_rate != null) patch.labor_rate = rule.labor_rate
      if (rule.part_number) {
        patch.part_number = rule.part_number
        const { data: part } = await sb.from('parts').select('id').eq('company_id', COMPANY_ID).ilike('part_number', rule.part_number).limit(1)
        if (part?.[0]) patch.part_id = part[0].id
      }
      patched.push({ id: l.id, patch })
      console.log(`  ${(l.part_number ?? '').padEnd(14)} ${(l.description ?? '').slice(0, 44).padEnd(44)} ${l.unit_cost != null ? money(Number(l.unit_cost)).padStart(11) : '           '} → ${rule.unit_cost != null ? money(rule.unit_cost).padStart(11) : rule.labor_rate != null ? `${money(rule.labor_rate)}/hr` : '  (unchanged)'}  [${rule.flag}]`)
    }
    // Re-price with the engine so the stored totals and per-line extensions agree with the face.
    const inputs: Rev19Inputs = { material_markup_pct: Number(q.material_markup_pct), material_tax_pct: Number(q.material_tax_pct), sub_markup_pct: Number(q.sub_markup_pct), labor_rate: Number(q.labor_rate), contingency_pct: Number(q.contingency_pct ?? 0), contingency_flat: Number(q.contingency_flat ?? 0), profit_overhead_pct: Number(q.profit_overhead_percent ?? 0), sales_tax_pct: Number(q.sales_tax_percent ?? 0) }
    const N = (v: unknown) => (v == null ? null : Number(v))
    const items: Rev19LineInput[] = lines!.map(l => { const p = patched.find(x => x.id === l.id)?.patch ?? {}; const m = { ...l, ...p }; return {
      section: m.section, category: Number(m.category), description: m.description, part_number: m.part_number, part_id: m.part_id, quantity: N(m.quantity), unit_cost: N(m.unit_cost), sales_tax_pct: N(m.sales_tax_pct), markup_pct: N(m.markup_pct),
      freight_per_unit: N(m.freight_per_unit), markup_applies: !!m.markup_applies, men: N(m.men), hrs_each: N(m.hrs_each), labor_rate: N(m.labor_rate), travel_days: N(m.travel_days), techs: N(m.techs), day_label: m.day_label, crew: m.crew, source_note: m.source_note, price_flag: m.price_flag,
    } })
    const { lines: priced, totals } = computeRev19(items, inputs)
    console.log(`  ${patched.length} lines updated → ${money(totals.final_total)}; ${priced.filter(l => l.price_flag && l.price_flag !== 'ok').length} still flagged`)
    if (!apply) continue
    for (let i = 0; i < lines!.length; i++) {
      const l = lines![i], pr = priced[i], p = patched.find(x => x.id === l.id)?.patch ?? {}
      await sb.from('con_quote_line_items').update({ ...p, sell_unit: pr.sell_unit, quantity: pr.quantity_effective, labor_hours: pr.labor_hours || null, labor_rate: pr.category === 7 ? pr.sell_unit : null, total_labor: pr.total_labor, material_total: pr.material_total, total_material_labor: pr.total_material_labor }).eq('id', l.id)
    }
    await sb.from('con_quotes').update({
      basic_subtotal_material: totals.basic_subtotal_material, basic_subtotal_labor: totals.basic_subtotal_labor, basic_total: totals.basic_total,
      additional_subtotal_material: totals.additional_subtotal_material, additional_subtotal_labor: totals.additional_subtotal_labor, additional_total: totals.additional_total,
      grand_total: totals.grand_total, contingency_amount: totals.contingency_amount, profit_overhead_amount: totals.profit_overhead_amount, tax_amount: totals.tax_amount,
      category_totals: totals.category_totals, taxable_material_total: totals.taxable_material_total, concrete_equipment_total: totals.concrete_equipment_total, labor_mobilization_total: totals.labor_mobilization_total, final_total: totals.final_total,
    }).eq('id', q.id)
    console.log(`  saved.`)
  }

  // Catalog: make sure each verified part carries the same cost and source.
  if (apply) {
    let n = 0
    for (const r of rules) {
      if (!r.part_number || r.unit_cost == null) continue
      const { data: hit } = await sb.from('parts').select('id, description').eq('company_id', COMPANY_ID).ilike('part_number', r.part_number).limit(1)
      const fields = { unit_cost: r.unit_cost, cost_source: kindOf(r.source), cost_date: dateOf(r.source), cost_vendor: (r.source.match(/(Noland|WCW|Capital Electric|Source NA|Spatco|Petroleum Management Inc|Home Depot|RPS REV19 rate card)/i)?.[1]) ?? null, price_status: r.flag === 'ok' ? 'ok' : r.flag === 'held_high' ? 'held_high' : 'verify', notes: r.source }
      if (hit?.[0]) await sb.from('parts').update(fields).eq('id', hit[0].id)
      else await sb.from('parts').insert({ company_id: COMPANY_ID, sku: 'VERIFIED_2026-09', part_number: r.part_number, description: r.source.split('·')[1]?.trim() || r.part_number, category: 4, taxable: true, ...fields })
      n++
    }
    // Prices seen on receipts that no quote line uses yet — still worth having in the catalog.
    for (const c of catalog_only) {
      const { data: hit } = await sb.from('parts').select('id').eq('company_id', COMPANY_ID).ilike('part_number', c.part_number).limit(1)
      const fields = { unit_cost: c.unit_cost, cost_source: kindOf(c.source), cost_date: dateOf(c.source), cost_vendor: (c.source.match(/(Noland|WCW|Capital Electric|Source NA|Spatco|Petroleum Management Inc|Home Depot)/i)?.[1]) ?? null, price_status: 'ok', notes: c.source }
      if (hit?.[0]) await sb.from('parts').update(fields).eq('id', hit[0].id)
      else await sb.from('parts').insert({ company_id: COMPANY_ID, sku: 'VERIFIED_2026-09', part_number: c.part_number, description: c.description, category: c.category, taxable: true, ...fields })
      n++
    }
    console.log(`\ncatalog: ${n} parts carry the verified price.`)
  }
}
main()
