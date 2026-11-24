#!/usr/bin/env node
/**
 * Re-classify rpinvoicing completion notes that were logged as 'unknown'
 * under the old, buggy parser (lib/svc-work-order-parser.ts) and apply the
 * correct work order update retroactively. Two real bugs, found by
 * auditing every stale (7+ days, no update) open work order against its
 * rpinvoicing completion history:
 *
 *   1. `\bcomplete\b` never matched "Completed" (past tense) — the single
 *      most common way techs actually write it.
 *   2. The RTN pattern never recognized "Ntr" (tech shorthand for Need To
 *      Return) or "need to return" phrasing (only "need a return").
 *
 * Re-runs the (now fixed) classification against each import's already-
 * stored `parsed.note` — no Gmail access needed, nothing here is refetched.
 * Only touches rows whose stored status was 'unknown' (never overrides an
 * already-definite classification), processes oldest-first per work order,
 * and skips applying if the work order has since been updated more
 * recently than this row's received_at (never regresses a WO backward past
 * something that already happened after it).
 *
 *   node scripts/backfill-svc-completion-status.mjs            # dry run
 *   node scripts/backfill-svc-completion-status.mjs --apply    # write
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n').map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const APPLY = process.argv.includes('--apply')

// Mirrors the fixed parseCompletionEmail() classification in lib/svc-work-order-parser.ts.
function classify(noteLower) {
  if (/\bntr\b|\brtn\b|re-?trip|return trip|return call|return needed|need.{0,4}to return|needs? (a )?return|return visit/i.test(noteLower)) return 'rtn'
  if (/incomplete/i.test(noteLower)) return 'incomplete'
  if (/\bcomplet(?:e|ed)\b|job complete/i.test(noteLower) || /^complet(?:e|ed)/i.test(noteLower)) return 'complete'
  return 'unknown'
}

async function main() {
  const { data: imports, error } = await sb
    .from('svc_gmail_imports')
    .select('id, matched_work_order_id, received_at, parsed, gmail_message_id')
    .eq('mailbox', 'rpinvoicing')
    .not('matched_work_order_id', 'is', null)
    .order('received_at', { ascending: true })
  if (error) { console.error(error.message); process.exit(1) }

  let reclassified = 0, applied = 0, skippedNewer = 0
  const byNewStatus = {}

  for (const row of imports) {
    const oldStatus = row.parsed?.status ?? 'unknown'
    if (oldStatus !== 'unknown') continue
    const note = row.parsed?.note ?? ''
    const newStatus = classify(note.toLowerCase())
    if (newStatus === 'unknown') continue

    reclassified++
    byNewStatus[newStatus] = (byNewStatus[newStatus] ?? 0) + 1
    console.log(`${row.received_at}  WO=${row.matched_work_order_id}  unknown -> ${newStatus}  "${note.replace(/\s+/g, ' ').slice(0, 70)}"`)

    if (!APPLY) continue

    const { data: wo } = await sb.from('svc_work_orders').select('status, last_update_at').eq('id', row.matched_work_order_id).single()
    if (!wo) continue
    if (wo.last_update_at && new Date(wo.last_update_at) > new Date(row.received_at)) {
      skippedNewer++
      console.log('  skip — work order already updated more recently than this note')
      continue
    }

    const updates = { last_update_at: row.received_at, completion_note_raw: note, completion_gmail_message_id: row.gmail_message_id }
    if (newStatus === 'complete') { updates.status = 'completed'; updates.completed_at = row.received_at; updates.return_trip_needed = false }
    else if (newStatus === 'rtn') { updates.status = 'rtn_needed'; updates.return_trip_needed = true; updates.return_trip_reason = note }
    else if (newStatus === 'incomplete') { updates.status = 'in_progress' }

    const { error: woErr } = await sb.from('svc_work_orders').update(updates).eq('id', row.matched_work_order_id)
    if (woErr) { console.log('  ERROR updating work order:', woErr.message); continue }
    await sb.from('svc_gmail_imports').update({ parsed: { ...row.parsed, status: newStatus } }).eq('id', row.id)
    applied++
  }

  console.log(`\n${reclassified} reclassified (${Object.entries(byNewStatus).map(([k, v]) => `${k}: ${v}`).join(', ')})`)
  if (APPLY) console.log(`${applied} applied, ${skippedNewer} skipped (work order had a newer update since)`)
  else console.log('Dry run only. Re-run with --apply to write these updates.')
}

main()
