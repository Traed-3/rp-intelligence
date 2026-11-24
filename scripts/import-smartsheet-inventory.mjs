#!/usr/bin/env node
/**
 * Import the shop inventory count from Smartsheet into the inventory ledger.
 *
 * Source: supabase/seed/smartsheet_shop_inventory_2025-12-31.csv — every row with
 * a quantity from the Smartsheet sheet "2025/2026 INVENTORY 12/31/25"
 * (columns: Item ID, Description, QTY, LOCATION). LOCATION there is a shelf/bin
 * in the shop (1–115, BLDG, GARAGE, OFFICE, TOTE ROOM…), so everything lands on
 * the "Office / Hill" location with the bin recorded on stock_levels.
 *
 * Item IDs carry an RPS vendor prefix (GIL- Gilbarco, VDR- Veeder-Root, GRD-,
 * NOZ-, HOS-, FIL-…). The prefix is stripped to match the catalog; parts that
 * are not in the catalog yet are created with price_status 'price_needed' and
 * sku 'SMARTSHEET_2025' so they can be told apart later.
 *
 * Ledger rows are posted as txn_type 'count' with ref_label 'SMARTSHEET-2025-12-31',
 * so re-running is a no-op for parts already imported.
 *
 *   node scripts/import-smartsheet-inventory.mjs            # dry run — prints what would happen
 *   node scripts/import-smartsheet-inventory.mjs --apply    # write parts, ledger rows, bins
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n').map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const APPLY = process.argv.includes('--apply')
const REF = 'SMARTSHEET-2025-12-31'
const SKU = 'SMARTSHEET_2025'
const LOCATION_NAME = 'Office / Hill'

const FAMILY = { GIL: ['Gilbarco', 'Gilbarco dispenser parts'], VDR: ['Veeder-Root', 'Veeder-Root ATG parts'], GRD: [null, 'Sump / tank / piping hardware'], FIL: [null, 'Filters'], NOZ: [null, 'Nozzles, swivels & breakaways'], HOS: [null, 'Hoses'], VAP: [null, 'Vapor recovery'], IMG: [null, 'ID tags, markers & signage'], INT: [null, 'Intercom'], MAY: [null, 'Signage & decals'], ENS: [null, 'Stands & mounts'] }

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
const norm = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const strip = s => s.replace(/^[A-Z]{3}-(?=[A-Z0-9])/, '')
const title = s => s.toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\b(Opw|Rj|Ppu|Crind|Ada|Epp|Usb|Tls|Plld|Dim|Stp|Cpu|Led|Lcd|Ac|Dc|Ss|Npt|Def|Nvp|Vp|Hp|Mag|Fe|Emco|Ebw|Wawa|Sunoco|Exxon|Ux300|Ux400|Mx915|Mx925|Ii|Iii|Pcb|Pca|Evo|Tsp|Fmp|Sd)\b/g, m => m.toUpperCase())

const { data: co } = await sb.from('companies').select('id').order('created_at').limit(1).single()
const company_id = co.id
const { data: loc } = await sb.from('stock_locations').select('id').eq('company_id', company_id).eq('name', LOCATION_NAME).single()
if (!loc) { console.error(`location "${LOCATION_NAME}" not found`); process.exit(1) }

// catalog by normalized part number (and by normalized sku for anything imported earlier)
const parts = []
for (let f = 0; ; f += 1000) { const { data } = await sb.from('parts').select('id, part_number, sku, description, is_stocked').eq('company_id', company_id).range(f, f + 999); parts.push(...(data ?? [])); if (!data || data.length < 1000) break }
const byNorm = new Map()
for (const p of parts) if (p.part_number) byNorm.set(norm(p.part_number), p)

// already-imported ledger rows → idempotent
const { data: done } = await sb.from('inventory_transactions').select('part_id').eq('location_id', loc.id).eq('ref_label', REF)
const doneParts = new Set((done ?? []).map(r => r.part_id))

// aggregate the sheet: one line per item id (same part on two shelves → qty summed, bins joined)
const rows = csv(resolve(__dirname, '..', 'supabase/seed/smartsheet_shop_inventory_2025-12-31.csv'))
const agg = new Map()
let skipped = 0
for (const r of rows) {
  const item = (r.item_id || '').trim(); const qty = Number(r.qty)
  if (!item || !isFinite(qty) || qty <= 0) { skipped++; continue }
  const key = norm(strip(item)) || norm(item)
  const cur = agg.get(key) ?? { item, core: strip(item), description: (r.description || item).trim(), qty: 0, bins: new Set() }
  cur.qty += qty; if (r.location) cur.bins.add(r.location.replace(/\.0$/, '')); agg.set(key, cur)
}

const toCreate = [], toPost = []
let matched = 0
for (const [key, a] of agg) {
  let p = byNorm.get(key)
  if (p) matched++
  else {
    const prefix = a.item.slice(0, 3); const fam = /^[A-Z]{3}-/.test(a.item) ? FAMILY[prefix] : null
    p = { _new: true, company_id, sku: SKU, part_number: a.core, manufacturer: fam?.[0] ?? null, description: title(a.description), category: 4, category_name: 'PUMP & TANK MATERIALS', subcategory: fam?.[1] ?? 'Shop stock (Smartsheet)', item_type: 'material', taxable: true, is_stocked: true, unit_cost: null, cost_source: null, price_status: 'price_needed', freight_per_unit: 0, notes: `Smartsheet Item ID ${a.item}; shop count 12/31/25` }
    toCreate.push(p)
  }
  toPost.push({ p, a })
}
console.log(`sheet rows ${rows.length}, usable ${[...agg.values()].length} unique items (skipped ${skipped} blank/zero), matched to catalog ${matched}, new parts ${toCreate.length}, already posted ${toPost.filter(x => !x.p._new && doneParts.has(x.p.id)).length}`)
console.log('total units', [...agg.values()].reduce((s, a) => s + a.qty, 0))
if (!APPLY) { console.log('\nDry run. Sample of new parts:'); toCreate.slice(0, 8).forEach(p => console.log(' ', p.part_number, '|', p.description, '|', p.subcategory)); console.log('\nRe-run with --apply to write.'); process.exit(0) }

// 1. create missing parts
for (let i = 0; i < toCreate.length; i += 100) {
  const chunk = toCreate.slice(i, i + 100)
  const { data, error } = await sb.from('parts').insert(chunk.map(({ _new, ...p }) => p)).select('id, part_number')
  if (error) { console.error('insert parts failed', error.message); process.exit(1) }
  data.forEach((row, j) => { chunk[j].id = row.id })
}
console.log(`created ${toCreate.length} parts`)

// 2. post opening balances + bins
const txns = [], levels = [], stockedIds = []
for (const { p, a } of toPost) {
  if (doneParts.has(p.id)) continue
  const bin = [...a.bins].join('/') || null
  txns.push({ company_id, txn_type: 'count', part_id: p.id, location_id: loc.id, qty: a.qty, ref_type: 'count', ref_label: REF, note: `Opening balance from Smartsheet "2025/2026 INVENTORY 12/31/25"${bin ? ` — bin ${bin}` : ''}` })
  if (bin) levels.push({ location_id: loc.id, part_id: p.id, bin })
  if (!p._new && !p.is_stocked) stockedIds.push(p.id)
}
for (let i = 0; i < txns.length; i += 200) { const { error } = await sb.from('inventory_transactions').insert(txns.slice(i, i + 200)); if (error) { console.error('ledger insert failed', error.message); process.exit(1) } }
for (let i = 0; i < levels.length; i += 200) { const { error } = await sb.from('stock_levels').upsert(levels.slice(i, i + 200), { onConflict: 'location_id,part_id', ignoreDuplicates: false }); if (error) { console.error('bins upsert failed', error.message); process.exit(1) } }
for (let i = 0; i < stockedIds.length; i += 200) { const { error } = await sb.from('parts').update({ is_stocked: true }).in('id', stockedIds.slice(i, i + 200)); if (error) { console.error('is_stocked update failed', error.message); process.exit(1) } }
console.log(`posted ${txns.length} opening balances, ${levels.length} bins, flagged ${stockedIds.length} catalog parts as stocked`)
