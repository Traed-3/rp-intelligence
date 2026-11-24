#!/usr/bin/env node
/**
 * Apply the results of a targeted rpinvoicing lookup (pass=lookup) to the
 * work orders it was run for. Reads a JSON array of Gmail search hits
 * ({id, subject, from, date, snippet}), classifies each with the same
 * (fixed) logic as parseCompletionEmail, picks the latest real status per
 * work order (matched by WO# in the subject), and applies it — same safety
 * rule as the other backfill: skip if the work order was already updated
 * more recently than this note.
 *
 *   node scripts/apply-lookup-hits.mjs <hits.json>            # dry run
 *   node scripts/apply-lookup-hits.mjs <hits.json> --apply    # write
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n').map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const APPLY = process.argv.includes('--apply')
const hitsPath = process.argv[2]
if (!hitsPath || hitsPath.startsWith('--')) { console.error('Usage: node scripts/apply-lookup-hits.mjs <hits.json> [--apply]'); process.exit(1) }

const WO_NUMBER = /\b(WOT\d+|FWKD\d+)\b/
const FORWARD_MARKERS = [/-{5,}\s*Forwarded message\s*-{3,}/i, /Begin forwarded message:/i]

function decodeEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/﻿/g, '')
}
function techNote(body) {
  let cut = body.length
  for (const m of FORWARD_MARKERS) { const mm = body.match(m); if (mm && mm.index < cut) cut = mm.index }
  return body.slice(0, cut).trim()
}
function classify(noteLower) {
  if (/\bntr\b|\brtn\b|re-?trip|return trip|return call|return needed|need.{0,4}to return|needs? (a )?return|return visit/i.test(noteLower)) return 'rtn'
  if (/incomplete/i.test(noteLower)) return 'incomplete'
  if (/\bcomplet(?:e|ed)\b|job complete/i.test(noteLower) || /^complet(?:e|ed)/i.test(noteLower)) return 'complete'
  return 'unknown'
}

async function main() {
  const hits = JSON.parse(readFileSync(hitsPath, 'utf-8'))
  const byWo = new Map() // wo -> [{date, status, note, id}]

  for (const h of hits) {
    const wo = h.subject.match(WO_NUMBER)?.[1]
    if (!wo) continue
    const note = techNote(decodeEntities(h.snippet))
    const status = classify(note.toLowerCase())
    if (status === 'unknown') continue
    const date = new Date(h.date)
    const list = byWo.get(wo) ?? []
    list.push({ date, status, note, id: h.id })
    byWo.set(wo, list)
  }

  console.log(`${byWo.size} work order(s) with a classifiable note out of ${hits.length} hits.\n`)

  let applied = 0, skipped = 0
  for (const [wo, list] of byWo) {
    list.sort((a, b) => a.date - b.date)
    const latest = list[list.length - 1]
    console.log(`${wo}: ${list.map(l => `${l.date.toISOString().slice(0, 10)}=${l.status}`).join(' -> ')}  =>  FINAL: ${latest.status}`)

    const { data: rows } = await sb.from('svc_work_orders').select('id, status, last_update_at').eq('portal_wo_number', wo)
    if (!rows?.length) { console.log('  no matching work order in DB'); continue }
    for (const row of rows) {
      if (row.last_update_at && new Date(row.last_update_at) > latest.date) {
        console.log(`  [${row.id}] skip — already updated more recently`); skipped++; continue
      }
      const updates = { last_update_at: latest.date.toISOString(), completion_note_raw: latest.note, completion_gmail_message_id: latest.id }
      if (latest.status === 'complete') { updates.status = 'completed'; updates.completed_at = latest.date.toISOString(); updates.return_trip_needed = false }
      else if (latest.status === 'rtn') { updates.status = 'rtn_needed'; updates.return_trip_needed = true; updates.return_trip_reason = latest.note }
      else if (latest.status === 'incomplete') { updates.status = 'in_progress' }
      console.log(`  [${row.id}] ${row.status} -> ${updates.status}`)
      if (APPLY) {
        const { error } = await sb.from('svc_work_orders').update(updates).eq('id', row.id)
        if (error) { console.log('    ERROR:', error.message); continue }
        applied++
      }
    }
  }
  console.log(`\n${applied} applied, ${skipped} skipped${APPLY ? '' : ' (dry run — pass --apply)'}`)
}

main()
