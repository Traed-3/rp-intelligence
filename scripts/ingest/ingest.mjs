// ============================================================
// rps-doc-ingest — scan approved source folders (Dropbox), match files to
// construction jobs by store number, classify, and copy them into the app
// (Supabase Storage + con_documents). READ/COPY ONLY at the source — never
// modifies, moves, or deletes anything in Dropbox.
//
// Safe by default: DRY RUN unless --commit is passed. Idempotent: skips files
// already imported to the same job (by content hash).
//
//   node --env-file=.env.local scripts/ingest/ingest.mjs [options]
//     --root <path>     source folder to scan (default: Dropbox Completed Projects)
//     --site <number>   only import files whose store number matches this
//     --limit <n>       stop after N files (for testing)
//     --commit          actually upload + insert (otherwise dry run)
// ============================================================
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'fs'
import { join, sep } from 'path'
import { classifyDocument, storeCandidates, resolveStore, isIgnored, mimeFor, cpgSite, pathYear } from './classify.mjs'

const BUCKET = 'construction-docs'
const DEFAULT_ROOT = '/Volumes/External Storage/RP Dropbox/Construction projects (Team)/Construction Department Documents/Completed Projects'

// ── args ────────────────────────────────────────────────────
const args = process.argv.slice(2)
const getOpt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const ROOT = getOpt('--root') || DEFAULT_ROOT
const ONLY_SITE = getOpt('--site') || null
const LIMIT = getOpt('--limit') ? parseInt(getOpt('--limit'), 10) : Infinity
const MAX_UPLOADS = getOpt('--max-uploads') ? parseInt(getOpt('--max-uploads'), 10) : Infinity
const COMMIT = args.includes('--commit')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing Supabase env. Run with --env-file=.env.local'); process.exit(1) }
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const sleep = ms => new Promise(r => setTimeout(r, ms))

// One failed upload poisons Node's default HTTP connection pool (undici) and
// every later request then fails instantly ("fetch failed"). Fix: swap in a
// fresh dispatcher on each failure. undici is loaded if present; harmless if not.
let resetPool = () => {}
try {
  const { Agent, setGlobalDispatcher } = await import('undici')
  // headersTimeout/bodyTimeout bound how long a single request may stall before
  // undici aborts it — without them a dead socket can hang the request forever.
  const mk = () => new Agent({
    connections: 4, keepAliveTimeout: 15000, keepAliveMaxTimeout: 120000,
    connect: { timeout: 20000 }, headersTimeout: 30000, bodyTimeout: 900000,
  })
  setGlobalDispatcher(mk())
  resetPool = () => setGlobalDispatcher(mk())
  console.log('undici keep-alive dispatcher active (pool auto-resets on failure)')
} catch {
  // Without undici one failed upload poisons the pool and every later request
  // dies instantly with "fetch failed". Both helpers are installed --no-save,
  // so installing either one alone silently prunes the other — always name both.
  console.warn('\n*** undici MISSING — uploads will cascade into "fetch failed". Stop and run:')
  console.warn('***   npm i undici tus-js-client --no-save\n')
}

// Hard wall-clock timeout for a single call. The live setTimeout handle keeps
// Node's event loop alive, so even a promise orphaned by pool corruption can't
// drain the loop and crash the process with exit 13 ("unsettled top-level
// await") — it just loses the race and gets retried on a fresh pool.
const withTimeout = (p, ms, label) => {
  let t
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms) })
  return Promise.race([Promise.resolve().then(p), timer]).finally(() => clearTimeout(t))
}

// Retry a Supabase call, resetting the connection pool between attempts so a
// poisoned pool can't cascade. Retries thrown network errors AND returned errors.
async function retry(fn, tries = 6, timeoutMs = 75000) {
  let delay = 400
  for (let i = 0; i < tries; i++) {
    try {
      const r = await withTimeout(fn, timeoutMs, 'supabase call')
      if (!r || !r.error) return r
      if (i === tries - 1) return r
    } catch (e) {
      if (i === tries - 1) return { error: { message: e?.message || String(e) } }
    }
    resetPool()
    await sleep(delay); delay = Math.min(delay * 2, 8000)
  }
}

// Past a few hundred MB a single TLS stream stops being reliable — the upload
// dies with "bad record mac" every time, no matter the timeout. Chunked
// resumable (TUS) uploads keep each request small, so nothing runs long enough
// to corrupt, and a failed chunk retries instead of restarting the file.
const RESUMABLE_OVER = 100 * 1024 * 1024

