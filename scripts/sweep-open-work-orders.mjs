#!/usr/bin/env node
/**
 * Ask rpinvoicing whether every currently-open work order has a completion
 * email that was never applied — the bulk version of the `pass=lookup`
 * diagnostic, which only takes one hand-built query at a time.
 *
 * Reads the open work orders straight from the database, batches their WO#s
 * into `subject:(WO1 OR WO2 OR ...)` queries (Gmail caps query length, so
 * BATCH keeps each one short), calls the deployed lookup endpoint, and writes
 * every hit to a JSON file in the shape scripts/apply-lookup-hits.mjs expects.
 *
 * Read-only: this writes nothing to the database. Apply the result with
 *   node scripts/apply-lookup-hits.mjs <out.json> --apply
 *
 *   node scripts/sweep-open-work-orders.mjs                 # → /tmp/wo-sweep.json
 *   node scripts/sweep-open-work-orders.mjs --out hits.json --batch 15
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n').map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const COMPANY_ID = env.RPS_COMPANY_ID ?? 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'
const BASE = process.env.SWEEP_BASE ?? 'https://rpintelligence.app'

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : dflt }
const OUT = arg('--out', '/tmp/wo-sweep.json')
const BATCH = parseInt(arg('--batch', '12'), 10)
const OPEN = ['new', 'dispatched', 'accepted', 'en_route', 'on_site', 'in_progress', 'waiting_parts', 'rtn_needed']

const { data: wos, error } = await sb.from('svc_work_orders')
  .select('portal_wo_number, status, dispatched_at')
  .eq('company_id', COMPANY_ID).eq('archived', false).in('status', OPEN)
  .not('portal_wo_number', 'is', null).order('dispatched_at')
if (error) { console.error(error.message); process.exit(1) }

const numbers = [...new Set(wos.map(w => w.portal_wo_number))]
console.log(`${numbers.length} open work orders to check against rpinvoicing, ${Math.ceil(numbers.length / BATCH)} queries.\n`)

const seen = new Map()
for (let i = 0; i < numbers.length; i += BATCH) {
  const slice = numbers.slice(i, i + BATCH)
  const q = `subject:(${slice.join(' OR ')})`
  const url = `${BASE}/api/svc/gmail-sync?pass=lookup&q=${encodeURIComponent(q)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } })
  if (!res.ok) { console.error(`  batch ${i / BATCH + 1}: HTTP ${res.status}`); continue }
  const body = await res.json()
  for (const h of body.hits ?? []) seen.set(h.id, h)
  process.stdout.write(`  batch ${String(i / BATCH + 1).padStart(2)}: ${String(body.count ?? 0).padStart(3)} hit(s)\n`)
}

const hits = [...seen.values()]
writeFileSync(OUT, JSON.stringify(hits, null, 1))

// Which of the open work orders actually got a hit — that is the useful summary.
const WO = /\b(WOT\d+|FWKD\d+)\b/g
const hitFor = new Map()
for (const h of hits) for (const m of (h.subject ?? '').matchAll(WO)) {
  const list = hitFor.get(m[1]) ?? []; list.push(h); hitFor.set(m[1], list)
}
const withMail = numbers.filter(n => hitFor.has(n))
const without = numbers.filter(n => !hitFor.has(n))
console.log(`\n${hits.length} message(s) → ${withMail.length} of ${numbers.length} open work orders have mail in rpinvoicing.`)
for (const n of withMail) {
  const latest = hitFor.get(n).sort((a, b) => new Date(b.date) - new Date(a.date))[0]
  const wo = wos.find(w => w.portal_wo_number === n)
  console.log(`  ${n.padEnd(13)} ${wo.status.padEnd(12)} ${new Date(latest.date).toISOString().slice(0, 10)}  ${(latest.snippet ?? '').replace(/\s+/g, ' ').slice(0, 90)}`)
}
console.log(`\n${without.length} open work order(s) have no rpinvoicing mail at all (genuinely open, or the tech never sent one):`)
console.log('  ' + without.join(', '))
console.log(`\nHits written to ${OUT}\n  node scripts/apply-lookup-hits.mjs ${OUT}            # dry run\n  node scripts/apply-lookup-hits.mjs ${OUT} --apply    # write`)
