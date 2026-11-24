#!/usr/bin/env node
/**
 * Load the parts catalog seed into Supabase (parts + part_price_history).
 *   node scripts/seed-parts.mjs            # idempotent: skips rows whose (sku, part_number, description) already exist
 *   node scripts/seed-parts.mjs --reset    # deletes seeded rows (sku in the three seed tags) first
 * Sources: supabase/seed/parts_catalog_seed.csv (REV19 library + price books)
 *          supabase/seed/service_parts_sell_prices.csv (billed on 2026 service invoices)
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n')
  .map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

function csv(path) {
  const text = readFileSync(path, 'utf-8'); const rows = []; let row = [], cell = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else inQ = false } else cell += ch }
    else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (ch !== '\r') cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [h, ...body] = rows
  return body.filter(r => r.length === h.length).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])))
}
const num = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v)
const mdy = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s || ''); if (!m) return null; const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}` }
const ITEM = { 5: 'material', 6: 'lodging', 7: 'labor', 8: 'trip', 9: 'equipment', 10: 'disposables', 11: 'sub', 12: 'permit' }
const catNum = r => /^\d+$/.test(r.category) ? +r.category : (+(/CATEGORY (\d+)/.exec(r.category_name || '')?.[1]) || null)
const itemType = (r, c) => c ? (ITEM[c] || 'material') : (/LABOR/.test(r.category_name) ? 'labor' : /MOBILIZ/.test(r.category_name) ? 'trip' : /EQUIPMENT/.test(r.category_name) ? 'equipment' : /LODGING/.test(r.category_name) ? 'lodging' : /DISPOSABLE/.test(r.category_name) ? 'disposables' : /TESTING/.test(r.category_name) ? 'service' : 'material')
const KIND = { receipt: 'cost_receipt', vendor_quote: 'cost_vendor_quote', book: 'cost_book', web: 'cost_web', rate_card: 'cost_book', estimate: 'cost_book' }

const { data: co } = await sb.from('companies').select('id').order('created_at').limit(1).single()
const company_id = co.id
if (process.argv.includes('--reset')) {
  const { error } = await sb.from('parts').delete().eq('company_id', company_id).in('sku', ['REV19_LIBRARY', 'PRICE_BOOK', 'WEB_VERIFIED', 'SVC_INVOICES_2026'])
  if (error) throw error; console.log('reset: seeded parts removed')
}
const { data: existing } = await sb.from('parts').select('sku, part_number, description').eq('company_id', company_id)
const have = new Set((existing ?? []).map(p => `${p.sku}|${p.part_number ?? ''}|${p.description}`))

const parts = [], history = []
for (const r of csv(resolve(__dirname, '..', 'supabase/seed/parts_catalog_seed.csv'))) {
  const c = catNum(r), it = itemType(r, c), cost = num(r.unit_cost)
  const status = /HELD HIGH/i.test(r.source_note) ? 'held_high' : r.price_status === 'PRICE NEEDED' ? 'price_needed' : 'ok'
  parts.push({ company_id, sku: r.source, part_number: r.part_number || null, description: r.description, category: c, category_name: r.category_name || null, subcategory: r.subcategory || null,
    item_type: it, taxable: [1, 2, 3, 4].includes(c), unit_cost: cost, cost_source: (KIND[r.price_kind] || 'cost_book').replace('cost_', ''), cost_vendor: r.vendor || null,
    cost_invoice_ref: r.vendor_invoice || null, cost_date: mdy(r.price_date), price_status: status, freight_per_unit: num(r.freight_unit) ?? 0,
    sell_price: it === 'material' ? num(r.sell_unit) : null, notes: (r.source_note || '').slice(0, 300) || null,
    _hist: cost != null ? { kind: KIND[r.price_kind] || 'cost_book', price: cost, vendor: r.vendor || null, reference: r.vendor_invoice || null, observed_on: mdy(r.price_date), source_note: (r.source_note || '').slice(0, 300) || null } : null })
}
for (const r of csv(resolve(__dirname, '..', 'supabase/seed/service_parts_sell_prices.csv'))) {
  const pn = (r.part_numbers.split(';')[0] || '').trim() || null
  const desc = r.description.toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase())
  parts.push({ company_id, sku: 'SVC_INVOICES_2026', part_number: pn, description: desc, category: null, category_name: 'SERVICE TICKET ITEMS', subcategory: 'BILLED ON SERVICE INVOICES 2026',
    item_type: 'material', taxable: true, unit_cost: null, cost_source: 'sell_billed', cost_date: r.last_date || null, price_status: 'ok', freight_per_unit: 0,
    sell_price: num(r.sell_last), notes: `billed ${r.times_billed}x, sell ${r.sell_min}-${r.sell_max}; e.g. ${r.example}`.slice(0, 300),
    _hist: { kind: 'sell_billed', price: num(r.sell_last), reference: 'RPS service invoices Mar-Sep 2026', observed_on: r.last_date || null, source_note: `min ${r.sell_min} max ${r.sell_max} over ${r.times_billed} invoices` } })
}
const fresh = parts.filter(p => !have.has(`${p.sku}|${p.part_number ?? ''}|${p.description}`))
console.log(`seed rows ${parts.length}, already present ${parts.length - fresh.length}, inserting ${fresh.length}`)
let inserted = 0
for (let i = 0; i < fresh.length; i += 100) {
  const chunk = fresh.slice(i, i + 100)
  const { data, error } = await sb.from('parts').insert(chunk.map(({ _hist, ...p }) => p)).select('id')
  if (error) { console.error('insert failed at chunk', i, error.message); process.exit(1) }
  data.forEach((row, j) => { const h = chunk[j]._hist; if (h) history.push({ part_id: row.id, ...h }) })
  inserted += data.length
}
for (let i = 0; i < history.length; i += 200) {
  const { error } = await sb.from('part_price_history').insert(history.slice(i, i + 200))
  if (error) { console.error('history insert failed', error.message); process.exit(1) }
}
console.log(`inserted ${inserted} parts, ${history.length} price-history rows`)
