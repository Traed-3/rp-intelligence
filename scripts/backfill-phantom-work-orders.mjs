#!/usr/bin/env node
/**
 * Heal the blank-shell work orders (source_portal = 'unknown', no site number).
 *
 * These were created from an answering-service transcript ("Messages") or a
 * tech's "Re: ..." reply that merely mentioned a WO# — so the row exists but
 * carries no identity. The REAL portal dispatch email usually arrives later,
 * gets matched to that same row by WO#, and is stored in svc_gmail_imports
 * with a fully parsed payload (site number, address, city/state, priority,
 * client, portal) — but nothing ever copied those fields back onto the work
 * order, so it sits on the board as a nameless row nobody can act on.
 *
 * For each shell this takes its attached imports, picks the best real dispatch
 * (a parsed.sourcePortal that isn't 'unknown', preferring the one with a site
 * number, then the earliest), and copies the identity fields across. Status,
 * dispatched_at and last_update_at are NEVER touched — only identity.
 *
 *   node scripts/backfill-phantom-work-orders.mjs            # dry run
 *   node scripts/backfill-phantom-work-orders.mjs --apply    # write
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n').map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const COMPANY_ID = env.RPS_COMPANY_ID ?? 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'
const APPLY = process.argv.includes('--apply')

const { data: shells, error } = await sb.from('svc_work_orders')
  .select('id, portal_wo_number, status, site_number, source_portal, subject_raw, archived')
  .eq('company_id', COMPANY_ID).eq('source_portal', 'unknown').order('portal_wo_number')
if (error) { console.error(error.message); process.exit(1) }
console.log(`${shells.length} blank-shell work order(s) to check.\n`)

let healed = 0, noSource = 0
for (const w of shells) {
  const { data: imports } = await sb.from('svc_gmail_imports')
    .select('id, subject, received_at, parsed').eq('matched_work_order_id', w.id).order('received_at')
  // A real dispatch = parsed by a portal parser, not the 'unknown' fallback.
  const real = (imports ?? []).filter(i => i.parsed?.sourcePortal && i.parsed.sourcePortal !== 'unknown')
  if (!real.length) {
    noSource++
    console.log(`  ${w.portal_wo_number.padEnd(13)} — no real dispatch email attached, left alone`)
    continue
  }
  real.sort((a, b) => (b.parsed.siteNumber ? 1 : 0) - (a.parsed.siteNumber ? 1 : 0) || new Date(a.received_at) - new Date(b.received_at))
  const p = real[0].parsed
  const patch = {
    source_portal: p.sourcePortal,
    site_number:   p.siteNumber   ?? w.site_number,
    site_name:     p.siteName     ?? null,
    site_address:  p.siteAddress  ?? null,
    site_city:     p.siteCity     ?? null,
    site_state:    p.siteState    ?? null,
    priority_raw:  p.priorityRaw  ?? null,
    priority_rank: p.priorityRank ?? null,
    client_name:   p.clientName   ?? null,
    subject_raw:   real[0].subject ?? w.subject_raw,
  }
  healed++
  console.log(`  ${w.portal_wo_number.padEnd(13)} ${w.status.padEnd(12)} → ${String(patch.source_portal).padEnd(15)} site ${String(patch.site_number).padEnd(10)} ${patch.priority_raw ?? ''} ${[patch.site_city, patch.site_state].filter(Boolean).join(', ')}`)
  if (APPLY) {
    const { error } = await sb.from('svc_work_orders').update(patch).eq('id', w.id)
    if (error) console.error(`     ! ${error.message}`)
  }
}

console.log(`\n${healed} healed, ${noSource} left alone (nothing to heal from).`)
if (!APPLY) console.log('Dry run — re-run with --apply to write.')
