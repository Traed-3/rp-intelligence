// ============================================================
// split-jobs-by-year — put each document on the project it belongs to.
//
// The importer matched files to a STORE number only, so a site with 20
// years of work ended up with every file on one job row. The Dropbox
// path carries the project year too ("SEI Completed/2018/32240 …"), so
// each (site, year) is a real project and gets its own job: 32240-18.
//
// Dry run by default. --commit to apply. Every document's current
// job_id is backed up first, so this is reversible.
//
//   node --env-file=.env.local scripts/ingest/split-jobs-by-year.mjs [--commit]
// ============================================================
import { writeFileSync, mkdirSync } from 'fs'

const COMMIT = process.argv.includes('--commit')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing Supabase env — run with --env-file=.env.local'); process.exit(1) }

const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

async function page(table, select) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/${table}?select=${select}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    const b = await r.json()
    if (!Array.isArray(b)) throw new Error(`${table}: ${JSON.stringify(b).slice(0, 200)}`)
    out.push(...b)
    if (b.length < 1000) break
  }
  return out
}

// Deepest folder segment carrying a 20xx year wins — that's the project folder.
function yearOf(path) {
  const segs = String(path || '').split('/')
  for (let i = segs.length - 1; i >= 0; i--) {
    const m = String(segs[i]).match(/(?<!\d)(20[0-2]\d)(?!\d)/)
    if (m) return m[1]
  }
  return null
}

console.log(`\n== split-jobs-by-year ${COMMIT ? '(COMMIT)' : '(DRY RUN)'} ==`)

const jobs = await page('con_jobs', 'id,company_id,site_number,job_number,project_start_date,stage')
const docs = await page('con_documents', 'id,job_id,source_path,file_name')
console.log(`jobs: ${jobs.length}   documents: ${docs.length}`)

const siteOf = {}
jobs.forEach(j => { siteOf[j.id] = String(j.site_number || '').trim() })

// site|YY -> existing job, preferring one whose number already matches
const byKey = new Map()
for (const j of jobs) {
  const site = String(j.site_number || '').trim()
  const yy = j.project_start_date ? j.project_start_date.slice(2, 4) : null
  if (!site || !yy) continue
  const k = `${site}|${yy}`
  if (!byKey.has(k)) byKey.set(k, j)
}
// a job already numbered SITE-YY counts even without a date
for (const j of jobs) {
  const m = String(j.job_number || '').match(/^(.+)-(\d\d)$/)
  if (m && !byKey.has(`${m[1]}|${m[2]}`)) byKey.set(`${m[1]}|${m[2]}`, j)
}

const groups = new Map()   // site|YY -> {site, yy, docIds[]}
let undated = 0
for (const d of docs) {
  const site = siteOf[d.job_id]
  const y = yearOf(d.source_path)
  if (!site || !y) { undated++; continue }
  const yy = y.slice(2)
  const k = `${site}|${yy}`
  if (!groups.has(k)) groups.set(k, { site, yy, docIds: [] })
  groups.get(k).docIds.push(d)
}

const needJob = [...groups.values()].filter(g => !byKey.has(`${g.site}|${g.yy}`))
console.log(`project groups: ${groups.size}`)
console.log(`  existing job: ${groups.size - needJob.length}`)
console.log(`  need new job: ${needJob.length}`)
console.log(`documents with no derivable year (left where they are): ${undated}`)

if (!COMMIT) {
  console.log('\nsample of jobs that would be created:')
  needJob.slice(0, 12).forEach(g => console.log(`   ${g.site}-${g.yy}  (${g.docIds.length} documents)`))
  console.log('\nDRY RUN — nothing written. Re-run with --commit')
  process.exit(0)
}

mkdirSync('scripts/ingest/backups', { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(`scripts/ingest/backups/split-backup-${stamp}.json`,
  JSON.stringify(docs.map(d => ({ id: d.id, job_id: d.job_id })), null, 0))
console.log(`\nbacked up ${docs.length} document→job links`)

// Create the missing jobs. job_number is set explicitly so the DB trigger
// leaves it alone; dates stay null because the folder only proves the year.
let created = 0
for (const g of needJob) {
  const body = {
    company_id: jobs[0].company_id,
    site_number: g.site,
    job_number: `${g.site}-${g.yy}`,
    stage: 'complete',
    notes: 'Created by split-jobs-by-year from the Dropbox project folder.',
  }
  const r = await fetch(`${url}/rest/v1/con_jobs`, {
    method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(body),
  })
  if (!r.ok) { console.warn(`  create failed ${g.site}-${g.yy}: ${(await r.text()).slice(0, 120)}`); continue }
  const [made] = await r.json()
  byKey.set(`${g.site}|${g.yy}`, made)
  created++
  if (created % 50 === 0) console.log(`  created ${created}/${needJob.length}`)
}
console.log(`created ${created} jobs`)

// Re-file every document onto its project's job.
let moved = 0, already = 0
for (const g of groups.values()) {
  const target = byKey.get(`${g.site}|${g.yy}`)
  if (!target) continue
  const ids = g.docIds.filter(d => d.job_id !== target.id).map(d => d.id)
  already += g.docIds.length - ids.length
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const r = await fetch(`${url}/rest/v1/con_documents?id=in.(${chunk.join(',')})`, {
      method: 'PATCH', headers: H, body: JSON.stringify({ job_id: target.id }),
    })
    if (r.ok) moved += chunk.length
  }
}
console.log(`\nre-filed: ${moved}   already correct: ${already}`)
console.log(`backup: scripts/ingest/backups/split-backup-${stamp}.json`)
