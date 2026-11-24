#!/usr/bin/env node
/**
 * Re-sync the Smartsheet "DQF & Cert Tracker" ROWS into the DQF module (catches what Peggy changed after the
 * 10/23 import: new medical cards, renewed certs, new requirement rows).
 *
 *   node --env-file=.env.local scripts/sync-smartsheet-dqf-rows.mjs <export dir>            # dry run
 *   node --env-file=.env.local scripts/sync-smartsheet-dqf-rows.mjs <export dir> --apply
 *
 * Reads <export dir>/rows.json (rows with row_id, row_number, Employee (= primary column), Completed, Expiration Date,
 * inferred_level section|employee|group|requirement, inferred_parent_id). Password/code columns are never in it.
 * Per (employee, requirement) the row with the latest expiration wins (ties → the lower row on the sheet).
 *   - no record yet          → create it
 *   - newer row than ours    → old dates + scan move to history, record points at the new row/date
 *   - same row, new date     → date updated
 * Writes <export dir>/row_map.json { smartsheetRowId: itemId } for every resolved requirement row (incl. older
 * duplicates) and employee rows ({ "emp:<rowId>": employeeId }) — the file sync uses it.
 * Never deletes anything.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const dir = process.argv.slice(2).find(a => !a.startsWith('--'))
if (!dir) { console.error('Usage: sync-smartsheet-dqf-rows.mjs <export dir> [--apply]'); process.exit(1) }
const COMPANY_ID = process.env.RPS_COMPANY_ID ?? 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { rows } = JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8'))
const byId = new Map(rows.map(r => [String(r.row_id), r]))
// A row with a scan attached counts as "on file" even if nobody ticked Completed.
// <export dir>/overrides.json (optional): { rows_ignore: [rowId…] } for rows that only carry someone else's misfiled scan.
const overrides = existsSync(join(dir, 'overrides.json')) ? JSON.parse(readFileSync(join(dir, 'overrides.json'), 'utf8')) : {}
const ignoreRows = new Set((overrides.rows_ignore ?? []).map(String))
const withFiles = new Set(existsSync(join(dir, 'manifest.json')) ? JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).map(m => String(m.parent_id)).filter(r => !ignoreRows.has(r)) : [])

// Same spelling map as the original import (sheet name → roster name).
const ALIAS = {
  'Lewis, Ernie': 'Ernie Lewis', 'Dondero, Tristin': 'Tristin Dondero', 'Matt Breen': 'Matthew Breen',
  'Drew Lewis': 'Andrew "Drew" Rapp', 'Trenton Bower': 'Trenton Burks-Bower', 'Yatsko, Richard': 'Richard Yatsko',
  'Kerner, Ariel': 'Ariel Kerner', 'Renner, Austin': 'Austin Renner', 'Robbie McLoughin': 'Robert McLoughlin',
}
const SKIP_EMPLOYEES = new Set(['OPEN', 'TEMPLATE - DO NOT USE'])
// Sheet requirement spellings → requirement type names. Rows mapped to null are task rows, not documents.
const TYPE_ALIAS = {
  'request for check of driving record': 'Request for Check of Driving Record (pre-hire MVR)',
  'safety performance history': 'Safety Performance History (prior employers)',
  'icon certificaiton': 'ICON Certification',
  'pa': 'PA Tank Handler Certification',
  'wvdep class a tank certification': 'WVDEP Class A Tank Tech Installer Certification',
  'wvdep class b tank certification': 'WVDEP Class B Tank Tech Installer Certification',
  'dc tank tech certification': 'DC Tank Tech Installer/Removal Certification',
  'omegflex': 'OmegaFlex Certification',
  'mde': 'MDE Tank Tech Installer Certification',
  'ffs pro certifications': 'FFS Pro Certification',
  'confined space resue online training': 'Confined Space Rescue',
  'assemble personnel file': null,
}
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

const [{ data: employees }, { data: types }, { data: items }] = await Promise.all([
  admin.from('hr_employees').select('id, full_name, smartsheet_row_id').eq('company_id', COMPANY_ID),
  admin.from('hr_requirement_types').select('id, name, expires').eq('company_id', COMPANY_ID),
  admin.from('hr_employee_items').select('*').eq('company_id', COMPANY_ID),
])
const norm = s => s.toLowerCase().replace(/&/g, 'and').replace(/certification|certificate|cert\b|training|online/g, '').replace(/[^a-z0-9]/g, '')
const typeByNorm = new Map(types.map(t => [norm(t.name), t]))
const empByRow = new Map(employees.filter(e => e.smartsheet_row_id).map(e => [String(e.smartsheet_row_id), e]))
const empByName = new Map(employees.map(e => [e.full_name.toLowerCase(), e]))
const itemKey = (e, t) => `${e}|${t}`
const itemBy = new Map(items.map(i => [itemKey(i.employee_id, i.type_id), i]))

function employeeAncestor(r) {
  let p = r
  for (let i = 0; i < 6 && p; i++) {
    if (p.inferred_level === 'employee') return p
    p = byId.get(String(p.inferred_parent_id))
  }
  return null
}

const rowMap = {}
const unresolved = []
const groups = new Map()   // (employee,type) → rows
for (const r of rows) {
  if (r.inferred_level === 'employee') {
    const e = empByRow.get(String(r.row_id)) ?? empByName.get((ALIAS[r.Employee] ?? r.Employee ?? '').toLowerCase())
    if (e) rowMap[`emp:${r.row_id}`] = e.id
    continue
  }
  if (r.inferred_level !== 'requirement' || !r.Employee) continue
  const er = employeeAncestor(r)
  if (!er || SKIP_EMPLOYEES.has(er.Employee)) continue
  const e = empByRow.get(String(er.row_id)) ?? empByName.get((ALIAS[er.Employee] ?? er.Employee).toLowerCase())
  const aliasKey = r.Employee.trim().toLowerCase()
  if (aliasKey in TYPE_ALIAS && TYPE_ALIAS[aliasKey] === null) continue
  const t = typeByNorm.get(norm(TYPE_ALIAS[aliasKey] ?? r.Employee))
  if (!e || !t) { unresolved.push({ row: r.row_number, employee: er.Employee, requirement: r.Employee, why: !e ? 'employee' : 'requirement type' }); continue }
  const k = itemKey(e.id, t.id)
  if (!groups.has(k)) groups.set(k, { e, t, rows: [] })
  groups.get(k).rows.push(r)
}

const done = r => String(r.Completed).toLowerCase() === 'true' || withFiles.has(String(r.row_id))
let created = 0, renewed = 0, redated = 0, same = 0
for (const [k, { e, t, rows: rs }] of groups) {
  const expOf = r => isDate(r['Expiration Date']) ? r['Expiration Date'] : ''
  rs.sort((a, b) => expOf(a).localeCompare(expOf(b)) || a.row_number - b.row_number)
  const top = rs.at(-1)
  const exp = t.expires ? expOf(top) || null : null
  const status = rs.some(done) || exp ? 'on_file' : 'missing'
  const item = itemBy.get(k)
  let itemId = item?.id
  if (!item) {
    if (status === 'missing') continue   // a blank, unchecked row is the same as "not on file" — the module shows it as missing already
    console.log(`+ ${e.full_name} — ${t.name}${exp ? ` (exp ${exp})` : ''}`)
    created++
    if (APPLY) {
      const { data, error } = await admin.from('hr_employee_items').insert({ company_id: COMPANY_ID, employee_id: e.id, type_id: t.id, status, expiration_date: exp, smartsheet_row_id: top.row_id }).select('id').single()
      if (error) throw error
      itemId = data.id
    }
  } else if (String(item.smartsheet_row_id) !== String(top.row_id) && exp && (!item.expiration_date || exp > item.expiration_date)) {
    console.log(`↻ ${e.full_name} — ${t.name}: ${item.expiration_date ?? '—'} → ${exp} (newer Smartsheet row)`)
    renewed++
    if (APPLY) {
      await admin.from('hr_item_history').insert({ company_id: COMPANY_ID, item_id: item.id, issued_date: item.issued_date, expiration_date: item.expiration_date, cert_number: item.cert_number, document_path: item.document_path, document_name: item.document_name })
      const { error } = await admin.from('hr_employee_items').update({ expiration_date: exp, issued_date: null, cert_number: null, document_path: null, document_name: null, status: 'on_file', smartsheet_row_id: top.row_id }).eq('id', item.id)
      if (error) throw error
    }
  } else if (String(item.smartsheet_row_id) === String(top.row_id) && t.expires && exp && exp !== item.expiration_date) {
    console.log(`✎ ${e.full_name} — ${t.name}: ${item.expiration_date ?? '—'} → ${exp}`)
    redated++
    if (APPLY) await admin.from('hr_employee_items').update({ expiration_date: exp }).eq('id', item.id)
  } else same++
  if (itemId) for (const r of rs) rowMap[String(r.row_id)] = itemId
}

writeFileSync(join(dir, 'row_map.json'), JSON.stringify(rowMap, null, 1))
console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${created} new records, ${renewed} renewed from a newer row, ${redated} dates changed, ${same} unchanged, ${unresolved.length} rows not resolved.`)
for (const u of unresolved) console.log(`  ? row ${u.row}: ${u.employee} / ${u.requirement} (no ${u.why})`)
