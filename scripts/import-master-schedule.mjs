#!/usr/bin/env node
/**
 * One-time import of Starsky's live "Master Schedule" (Job List tab) into
 * con_jobs, so the app's Construction dashboard/jobs list/schedule replicate
 * what he's tracking in Excel today.
 *
 * Source: a cleaned dump of the Dropbox workbook
 * "Construction Department/1-Master Schedule/1 - Schedule/1 - Master schedule .xlsm"
 * (Job List tab), classified into the app's CON_STAGES by keyword match on
 * Starsky's free-text status column (color alone isn't reliable — he reuses
 * yellow/red for many different meanings). The exact free-text status is kept
 * on status_detail so nothing is lost even where the coarse stage is a guess.
 *
 * Idempotent: skips any row whose (site_number, work_order_number) pair
 * already exists in con_jobs, so re-running after fixing the source JSON only
 * inserts what's missing.
 *
 *   node scripts/import-master-schedule.mjs            # dry run — prints what would happen
 *   node scripts/import-master-schedule.mjs --apply    # write the jobs
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n').map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const APPLY = process.argv.includes('--apply')

const SOURCE_JSON = '/tmp/claude-501/-Users-rpsstudio2-Developer-rps-maintenance/2dd86d6e-10f9-4e9b-aea9-36be7f66ec01/scratchpad/schedule/jobs_clean.json'

// Same rules as lib/site-number.ts, duplicated here since this script runs
// as plain JS (no ts-node) and is a one-off.
function classifySite(raw) {
  const s = (raw ?? '').replace(/^\s*United States\s+/i, '').replace(/\s+/g, ' ').trim()
  if (!s) return { siteNumber: '', brand: null }
  const up = s.toUpperCase()
  if (up.includes('CPG') || up.includes('CAPITAL') || /^CP[\s-]?\d/.test(up)) {
    const m = up.match(/(\d{3,5})/)
    return m ? { siteNumber: `${m[1]}-CPG`, brand: 'Capital Petroleum' } : { siteNumber: s, brand: 'Capital Petroleum' }
  }
  if (/^SU[\s-]?\d/.test(up) || up.includes('SUNOCO')) {
    const m = up.match(/SU[\s-]?(\d+)/) ?? up.match(/(\d{3,5})/)
    return m ? { siteNumber: `SU-${m[1]}`, brand: 'Sunoco' } : { siteNumber: s, brand: 'Sunoco' }
  }
  if (up.includes('GLOBAL')) {
    const m = up.match(/(\d{3,5})/)
    return m ? { siteNumber: m[1], brand: 'Global' } : { siteNumber: s, brand: 'Global' }
  }
  if (/^IP[\s-]?\d/.test(up)) {
    const m = up.match(/^(IP[\w-]*)/)
    return { siteNumber: m ? m[1] : s, brand: 'Independent' }
  }
  const tb = up.includes('SHEETZ') ? 'Sheetz' : up.includes('WAWA') ? 'Wawa'
    : (up.includes('7-ELEVEN') || up.includes('7 ELEVEN')) ? '7-Eleven' : null
  const nums = s.match(/\d+/g) ?? []
  if (nums.length === 1) {
    const n = nums[0]
    if (n.length === 5) {
      return (tb && tb !== '7-Eleven') ? { siteNumber: s, brand: tb } : { siteNumber: n, brand: '7-Eleven' }
    }
    if ((n.length === 3 || n.length === 4) && (tb === 'Sheetz' || tb === 'Wawa')) return { siteNumber: n, brand: tb }
    if (n.length === 3) return { siteNumber: n, brand: 'Sheetz/Wawa' }
  }
  return { siteNumber: s, brand: tb }
}

async function main() {
  const jobs = JSON.parse(readFileSync(SOURCE_JSON, 'utf-8'))

  const { data: company, error: cErr } = await sb.from('companies').select('id, name').limit(1).single()
  if (cErr || !company) { console.error('Could not find a company row:', cErr?.message); process.exit(1) }
  console.log(`Company: ${company.name} (${company.id})`)

  const { data: existing } = await sb.from('con_jobs').select('site_number, work_order_number').eq('company_id', company.id)
  const existingKeys = new Set((existing ?? []).map(j => `${j.site_number ?? ''}::${j.work_order_number ?? ''}`))

  let inserted = 0, skipped = 0
  const toInsert = []
  for (const j of jobs) {
    const { siteNumber, brand } = classifySite(j.site_number_raw)
    const wo = j.work_order_number
    const key = `${siteNumber}::${wo ?? ''}`
    if (existingKeys.has(key)) { skipped++; continue }
    existingKeys.add(key) // guard against dupes within this same import batch too
    toInsert.push({
      company_id: company.id,
      site_number: siteNumber || j.site_number_raw,
      gas_brand: brand,
      work_order_number: wo,
      stage: j.stage,
      status_detail: j.status_detail,
      facility_address: j.facility_address,
      scope_of_work: j.scope_of_work,
      notes: j.notes,
      priority: 'normal',
    })
  }

  console.log(`${toInsert.length} new job(s) to insert, ${skipped} already present, ${jobs.length} total in source.`)
  const byStage = {}
  for (const j of toInsert) byStage[j.stage] = (byStage[j.stage] ?? 0) + 1
  for (const [stage, count] of Object.entries(byStage).sort((a, b) => b[1] - a[1])) console.log(`  ${stage}: ${count}`)

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write these rows.')
    return
  }

  const { error } = await sb.from('con_jobs').insert(toInsert)
  if (error) { console.error('Insert failed:', error.message); process.exit(1) }
  console.log(`\nInserted ${toInsert.length} jobs into con_jobs.`)
}

main()
