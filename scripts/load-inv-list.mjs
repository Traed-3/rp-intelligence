#!/usr/bin/env node
/**
 * Load the master inventory list (INV LIST.xlsx, "Price Level 1" = SELL price) into the parts catalog
 * so service tickets have a price for every item.
 *
 * Source: supabase/seed/inv_list_price_level_1.csv  (item_id, description, price)
 *
 * Item IDs carry the RPS vendor prefix (GIL- Gilbarco, GRD-, VDR- Veeder-Root, IMG-, NOZ-, HOS-, FIL- …).
 * Matching to the existing catalog: the full Item ID, then the prefix-stripped ID (same rule the
 * Smartsheet shop-count import used), then the "Smartsheet Item ID …" recorded in a part's notes.
 *
 *   - Matched part  → parts.sell_price = list price. Cost fields are never touched.
 *   - No match      → a new part is created (sku INV_LIST_2026, sell price set, no cost).
 *   - A sell_billed row goes into part_price_history (once per part/price) as the audit trail.
 *
 *   node scripts/load-inv-list.mjs            # dry run — prints what would happen, writes nothing
 *   node scripts/load-inv-list.mjs --apply    # write
 * Idempotent: re-running with the same file changes nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n').map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const APPLY = process.argv.includes('--apply')
const BACKUP = process.argv.includes('--backup') ? process.argv[process.argv.indexOf('--backup') + 1] : null
const SKU = 'INV_LIST_2026'
const REF = 'INV LIST - Price Level 1'
const TODAY = new Date().toISOString().slice(0, 10)

const FAMILY = { GIL: ['Gilbarco', 'Gilbarco dispenser parts'], VDR: ['Veeder-Root', 'Veeder-Root ATG parts'], GRD: [null, 'Sump / tank / piping hardware'], FIL: [null, 'Filters'], NOZ: [null, 'Nozzles, swivels & breakaways'], HOS: [null, 'Hoses'], VAP: [null, 'Vapor recovery'], IMG: [null, 'ID tags, markers & signage'], INT: [null, 'Intercom'], MAY: [null, 'Signage & decals'], ENS: [null, 'Stands & mounts'] }
const norm = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const strip = s => s.replace(/^[A-Z]{3}-(?=[A-Z0-9])/, '')
const title = s => s.toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\b(Opw|Rj|Ppu|Crind|Ada|Epp|Usb|Tls|Plld|Dim|Stp|Cpu|Led|Lcd|Ac|Dc|Ss|Npt|Def|Nvp|Vp|Hp|Mag|Fe|Emco|Ebw|Wawa|Sunoco|Exxon|Ux300|Ux400|Mx915|Mx925|Ii|Iii|Pcb|Pca|Evo|Tsp|Fmp|Sd)\b/g, m => m.toUpperCase())

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

const { data: co } = await sb.from('companies').select('id').order('created_at').limit(1).single()
const company_id = co.id

const parts = []
for (let f = 0; ; f += 1000) {
  const { data } = await sb.from('parts').select('id, part_number, sku, description, sell_price, notes').eq('company_id', company_id).range(f, f + 999)
  parts.push(...(data ?? []))
  if (!data || data.length < 1000) break
}
const byNorm = new Map(), byNote = new Map(); let dupKeys = 0
for (const p of parts) {
  if (p.part_number) { const k = norm(p.part_number); if (byNorm.has(k)) dupKeys++; else byNorm.set(k, p) }
  const m = (p.notes ?? '').match(/(?:Smartsheet|INV LIST) Item ID (\S+)/); if (m) byNote.set(norm(m[1]), p)
}

const list = csv(resolve(__dirname, '..', 'supabase/seed/inv_list_price_level_1.csv')).filter(r => r.item_id && isFinite(Number(r.price)))
const toUpdate = [], toCreate = [], same = [], conflicts = []
const claimed = new Set()
for (const r of list) {
  const item = r.item_id.trim(), price = Math.round(Number(r.price) * 100) / 100
  const hit = byNorm.get(norm(item)) ?? byNorm.get(norm(strip(item))) ?? byNote.get(norm(item))
  if (hit) {
    if (claimed.has(hit.id)) { conflicts.push({ item, why: 'two list rows match one part', part: hit.part_number }); continue }
    claimed.add(hit.id)
    if (hit.sell_price != null && Number(hit.sell_price) === price) same.push(hit)
    else {
      if (hit.sell_price != null) conflicts.push({ item, why: `existing sell ${hit.sell_price} -> ${price}`, part: hit.part_number })
      toUpdate.push({ id: hit.id, price, item, part_number: hit.part_number, previous: hit.sell_price })
    }
  } else {
    const prefix = item.slice(0, 3), fam = /^[A-Z]{3}-/.test(item) ? FAMILY[prefix] : null
    toCreate.push({ company_id, sku: SKU, part_number: strip(item), manufacturer: fam?.[0] ?? null, description: title((r.description || item).trim()), category: 4, category_name: 'PUMP & TANK MATERIALS', subcategory: fam?.[1] ?? 'Master inventory list', item_type: 'material', taxable: true, is_stocked: false, unit_cost: null, cost_source: null, price_status: 'ok', freight_per_unit: 0, sell_price: price, notes: `INV LIST Item ID ${item}; Price Level 1 sell price` })
  }
}

console.log(`list rows ${list.length}; catalog parts ${parts.length} (${dupKeys} duplicate part numbers ignored)`)
console.log(`  matched, sell price already equal: ${same.length}`)
console.log(`  matched, will SET/CHANGE sell price: ${toUpdate.length} (of which replacing a different existing sell price: ${conflicts.filter(c => c.why.startsWith('existing')).length})`)
console.log(`  not in catalog, will CREATE: ${toCreate.length}`)
console.log(`  skipped (two list rows → one part): ${conflicts.filter(c => c.why.startsWith('two')).length}`)
conflicts.filter(c => c.why.startsWith('two')).forEach(c => console.log('   skipped:', c.item, '|', c.part))
conflicts.filter(c => !c.why.startsWith('two')).slice(0, 12).forEach(c => console.log('   !', c.item, '|', c.why, '|', c.part))
toCreate.slice(0, 6).forEach(p => console.log('   new:', p.part_number, '|', p.description, '|', p.sell_price))
if (!APPLY) { console.log('\nDry run — nothing written. Re-run with --apply.'); process.exit(0) }

if (BACKUP) { writeFileSync(BACKUP, JSON.stringify(toUpdate.map(({ id, item, part_number, previous }) => ({ id, item, part_number, previous_sell_price: previous })), null, 1)); console.log(`backup of previous sell prices -> ${BACKUP}`) }
const { data: hist } = await sb.from('part_price_history').select('part_id, price').eq('reference', REF)
const seen = new Set((hist ?? []).map(h => `${h.part_id}|${Number(h.price)}`))
const history = []
const hrow = (part_id, price) => ({ part_id, kind: 'sell_billed', price, vendor: null, reference: REF, observed_on: TODAY, source_note: 'Master INV LIST.xlsx — Price Level 1 (sell)' })

let updated = 0
for (const u of toUpdate) {
  const { error } = await sb.from('parts').update({ sell_price: u.price }).eq('id', u.id)
  if (error) { console.error('update failed', u.item, error.message); process.exit(1) }
  updated++
  if (!seen.has(`${u.id}|${u.price}`)) history.push(hrow(u.id, u.price))
}
let created = 0
for (let i = 0; i < toCreate.length; i += 200) {
  const chunk = toCreate.slice(i, i + 200)
  const { data, error } = await sb.from('parts').insert(chunk).select('id, sell_price')
  if (error) { console.error('insert failed', error.message); process.exit(1) }
  data.forEach(row => history.push(hrow(row.id, Number(row.sell_price)))); created += data.length
}
for (let i = 0; i < history.length; i += 300) {
  const { error } = await sb.from('part_price_history').insert(history.slice(i, i + 300))
  if (error) { console.error('history failed', error.message); process.exit(1) }
}
console.log(`\nApplied: ${updated} sell prices set, ${created} parts created, ${history.length} history rows.`)
