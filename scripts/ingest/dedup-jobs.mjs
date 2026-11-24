// One-off cleanup: remove EMPTY duplicate con_jobs (junk from the master-schedule
// import). Deletes only rows with no data and no child records, always keeping at
// least one job per store. Backs up every deleted row to a local JSON file first.
// DRY RUN unless --commit.
//   node --env-file=.env.local scripts/ingest/dedup-jobs.mjs [--commit]
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const COMMIT = process.argv.includes('--commit')

async function fetchAll(table, columns) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select(columns).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data); if (data.length < 1000) break
  }
  return rows
}

// which job ids have any child record?
const childSet = new Set()
for (const t of ['con_quotes', 'con_invoices', 'con_job_materials', 'con_job_labor', 'con_schedule_entries', 'con_closeout_tasks', 'con_documents']) {
  for (const r of await fetchAll(t, 'job_id')) if (r.job_id) childSet.add(r.job_id)
}

const jobs = await fetchAll('con_jobs', 'id, site_number, scope_of_work, work_order_number, date_received, project_start_date, stage, assigned_manager_id, notes')
const hasData = j =>
  (j.scope_of_work && j.scope_of_work.trim()) ||
  (j.work_order_number && j.work_order_number.trim()) ||
  j.date_received || j.project_start_date ||
  (j.stage && j.stage !== 'complete') ||
  j.assigned_manager_id ||
  (j.notes && j.notes.trim()) ||
  childSet.has(j.id)

// group by store
const byStore = new Map()
for (const j of jobs) {
  const s = j.site_number ?? ''
  if (!byStore.has(s)) byStore.set(s, [])
  byStore.get(s).push({ ...j, _data: !!hasData(j) })
}

const toDelete = []
for (const [, list] of byStore) {
  const dataRows = list.filter(j => j._data).length
  const empties = list.filter(j => !j._data).sort((a, b) => (a.id < b.id ? -1 : 1))
  if (dataRows > 0) toDelete.push(...empties)            // store has real data → drop all its empties
  else toDelete.push(...empties.slice(1))                // all-empty store → keep the first empty
}

console.log(`jobs: ${jobs.length}  |  with data: ${jobs.filter(hasData).length}  |  to delete (empty dupes): ${toDelete.length}`)
console.log(`jobs after cleanup: ${jobs.length - toDelete.length}`)

if (!COMMIT) { console.log('\nDRY RUN — nothing deleted. Re-run with --commit.'); process.exit(0) }

// backup full rows before deleting
const ids = toDelete.map(j => j.id)
const backupRows = jobs.filter(j => ids.includes(j.id))
const dir = join('scripts', 'ingest', 'backups'); mkdirSync(dir, { recursive: true })
const ts = new Date().toISOString().replace(/[:.]/g, '-')
const backupFile = join(dir, `deleted-jobs-${ts}.json`)
writeFileSync(backupFile, JSON.stringify(backupRows, null, 2))
console.log(`backed up ${backupRows.length} rows -> ${backupFile}`)

// delete in batches
let deleted = 0
for (let i = 0; i < ids.length; i += 100) {
  const batch = ids.slice(i, i + 100)
  const { error } = await admin.from('con_jobs').delete().in('id', batch)
  if (error) { console.error('delete error:', error.message); break }
  deleted += batch.length
}
const { count } = await admin.from('con_jobs').select('id', { count: 'exact', head: true })
console.log(`deleted: ${deleted}  |  con_jobs now: ${count}`)
