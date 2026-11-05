#!/usr/bin/env node
/**
 * Bring the Smartsheet "DQF & Cert Tracker" row attachments (the actual scans) into the DQF module.
 *
 *   node --env-file=.env.local scripts/sync-smartsheet-dqf-files.mjs <export dir>            # dry run
 *   node --env-file=.env.local scripts/sync-smartsheet-dqf-files.mjs <export dir> --apply    # upload + link
 *
 * <export dir> (kept OUTSIDE git — personal data) holds manifest.json + files/ from the Smartsheet export:
 *   manifest.json = [{ attachment_id, parent_id, parent_type, name, mime, created_at, local_path, ok }]
 *
 * Matching: an attachment's parent row id = hr_employee_items.smartsheet_row_id.
 * Per item, attachments are grouped by the day they were added (Eastern). Same-day files (license front + back)
 * are merged into ONE PDF. The newest day becomes the item's current document; earlier days go to
 * hr_item_history as earlier copies. If someone already uploaded a newer scan in the app, it is left as current.
 * Idempotent: synced attachment ids are recorded in <export dir>/synced.json and skipped next run.
 * Needs: pdfunite (poppler) and img2pdf for merging; sips (macOS) converts HEIC.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { join, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const dir = process.argv.slice(2).find(a => !a.startsWith('--'))
if (!dir) { console.error('Usage: sync-smartsheet-dqf-files.mjs <export dir> [--apply]'); process.exit(1) }
const COMPANY_ID = process.env.RPS_COMPANY_ID ?? 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'
const BUCKET = 'hr-compliance'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).filter(m => m.ok !== false && m.local_path)
const syncedPath = join(dir, 'synced.json')
const synced = existsSync(syncedPath) ? JSON.parse(readFileSync(syncedPath, 'utf8')) : {}

const { data: items, error } = await admin.from('hr_employee_items')
  .select('id, employee_id, type_id, status, issued_date, expiration_date, cert_number, document_path, document_name, smartsheet_row_id, updated_at, hr_employees(full_name), hr_requirement_types(name)')
  .eq('company_id', COMPANY_ID).not('smartsheet_row_id', 'is', null)
if (error) throw error
const itemByRow = new Map(items.map(i => [String(i.smartsheet_row_id), i]))

const etDay = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso))
const safe = s => s.replace(/[^\w.\-]+/g, '_').slice(-80) || 'document'
const tmp = mkdtempSync(join(tmpdir(), 'dqf-merge-'))

/** One file per group: PDFs/images merged into a single PDF when there is more than one. */
function mergeGroup(files) {
  if (files.length === 1) return { path: files[0].abs, name: files[0].name, mime: files[0].mime || 'application/octet-stream' }
  const pdfs = files.map((f, i) => {
    const ext = extname(f.abs).toLowerCase()
    if (ext === '.pdf' || f.mime === 'application/pdf') return f.abs
    let img = f.abs
    if (ext === '.heic' || f.mime === 'image/heic') { img = join(tmp, `${f.attachment_id}.jpg`); execFileSync('sips', ['-s', 'format', 'jpeg', f.abs, '--out', img], { stdio: 'ignore' }) }
    const out = join(tmp, `${f.attachment_id}-${i}.pdf`)
    execFileSync('img2pdf', ['--output', out, img])
    return out
  })
  const out = join(tmp, `merged-${files.map(f => f.attachment_id).join('-').slice(0, 60)}.pdf`)
  execFileSync('pdfunite', [...pdfs, out])
  return { path: out, name: `${files.map(f => f.name.replace(/\.[^.]+$/, '')).join(' + ').slice(0, 150)}.pdf`, mime: 'application/pdf' }
}

async function upload(item, doc, stamp) {
  const path = `${COMPANY_ID}/${item.employee_id}/${item.type_id}/${stamp}-${safe(doc.name)}`
  const { error } = await admin.storage.from(BUCKET).upload(path, readFileSync(doc.path), { contentType: doc.mime, upsert: true })
  if (error) throw new Error(`upload ${path}: ${error.message}`)
  return path
}

const byRow = new Map()
for (const m of manifest) {
  if (synced[m.attachment_id]) continue
  if (!byRow.has(String(m.parent_id))) byRow.set(String(m.parent_id), [])
  byRow.get(String(m.parent_id)).push({ ...m, abs: m.local_path.startsWith('/') ? m.local_path : join(dir, m.local_path) })
}

let linked = 0, history = 0, unmatched = []
for (const [rowId, files] of byRow) {
  const item = itemByRow.get(rowId)
  if (!item) { unmatched.push(...files.map(f => ({ row: rowId, type: f.parent_type, name: f.name }))); continue }
  const groups = [...files.reduce((g, f) => g.set(etDay(f.created_at), [...(g.get(etDay(f.created_at)) ?? []), f]), new Map()).entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
  const who = `${item.hr_employees?.full_name} — ${item.hr_requirement_types?.name}`
  // An existing scan uploaded in the app after the newest Smartsheet file stays current.
  const appIsNewer = item.document_path && !item.document_path.includes('/smartsheet-') && item.updated_at.slice(0, 10) >= groups.at(-1)[0]
  console.log(`${who}: ${files.length} file(s) in ${groups.length} day group(s)${appIsNewer ? ' (app scan stays current)' : ''}`)
  if (!APPLY) { linked += appIsNewer ? 0 : 1; history += groups.length - (appIsNewer ? 0 : 1); continue }

  for (let gi = 0; gi < groups.length; gi++) {
    const [day, gFiles] = groups[gi]
    const doc = mergeGroup(gFiles)
    const path = await upload(item, doc, `smartsheet-${day}`)
    const isCurrent = gi === groups.length - 1 && !appIsNewer
    if (isCurrent) {
      if (item.document_path) {
        await admin.from('hr_item_history').insert({ company_id: COMPANY_ID, item_id: item.id, issued_date: item.issued_date, expiration_date: item.expiration_date, cert_number: item.cert_number, document_path: item.document_path, document_name: item.document_name, replaced_at: new Date().toISOString() })
      }
      const { error } = await admin.from('hr_employee_items').update({ document_path: path, document_name: doc.name.slice(0, 200), status: item.status === 'missing' ? 'on_file' : item.status }).eq('id', item.id)
      if (error) throw error
      linked++
    } else {
      // Earlier copy: record it with the day it was added to Smartsheet as the "replaced" date.
      const { error } = await admin.from('hr_item_history').insert({ company_id: COMPANY_ID, item_id: item.id, document_path: path, document_name: doc.name.slice(0, 200), replaced_at: `${groups[gi + 1]?.[0] ?? day}T12:00:00Z` })
      if (error) throw error
      history++
    }
    for (const f of gFiles) synced[f.attachment_id] = path
    writeFileSync(syncedPath, JSON.stringify(synced, null, 1))
  }
}

console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${linked} items get a current document, ${history} earlier copies to history, ${unmatched.length} files not matched to an item.`)
if (unmatched.length) {
  writeFileSync(join(dir, 'unmatched.json'), JSON.stringify(unmatched, null, 1))
  console.log(`Unmatched list → ${join(dir, 'unmatched.json')}`)
}