async function uploadResumable(storagePath, buf, contentType, label) {
  let tus
  try { tus = await import('tus-js-client') }
  catch { return { message: 'tus-js-client not installed (npm i tus-js-client --no-save)' } }

  const mb = (buf.length / 1e6).toFixed(0)
  console.log(`  → resumable upload ${label} (${mb} MB)`)

  return await new Promise((resolve) => {
    const upload = new tus.Upload(buf, {
      endpoint: `${url}/storage/v1/upload/resumable`,
      retryDelays: [0, 2000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${key}`, 'x-upsert': 'true' },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024, // Supabase requires exactly 6MB chunks
      metadata: {
        bucketName: BUCKET,
        objectName: storagePath,
        contentType,
        cacheControl: '3600',
      },
      onError: (e) => resolve({ message: e?.message || String(e) }),
      onSuccess: () => resolve(null),
    })
    upload.findPreviousUploads()
      .then((prev) => { if (prev.length) upload.resumeFromPreviousUpload(prev[0]); upload.start() })
      .catch(() => upload.start())
  })
}

// ── load all rows across the 1000-row page cap ──────────────
async function fetchAll(table, columns) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select(columns).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < 1000) break
  }
  return rows
}

// ── build site_number -> [jobs] index (normalized to digits) ─
function digits(s) { const m = String(s ?? '').match(/(?<!\d)(\d{3,5})(?!\d)/); return m ? m[1] : null }

console.log(`\n== rps-doc-ingest ${COMMIT ? '(COMMIT)' : '(DRY RUN — no writes)'} ==`)
console.log(`root: ${ROOT}`)
if (ONLY_SITE) console.log(`site filter: ${ONLY_SITE}`)

const jobs = await fetchAll('con_jobs', 'id, company_id, site_number, stage')
const jobsByStore = new Map()
for (const j of jobs) {
  const site = String(j.site_number ?? '').trim()
  // CPG sites are addressed, not numbered — key them whole so "CPG703" never
  // collapses into store 703.
  const key = /^CPG\d+$/i.test(site) ? site.toUpperCase() : digits(site)
  if (!key) continue
  if (!jobsByStore.has(key)) jobsByStore.set(key, [])
  jobsByStore.get(key).push(j)
}
console.log(`loaded ${jobs.length} jobs across ${jobsByStore.size} store numbers`)

// existing docs: (job_id+hash) for dup detection, and source_path for instant resume
const existingDocs = await fetchAll('con_documents', 'job_id, file_hash, source_path')
const seen = new Set(existingDocs.filter(d => d.job_id && d.file_hash).map(d => `${d.job_id}:${d.file_hash}`))
const seenPaths = new Set(existingDocs.filter(d => d.source_path).map(d => d.source_path))
console.log(`already imported: ${seen.size} (job+file), ${seenPaths.size} known paths — skipped without re-reading\n`)

// ── walk the tree (iterative) ───────────────────────────────
function* walk(dir) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (isIgnored(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) yield* walk(full)
    else if (e.isFile()) yield full
  }
}

const rootSegs = ROOT.split(sep)
const stats = { scanned: 0, matched: 0, ambiguous: 0, unmatched: 0, duplicate: 0, uploaded: 0, errors: 0, bytes: 0 }
const byStore = new Map() // store -> {files, matched, ambiguous, unmatched}
const samples = []
const unmatchedStores = new Set()

for (const path of walk(ROOT)) {
  if (stats.scanned >= LIMIT && LIMIT !== Infinity) break
  if (COMMIT && stats.uploaded >= MAX_UPLOADS) break // bounded batch reached
  if (seenPaths.has(path)) { stats.resumed = (stats.resumed || 0) + 1; continue } // already imported — skip without reading
  const segs = path.split(sep)
  const filename = segs[segs.length - 1]
  const dirSegs = segs.slice(rootSegs.length, segs.length - 1) // folders under root
  // Capitol/Capital Petroleum folders are addresses ("703 N. Washington
  // Street"), so they resolve to CPG703 rather than store 703.
  const cpg = cpgSite(dirSegs)
  const store = cpg || resolveStore(storeCandidates(dirSegs, filename), jobsByStore)
  if (ONLY_SITE && store !== ONLY_SITE) continue

  stats.scanned++
  const rec = byStore.get(store) || { files: 0, matched: 0, ambiguous: 0, unmatched: 0 }
  rec.files++

  // A CPG address folder is its own job. These have real paperwork behind
  // them, so create the job on first sight and number it from the folder year.
  if (COMMIT && cpg && !jobsByStore.has(cpg)) {
    const yr = pathYear(dirSegs)
    const { data: made, error: mkErr } = await retry(() => admin.from('con_jobs').insert({
      company_id: jobs[0].company_id,
      site_number: cpg,
      job_number: yr ? `${cpg}-${String(yr % 100).padStart(2, '0')}` : null,
      stage: 'complete',
      notes: 'Created by rps-doc-ingest from the Dropbox project folder.',
    }).select('id, company_id, site_number, stage').single())
    if (mkErr) { stats.errors++; continue }
    jobsByStore.set(cpg, [made])
    stats.jobsCreated = (stats.jobsCreated || 0) + 1
  }

  const matches = store ? (jobsByStore.get(store) || []) : []
  const { category, docType, confident } = classifyDocument(filename, dirSegs.join(' '))

  let decision, job = null, review = 'filed'
  if (matches.length === 0) { decision = 'unmatched'; stats.unmatched++; rec.unmatched++; if (store) unmatchedStores.add(store) }
  else if (matches.length === 1) { decision = 'matched'; job = matches[0]; stats.matched++; rec.matched++; review = confident ? 'filed' : 'needs_review' }
  else { decision = 'ambiguous'; job = matches[0]; stats.ambiguous++; rec.ambiguous++; review = 'needs_review' }
  byStore.set(store, rec)

  if (samples.length < 25) samples.push({ store, filename, category, docType: docType || '—', decision, matchCount: matches.length })

  if (decision === 'unmatched') continue
  if (!COMMIT) continue // dry run: name-only, don't read file contents

  // hash + dedup (only when committing)
  let buf, hash
  try { buf = readFileSync(path); hash = createHash('sha256').update(buf).digest('hex') }
  catch (e) { stats.errors++; continue }
  if (buf.length === 0) { stats.notDownloaded = (stats.notDownloaded || 0) + 1; continue } // online-only, not materialized yet
  stats.bytes += buf.length
  const dedupKey = `${job.id}:${hash}`
  if (seen.has(dedupKey)) { stats.duplicate++; continue }
  seen.add(dedupKey)

  // upload + insert
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
  const storagePath = `${job.company_id}/${job.id}/ingest/${hash.slice(0, 12)}-${safe}`
  // Big closeout PDFs run to a gigabyte; give the call room proportional to
  // the payload instead of the flat 75s that suits a photo.
  const upTimeout = Math.max(75000, Math.round(buf.length / 1e6) * 4000)
  const upErr = buf.length > RESUMABLE_OVER
    ? await uploadResumable(storagePath, buf, mimeFor(filename), filename)
    : (await retry(
        () => admin.storage.from(BUCKET).upload(storagePath, buf, { contentType: mimeFor(filename), upsert: true }),
        6, upTimeout,
      )).error
  if (upErr) { stats.errors++; console.warn(`  upload fail ${filename}: ${upErr.message}`); continue }
  const { error: insErr } = await retry(() => admin.from('con_documents').insert({
    company_id: job.company_id, job_id: job.id,
    file_name: filename, original_filename: filename, storage_path: storagePath, source_path: path,
    category, doc_type: docType, file_hash: hash,
    imported_at: new Date().toISOString(), imported_by: 'rps-doc-ingest', review_status: review,
  }))
  if (insErr) { stats.errors++; await retry(() => admin.storage.from(BUCKET).remove([storagePath])); console.warn(`  insert fail ${filename}: ${insErr.message}`); continue }
  stats.uploaded++
  await sleep(20) // gentle pace so Storage doesn't throttle a long burst
}

// ── report ──────────────────────────────────────────────────
const mb = (stats.bytes / 1048576).toFixed(1)
console.log('── Summary ──────────────────────────────')
console.log(`files scanned:      ${stats.scanned}`)
console.log(`  matched (1 job):  ${stats.matched}`)
console.log(`  ambiguous (>1):   ${stats.ambiguous}  -> filed as needs_review`)
console.log(`  unmatched (0):    ${stats.unmatched}  (${unmatchedStores.size} distinct stores with no job)`)
console.log(`  duplicates skipped: ${stats.duplicate}`)
console.log(`data read:          ${mb} MB`)
if (COMMIT) console.log(`UPLOADED + FILED:   ${stats.uploaded}   (errors: ${stats.errors})`)
else console.log(`would upload:       ${stats.matched + stats.ambiguous - stats.duplicate}   (dry run — nothing written)`)

console.log('\n── Sample decisions ─────────────────────')
for (const s of samples) console.log(`  [${s.decision}${s.matchCount>1?` x${s.matchCount}`:''}] ${s.store ?? '?'} · ${s.category}/${s.docType} · ${s.filename.slice(0,50)}`)

// write markdown report
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const reportDir = join('scripts', 'ingest', 'reports')
mkdirSync(reportDir, { recursive: true })
const topUnmatched = [...unmatchedStores].slice(0, 40).join(', ')
const md = `# rps-doc-ingest report ${runId}\n\nMode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}\nRoot: ${ROOT}\n${ONLY_SITE ? `Site filter: ${ONLY_SITE}\n` : ''}\n- files scanned: ${stats.scanned}\n- matched (1 job): ${stats.matched}\n- ambiguous (>1 job): ${stats.ambiguous}\n- unmatched (0 jobs): ${stats.unmatched} across ${unmatchedStores.size} stores\n- duplicates skipped: ${stats.duplicate}\n- uploaded: ${COMMIT ? stats.uploaded : '(dry run)'}\n- data: ${mb} MB\n\nUnmatched stores (first 40): ${topUnmatched}\n`
writeFileSync(join(reportDir, `report-${runId}.md`), md)
console.log(`\nreport: ${join(reportDir, `report-${runId}.md`)}`)
