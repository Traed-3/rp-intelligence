#!/usr/bin/env node
/**
 * Load a vendor price list (CSV) into the parts catalog with the RPS price-precedence rule.
 *
 *   node scripts/load-vendor-price-list.mjs --csv supabase/seed/sna_7eleven_maintenance_price_list_2026.csv \
 *        --vendor "Source North America" --ref "7-Eleven Maintenance List 2026" --date 2026-04-13 --tag SNA_7ELEVEN_2026
 *
 * CSV columns: part_number, description, price, [manufacturer], [group], [alt_part_number], [core_part_number], [notes]
 *
 * Precedence (from the RPS quote-builder rules):
 *   - A RECEIPT price already on the part is never overwritten by a list price; the list price is
 *     only recorded in part_price_history.
 *   - A book / web / estimate / missing price IS replaced by the vendor list price.
 *   - Parts not in the catalog are created (cost_source = vendor_quote, taxable, category 4 unless
 *     the manufacturer says electrical).
 * Idempotent: re-running updates the same rows and skips duplicate history entries.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n')
  .map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const args = Object.fromEntries(process.argv.slice(2).join(' ').split(' --').filter(Boolean).map(s => { const [k, ...v] = s.replace(/^--/, '').split(' '); return [k, v.join(' ').trim()] }))
for (const k of ['csv', 'vendor', 'ref', 'date', 'tag']) if (!args[k]) { console.error(`missing --${k}`); process.exit(1) }

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
const ELEC = /(wire|cable|conduit|electrical|breaker|relay|contactor|fuse|junction|j-box|seal ?off|explosion)/i

const { data: co } = await sb.from('companies').select('id').order('created_at').limit(1).single()
const company_id = co.id
const list = csv(resolve(__dirname, '..', args.csv)).filter(r => r.part_number && num(r.price) != null)
console.log(`${list.length} priced rows in ${args.csv}`)

// Existing catalog keyed by upper-cased part number (first match wins; seeds have few dupes).
const { data: existing } = await sb.from('parts').select('id, part_number, unit_cost, cost_source, price_status, sku, description').eq('company_id', company_id)
const byPn = new Map()
for (const p of existing ?? []) { const k = (p.part_number ?? '').trim().toUpperCase(); if (k && !byPn.has(k)) byPn.set(k, p) }
const { data: hist } = await sb.from('part_price_history').select('part_id, price, reference').eq('reference', args.ref)
const seenHist = new Set((hist ?? []).map(h => `${h.part_id}|${Number(h.price)}`))

let created = 0, updated = 0, receiptKept = 0, histRows = 0
const toInsert = [], toUpdate = [], history = []
for (const r of list) {
  const price = num(r.price), k = r.part_number.trim().toUpperCase()
  const hit = byPn.get(k)
  if (hit) {
    if (hit.cost_source === 'receipt' && hit.unit_cost != null) receiptKept++
    else if (hit.unit_cost !== price || hit.cost_source !== 'vendor_quote') toUpdate.push({ id: hit.id, unit_cost: price, cost_source: 'vendor_quote', cost_vendor: args.vendor, cost_invoice_ref: args.ref, cost_date: args.date, price_status: 'ok', manufacturer: r.manufacturer || undefined })
    if (!seenHist.has(`${hit.id}|${price}`)) history.push({ part_id: hit.id, kind: 'cost_vendor_quote', price, vendor: args.vendor, reference: args.ref, observed_on: args.date, source_note: r.notes || null })
  } else {
    toInsert.push({ company_id, sku: args.tag, part_number: r.part_number.trim(), manufacturer: r.manufacturer || null, description: r.description || r.part_number,
      category: ELEC.test(`${r.group} ${r.description}`) ? 1 : 4, category_name: ELEC.test(`${r.group} ${r.description}`) ? 'CAT 1 - ELECTRICAL SUPPLY' : 'CAT 4 - PUMP & TANK MATERIALS (SOURCE / PETRO SUPPLY)',
      subcategory: r.group || r.manufacturer || null, item_type: 'material', taxable: true, unit_cost: price, cost_source: 'vendor_quote', cost_vendor: args.vendor,
      cost_invoice_ref: args.ref, cost_date: args.date, price_status: 'ok', primary_vendor: args.vendor,
      notes: [r.alt_part_number ? `alt ${r.alt_part_number}` : '', r.core_part_number ? `core ${r.core_part_number}` : '', r.notes].filter(Boolean).join('; ').slice(0, 300) || null,
      _hist: { kind: 'cost_vendor_quote', price, vendor: args.vendor, reference: args.ref, observed_on: args.date, source_note: r.notes || null } })
  }
}
for (const u of toUpdate) { const { id, ...fields } = u; if (fields.manufacturer === undefined) delete fields.manufacturer; const { error } = await sb.from('parts').update(fields).eq('id', id); if (error) { console.error('update', error.message); process.exit(1) } updated++ }
for (let i = 0; i < toInsert.length; i += 200) {
  const chunk = toInsert.slice(i, i + 200)
  const { data, error } = await sb.from('parts').insert(chunk.map(({ _hist, ...p }) => p)).select('id')
  if (error) { console.error('insert', error.message); process.exit(1) }
  data.forEach((row, j) => history.push({ part_id: row.id, ...chunk[j]._hist })); created += data.length
}
for (let i = 0; i < history.length; i += 300) { const { error } = await sb.from('part_price_history').insert(history.slice(i, i + 300)); if (error) { console.error('history', error.message); process.exit(1) } histRows += Math.min(300, history.length - i) }
console.log(`created ${created}, updated ${updated} (list price replaced book/web/missing), kept ${receiptKept} receipt prices, ${histRows} history rows`)
