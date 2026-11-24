#!/usr/bin/env node
/**
 * Re-run the CURRENT (fixed) completion-note classifier over every already-
 * logged rpinvoicing import and catch up any work order whose real status
 * never made it out of svc_gmail_imports.parsed (stored 'unknown').
 *
 * This exists on top of the two earlier backfills (backfill-svc-completion-
 * status.mjs, apply-lookup-hits.mjs) because both used "skip if the work
 * order's last_update_at is already newer than this note" as their safety
 * rail — but syncInvoicing bumps last_update_at on EVERY rpinvoicing message
 * for a WO, including ones that classify as 'unknown' (a blank "Sent from my
 * iPhone" follow-up, for example). A later, useless message silently moved
 * last_update_at past a real, correctly-worded "Completed" from days earlier,
 * making that earlier backfill think the note was already stale and skip it
 * — even though the work order was still sitting at status='new'.
 *
 * So instead of trusting last_update_at, this script trusts svc_work_orders.
 * status itself: 'completed' is treated as terminal and never touched;
 * everything else ('new', 'in_progress', 'rtn_needed') is fair game for the
 * chronologically LATEST classifiable note found across ALL of that work
 * order's rpinvoicing imports (not just ones still marked 'unknown' — an
 * import logged as 'matched' can still have parsed.status = 'unknown' if it
 * predates the regex fix in 4d1e96e).
 *
 *   node scripts/reclassify-invoicing-imports.mjs            # dry run
 *   node scripts/reclassify-invoicing-imports.mjs --apply    # write
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n').map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const APPLY = process.argv.includes('--apply')

function classify(noteLower) {
  if (/\bntr\b|\brtn\b|re-?trip|return trip|return call|return needed|need.{0,4}to return|needs? (a )?return|return visit/i.test(noteLower)) return 'rtn'
  if (/incomplete/i.test(noteLower)) return 'incomplete'
  if (/\bcomplet(?:e|ed)\b|job complete/i.test(noteLower) || /^complet(?:e|ed)/i.test(noteLower)) return 'complete'
  return 'unknown'
}
function insertSignatureBoundary(text) {
  return text.replace(/(\S)(sent from my (?:iphone|ipad|ipod|android|galaxy|mobile))/gi, '$1 $2')
}

async function main() {
  const { data: imports } = await sb.from('svc_gmail_imports')
    .select('id, received_at, parsed, matched_work_order_id')
    .eq('mailbox', 'rpinvoicing')
    .not('parsed->>woNumber', 'is', null)

  const byWo = new Map()
  for (const row of imports) {
    const wo = row.parsed?.woNumber
    if (!wo) continue
    const note = row.parsed?.note ?? ''
    const status = classify(insertSignatureBoundary(note).toLowerCase())
    if (status === 'unknown') continue
    const list = byWo.get(wo) ?? []
    list.push({ status, note, date: new Date(row.received_at), importId: row.id, matchedId: row.matched_work_order_id })
    byWo.set(wo, list)
  }

  console.log(`${byWo.size} work order(s) have at least one classifiable rpinvoicing note.\n`)

  let applied = 0, skippedCompleted = 0, alreadyCorrect = 0, noWorkOrder = 0
  for (const [wo, list] of byWo) {
    list.sort((a, b) => a.date - b.date)
    const latest = list[list.length - 1]

    const { data: rows } = await sb.from('svc_work_orders').select('id, status, last_update_at').eq('portal_wo_number', wo)
    if (!rows?.length) { noWorkOrder++; continue }

    for (const row of rows) {
      if (row.status === 'completed') { skippedCompleted++; continue }
      const desiredStatus = latest.status === 'complete' ? 'completed' : latest.status === 'rtn' ? 'rtn_needed' : latest.status === 'incomplete' ? 'in_progress' : row.status
      if (desiredStatus === row.status) { alreadyCorrect++; continue }

      console.log(`${wo} [${row.id.slice(0, 8)}]: ${row.status} -> ${desiredStatus}  (note: "${latest.note.slice(0, 60).replace(/\n/g, ' ')}", ${latest.date.toISOString().slice(0, 10)})`)

      if (APPLY) {
        const updates = { last_update_at: latest.date.toISOString(), completion_note_raw: latest.note.slice(0, 1000) }
        if (desiredStatus === 'completed') { updates.status = 'completed'; updates.completed_at = latest.date.toISOString(); updates.return_trip_needed = false }
        else if (desiredStatus === 'rtn_needed') { updates.status = 'rtn_needed'; updates.return_trip_needed = true; updates.return_trip_reason = latest.note.slice(0, 1000) }
        else if (desiredStatus === 'in_progress') { updates.status = 'in_progress' }
        const { error } = await sb.from('svc_work_orders').update(updates).eq('id', row.id)
        if (error) { console.log(`  ERROR: ${error.message}`); continue }
      }
      applied++
    }
  }

  console.log(`\n${applied} work order(s) ${APPLY ? 'updated' : 'would be updated'}.`)
  console.log(`${alreadyCorrect} already correct, ${skippedCompleted} already completed (never downgraded), ${noWorkOrder} had no matching svc_work_orders row.`)
  if (!APPLY) console.log('Dry run only. Re-run with --apply to write these updates.')
}

main()
