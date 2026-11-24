// ============================================================
// assign-job-customers — put a customer on every job.
//
// Two signals, strongest first:
//   1. the Dropbox folder the job's documents came from
//      ("SEI Completed", "Capitol Petroleum", "VIXXO 2023")
//   2. the shape of the site number, per Trae:
//        SU-####  Sunoco     CPG####  Capital Petroleum
//        3 digits Sheetz     4 digits Global Partners
//        5 digits 7-Eleven
//
// Only fills jobs that have no customer. Dry run unless --commit.
//
//   node --env-file=.env.local scripts/ingest/assign-job-customers.mjs [--commit]
// ============================================================
import { writeFileSync, mkdirSync } from 'fs'

const COMMIT = process.argv.includes('--commit')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

async function page(table, select) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/${table}?select=${select}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    const b = await r.json()
    if (!Array.isArray(b)) throw new Error(JSON.stringify(b).slice(0, 200))
    out.push(...b)
    if (b.length < 1000) return out
  }
}

// Folder-name rules. Same spelling variants the invoice linker handles.
const FOLDER_RULES = [
  [/sei|7\s*-?\s*eleven/i,        '7-Eleven'],
  [/\bvixxo\b/i,                  'Vixxo'],
  [/\bsheetz\b/i,                 'Sheetz'],
  [/\bwawa\b/i,                   'Wawa'],
  [/\baecom\b/i,                  'AECOM'],
  [/capit[oa]l\s+petroleum/i,     'Capital Petroleum Group'],
  [/global\s+partners?/i,         'Global Partners'],
  [/\bsunoco\b/i,                 'Sunoco LP'],
  [/\bspeedway\b/i,               'IDS-Speedway'],
  [/travel\s*america|\bTA\d/i,    'Travel America'],
  [/\bvericon\b/i,                'Vericon'],
  [/jefferson\s+county/i,         'Jefferson County Schools'],
  [/\bosse\b/i,                   'OSSE'],
  [/jf\s+petroleum/i,             'JF Petroleum Group'],
  [/\bics\b|imagine\s+commer/i,   'ICS'],
  [/\btanknology\b/i,             'Tanknology'],
]

// Site-number shape. Only used when the folder says nothing.
function fromSiteNumber(site) {
  const s = String(site ?? '').trim()
  if (!s) return null
  if (/^SU-/i.test(s)) return 'Sunoco LP'
  if (/^CPG\d/i.test(s)) return 'Capital Petroleum Group'
  if (/wawa/i.test(s)) return 'Wawa'
  if (/sheetz/i.test(s)) return 'Sheetz'
  if (/sunoco/i.test(s)) return 'Sunoco LP'
  const digits = s.match(/(?<!\d)(\d{3,5})(?!\d)/)
  if (!digits) return null
  const n = digits[1]
  if (n.length === 5) return '7-Eleven'
  if (n.length === 3) return 'Sheetz'
  if (n.length === 4) return 'Global Partners'
  return null
}

console.log(`\n== assign-job-customers ${COMMIT ? '(COMMIT)' : '(DRY RUN)'} ==`)

const customers = new Map((await page('con_customers', 'id,name')).map(c => [c.name.toLowerCase(), c]))
const jobs = await page('con_jobs', 'id,site_number,customer_id,company_id')
const docs = await page('con_documents', 'job_id,source_path')

const pathsByJob = new Map()
for (const d of docs) {
  if (!d.source_path || !d.job_id) continue
  if (!pathsByJob.has(d.job_id)) pathsByJob.set(d.job_id, [])
  pathsByJob.get(d.job_id).push(d.source_path)
}

const plan = []
let viaFolder = 0, viaShape = 0
const unresolved = []

for (const job of jobs) {
  if (job.customer_id) continue
  let name = null

  // deepest folder segment first, so the customer folder beats the year above it
  for (const p of pathsByJob.get(job.id) ?? []) {
    const segs = p.split('/').filter(Boolean).reverse()
    for (const seg of segs) {
      const hit = FOLDER_RULES.find(([re]) => re.test(seg))
      if (hit) { name = hit[1]; break }
    }
    if (name) break
  }
  if (name) viaFolder++
  else {
    name = fromSiteNumber(job.site_number)
    if (name) viaShape++
  }

  if (!name) { unresolved.push(job); continue }
  plan.push({ job, name })
}

const need = [...new Set(plan.map(p => p.name))].filter(n => !customers.has(n.toLowerCase()))
const counts = {}
plan.forEach(p => { counts[p.name] = (counts[p.name] || 0) + 1 })

console.log(`jobs missing a customer : ${jobs.filter(j => !j.customer_id).length}`)
console.log(`  resolved by folder    : ${viaFolder}`)
console.log(`  resolved by site shape: ${viaShape}`)
console.log(`  still unresolved      : ${unresolved.length}`)
if (need.length) console.log(`customers to create     : ${need.join(', ')}`)
console.log('\nwould assign:')
Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([n, c]) => console.log(`   ${String(c).padStart(5)}  ${n}`))
if (unresolved.length) {
  console.log('\nunresolved examples:')
  unresolved.slice(0, 10).forEach(j => console.log(`   ${j.site_number}`))
}

if (!COMMIT) {
  console.log('\nDRY RUN — nothing written. Re-run with --commit')
  process.exit(0)
}

mkdirSync('scripts/ingest/backups', { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(`scripts/ingest/backups/job-customers-before-${stamp}.json`,
  JSON.stringify(plan.map(p => ({ id: p.job.id, site_number: p.job.site_number, was: null, now: p.name })), null, 1))

for (const name of need) {
  const r = await fetch(`${url}/rest/v1/con_customers`, {
    method: 'POST', headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ company_id: jobs[0].company_id, name }),
  })
  const [made] = await r.json()
  customers.set(name.toLowerCase(), made)
  console.log(`  created customer: ${name}`)
}

// group by customer so this is a handful of requests, not thousands
const byCustomer = new Map()
for (const p of plan) {
  const id = customers.get(p.name.toLowerCase()).id
  if (!byCustomer.has(id)) byCustomer.set(id, [])
  byCustomer.get(id).push(p.job.id)
}

let done = 0
for (const [cid, ids] of byCustomer) {
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const r = await fetch(`${url}/rest/v1/con_jobs?id=in.(${chunk.join(',')})`, {
      method: 'PATCH', headers: H, body: JSON.stringify({ customer_id: cid }),
    })
    if (r.ok) done += chunk.length
  }
}
console.log(`\nassigned a customer to ${done} jobs`)
