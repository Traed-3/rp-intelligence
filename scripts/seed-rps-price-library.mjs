#!/usr/bin/env node
/**
 * Load the RPS PRICE LIBRARY tab of the REV19 quote tool into the parts catalog.
 *
 * Source: supabase/seed/rps_price_library_rev19_2026-09-17.json (pulled off the
 * SU-14675 workbook — every row has its REV19 category, subcategory heading,
 * cost, freight, and the receipt / quote / rate-card line it came from).
 *
 * Existing parts (matched on part number) only get filled in where they are
 * blank — category, subcategory, cost — so Shannon's prices are never
 * overwritten. Missing parts are created with sku 'RPS_PRICE_LIBRARY'.
 * Categories 5–12 are flagged quick_pick so they show as chips in the builder.
 *
 *   node scripts/seed-rps-price-library.mjs            # dry run
 *   node scripts/seed-rps-price-library.mjs --apply
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n').map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const COMPANY_ID = env.RPS_COMPANY_ID ?? 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'
const apply = process.argv.includes('--apply')

const CAT_NAMES = { 1: 'ELECTRICAL SUPPLY', 2: 'HARD PIPE AND FITTINGS', 3: 'ICON', 4: 'PUMP & TANK MATERIALS', 5: 'CONCRETE / REBAR / BACKFILL AND CONCRETE DISPOSAL', 6: 'HOTEL LODGING / PER DIEM', 7: 'RPS LABOR', 8: 'TRIP CHARGES / MOBILIZATION', 9: 'RPS EQUIPMENT', 10: 'MISC / DISPOSABLES / DOT BARRELS', 11: 'SUBCONTRACTOR', 12: 'TRADE PERMITS AND ONSITE INSPECTIONS' }

function sourceOf(src) {
  const s = (src ?? '').trim()
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  const date = m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null
  const kind = /^RECEIPT:|^READ BY/i.test(s) ? 'receipt' : /^QUOTE:/i.test(s) ? 'vendor_quote' : /^WEB:/i.test(s) ? 'web' : /rate card|RPS avg|Incl\. in/i.test(s) ? 'rate_card' : /Source NA/i.test(s) ? 'book' : /NOT BACKED/i.test(s) ? null : 'estimate'
  const status = /NOT BACKED|PRICE NEEDED/i.test(s) ? 'price_needed' : /HELD HIGH/i.test(s) ? 'held_high' : /verify|settle/i.test(s) ? 'verify' : 'ok'
  return { kind, date, status, vendor: s.replace(/^(RECEIPT|QUOTE|WEB|SOURCE|READ BY [^:]*):\s*/i, '').split(/[,(]/)[0].trim().slice(0, 60) || null }
}

const rows = JSON.parse(readFileSync(resolve(__dirname, '..', 'supabase/seed/rps_price_library_rev19_2026-09-17.json'), 'utf-8'))
const { data: existing, error } = await sb.from('parts').select('id, part_number, category, subcategory, unit_cost, quick_pick').eq('company_id', COMPANY_ID)
if (error) throw error
const byPn = new Map(existing.filter(p => p.part_number).map(p => [p.part_number.toUpperCase(), p]))

let inserted = 0, updated = 0, untouched = 0
for (const r of rows) {
  if (!r.pn || !r.desc) continue
  const cost = typeof r.cost === 'number' ? r.cost : null
  const src = sourceOf(r.src)
  const quick = r.cat >= 5
  const hit = byPn.get(r.pn.toUpperCase())
  if (hit) {
    const patch = {}
    if (hit.category == null) patch.category = r.cat, patch.category_name = CAT_NAMES[r.cat]
    if (!hit.subcategory && r.sub) patch.subcategory = r.sub
    if (hit.unit_cost == null && cost != null) Object.assign(patch, { unit_cost: cost, cost_source: src.kind, cost_date: src.date, cost_vendor: src.vendor, price_status: src.status })
    if (quick && !hit.quick_pick) patch.quick_pick = true
    if (!Object.keys(patch).length) { untouched++; continue }
    updated++
    if (apply) { const { error } = await sb.from('parts').update(patch).eq('id', hit.id); if (error) console.error(r.pn, error.message) }
    else console.log('update', r.pn, JSON.stringify(patch))
    continue
  }
  inserted++
  const row = {
    company_id: COMPANY_ID, sku: 'RPS_PRICE_LIBRARY', part_number: r.pn, description: r.desc, category: r.cat, category_name: CAT_NAMES[r.cat], subcategory: r.sub,
    item_type: r.cat <= 5 ? 'material' : r.cat === 6 ? 'lodging' : r.cat === 8 ? 'trip' : r.cat === 9 ? 'equipment' : r.cat === 10 ? 'disposables' : r.cat === 11 ? 'subcontractor' : r.cat === 12 ? 'permit' : 'material',
    taxable: r.cat <= 4, unit_cost: cost, freight_per_unit: Number(r.freight) || 0, cost_source: cost == null ? null : src.kind, cost_date: src.date, cost_vendor: src.vendor,
    price_status: cost == null ? 'price_needed' : src.status, quick_pick: quick, notes: (r.src ?? '').slice(0, 500) || null,
  }
  if (apply) { const { error } = await sb.from('parts').insert(row); if (error) console.error(r.pn, error.message) }
  else console.log('insert', r.cat, r.pn, '|', r.desc.slice(0, 50), '|', cost, '|', src.kind, src.date, src.status)
}
console.log(`\n${apply ? 'Applied' : 'Dry run'}: ${inserted} to insert, ${updated} to update, ${untouched} already complete.`)
