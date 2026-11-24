#!/usr/bin/env node
/**
 * Merge the duplicate svc_work_orders rows created by the bug fixed in
 * 47409f7 (2026-09-18): before that fix, ANY email in rpdispatcher that
 * happened to mention a WO# (even an unrelated "Messages" auto-transcript
 * from an answering service) would create a brand-new work order for that
 * WO# instead of recognizing one already existed — spawning a real row
 * (source_portal = 7help/wtsc/it_service_desk) plus a detail-blank phantom
 * (source_portal = 'unknown'). syncInvoicing's WO#-matching always takes
 * the most-recently-dispatched candidate, so completion notes have been
 * landing on whichever twin happens to be newer — sometimes the real one,
 * sometimes the phantom — leaving the other stuck at 'new' forever.
 *
 * For each duplicate portal_wo_number pair:
 *   - primary   = the row with a real source_portal (7help/wtsc/
 *                 it_service_desk); if both (or neither) are real, the
 *                 earliest-dispatched one.
 *   - secondary = the other one (the phantom, almost always).
 *   - Whichever of the two has the LATER last_update_at is the more
 *     truthful one for status/completion fields — those fields are copied
 *     onto primary (primary's own identity — site, dispatched_at, subject,
 *     source_portal — is never touched).
 *   - Every reference to secondary's id (svc_gmail_imports.
 *     matched_work_order_id, service_tickets.work_order_id,
 *     svc_work_order_documents.work_order_id) is repointed to primary.
 *   - secondary is then deleted.
 *
 *   node scripts/merge-duplicate-work-orders.mjs            # dry run
 *   node scripts/merge-duplicate-work-orders.mjs --apply    # write
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n').map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const APPLY = process.argv.includes('--apply')

const STATUS_FIELDS = [
  'status', 'last_update_at', 'completed_at', 'return_trip_needed', 'return_trip_reason',
  'completion_note_raw', 'completion_gmail_message_id', 'assigned_technician_id',
  'invoice_rejected', 'invoice_rejection_reason',
]

async function main() {
  const { data: rows } = await sb.from('svc_work_orders')
    .select('id, portal_wo_number, source_portal, dispatched_at, ' + STATUS_FIELDS.join(', '))
    .not('portal_wo_number', 'is', null)
    .order('portal_wo_number')

  const groups = new Map()
  for (const r of rows) {
    const list = groups.get(r.portal_wo_number) ?? []
    list.push(r)
    groups.set(r.portal_wo_number, list)
  }

  let pairs = 0, merged = 0, statusUpgrades = 0
  const errors = []

  for (const [wo, list] of groups) {
    if (list.length < 2) continue
    if (list.length > 2) { errors.push(`${wo}: ${list.length} rows, not just 2 — skipping, needs manual look`); continue }
    pairs++

    const isReal = (r) => ['7help', 'wtsc', 'it_service_desk'].includes(r.source_portal)
    let [a, b] = list
    let primary, secondary
    if (isReal(a) && !isReal(b)) [primary, secondary] = [a, b]
    else if (isReal(b) && !isReal(a)) [primary, secondary] = [b, a]
    else [primary, secondary] = new Date(a.dispatched_at) <= new Date(b.dispatched_at) ? [a, b] : [b, a]

    const truthSource = new Date(secondary.last_update_at ?? 0) > new Date(primary.last_update_at ?? 0) ? secondary : primary
    const upgrading = truthSource === secondary
    if (upgrading) statusUpgrades++

    console.log(`${wo}: primary=${primary.id.slice(0, 8)} (${primary.source_portal}, ${primary.status}) secondary=${secondary.id.slice(0, 8)} (${secondary.source_portal}, ${secondary.status})${upgrading ? `  -> adopting secondary's status (${secondary.status})` : ''}`)

    if (!APPLY) continue

    if (upgrading) {
      const updates = {}
      for (const f of STATUS_FIELDS) updates[f] = secondary[f]
      const { error } = await sb.from('svc_work_orders').update(updates).eq('id', primary.id)
      if (error) { errors.push(`${wo}: update primary failed: ${error.message}`); continue }
    }

    const repoint = async (table, col) => {
      const { error } = await sb.from(table).update({ [col]: primary.id }).eq(col, secondary.id)
      if (error) errors.push(`${wo}: repoint ${table}.${col} failed: ${error.message}`)
    }
    await repoint('svc_gmail_imports', 'matched_work_order_id')
    await repoint('service_tickets', 'work_order_id')
    await repoint('svc_work_order_documents', 'work_order_id')

    const { error: delErr } = await sb.from('svc_work_orders').delete().eq('id', secondary.id)
    if (delErr) { errors.push(`${wo}: delete secondary failed: ${delErr.message}`); continue }
    merged++
  }

  console.log(`\n${pairs} duplicate pair(s) found, ${statusUpgrades} needed a status upgrade from the secondary row.`)
  if (APPLY) console.log(`${merged} merged and deleted.`)
  else console.log('Dry run only. Re-run with --apply to write these merges.')
  if (errors.length) { console.log('\nErrors/skips:'); errors.forEach(e => console.log('  ' + e)) }
}

main()
