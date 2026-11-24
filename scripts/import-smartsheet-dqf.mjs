#!/usr/bin/env node
/**
 * One-time import of the Smartsheet "DQF & Cert Tracker" into the DQF & Certifications module.
 *
 *   node --env-file=.env.local scripts/import-smartsheet-dqf.mjs <seed.json>            # dry run (prints the plan)
 *   node --env-file=.env.local scripts/import-smartsheet-dqf.mjs <seed.json> --apply    # write it
 *
 * Source: a JSON extract kept OUTSIDE the repo (employee names, hire dates and medical-card dates are personal data;
 * Work Mac copy: ~/Library/Application Support/RPS Compliance/smartsheet_dqf_2026-10-23.json) — extracted from the sheet (sheet id 6846054072117124)
 * through the Smartsheet connector. Only names, departments, hire dates, completed checkboxes and expiration
 * dates came across; the sheet's "Apple ID Password", "Email Password" and "Codes" columns were NOT copied.
 *
 * Roster = everyone on the sheet (matched to their con_contacts card for email/phone) + every other active
 * employee card in con_contacts (service techs, office, mechanics) so certifications can be tracked for them too.
 * Sheet people with no current contact card (left the company) are imported as former employees.
 * Idempotent: employees keyed by smartsheet_row_id or name; items by (employee, requirement).
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const COMPANY_ID = process.env.RPS_COMPANY_ID ?? 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const seedPath = process.argv.slice(2).find(a => !a.startsWith('--'))
if (!seedPath) { console.error('Usage: import-smartsheet-dqf.mjs <seed.json> [--apply]'); process.exit(1) }
const seed = JSON.parse(readFileSync(seedPath, 'utf8'))

// Sheet spelling → con_contacts name (where they differ).
const ALIAS = {
  'Lewis, Ernie': 'Ernie Lewis', 'Dondero, Tristin': 'Tristin Dondero', 'Matt Breen': 'Matthew Breen',
  'Drew Lewis': 'Andrew "Drew" Rapp', 'Trenton Bower': 'Trenton Burks-Bower', 'Yatsko, Richard': 'Richard Yatsko',
  'Kerner, Ariel': 'Ariel Kerner', 'Renner, Austin': 'Austin Renner', 'Robbie McLoughin': 'Robert McLoughlin',
}
// Contact cards that are mailboxes or people this module should not email.
const SKIP_CONTACTS = new Set(['Fuel', 'Receipts', 'Fred Dodson'])
const OWNERS = new Set(['Starsky Dodson', 'Shannon Dodson'])

function departmentFor(title, section) {
  const t = (title ?? '').toLowerCase()
  if (section?.startsWith('Mechanics') || /mechanic|shop|parts/.test(t)) return 'mechanics'
  if (/service/.test(t)) return 'service'
  if (/construction|foreman|helper|laborer|driver/.test(t) || section?.startsWith('Construction')) return 'construction'
  if (/owner|manager|supervisor/.test(t)) return 'management'
  return 'office'
}

const { data: contacts } = await admin.from('con_contacts').select('id, name, title, email, phone, mobile, is_active').eq('company_id', COMPANY_ID).eq('kind', 'employee')
const { data: profiles } = await admin.from('profiles').select('id, email').eq('company_id', COMPANY_ID)
const { data: types } = await admin.from('hr_requirement_types').select('id, name').eq('company_id', COMPANY_ID)
const { data: existing } = await admin.from('hr_employees').select('id, full_name, smartsheet_row_id').eq('company_id', COMPANY_ID)
const typeId = new Map(types.map(t => [t.name, t.id]))
const contactByName = new Map(contacts.map(c => [c.name.toLowerCase(), c]))
const profileByEmail = new Map(profiles.filter(p => p.email).map(p => [p.email.toLowerCase(), p.id]))

const plan = []
const usedContacts = new Set()
for (const e of seed) {
  const c = contactByName.get((ALIAS[e.sheet_name] ?? e.sheet_name).toLowerCase())
  if (c) usedContacts.add(c.id)
  const name = c?.name ?? e.sheet_name
  plan.push({
    smartsheet_row_id: e.row_id,
    full_name: name,
    email: c?.email?.toLowerCase() ?? null,
    phone: c?.mobile ?? c?.phone ?? null,
    department: departmentFor(c?.title ?? e.job_title, e.section),
    job_title: c?.title ?? e.job_title,
    hire_date: e.hire_date,
    is_dot_driver: e.section === 'Construction DOT Drivers' || (e.section?.startsWith('Mechanics') && e.items.some(i => i.type === "Medical Examiner's Certificate - DOT Card")),
    is_active: !!c && c.is_active,
    termination_date: c ? null : '2026-10-23',
    contact_id: c?.id ?? null,
    profile_id: c?.email ? profileByEmail.get(c.email.toLowerCase()) ?? null : null,
    notes: c ? null : 'Imported from Smartsheet DQF tracker; no current employee contact card — marked former employee. Reactivate if still employed.',
    items: e.items,
  })
}
for (const c of contacts) {
  if (usedContacts.has(c.id) || SKIP_CONTACTS.has(c.name) || !c.is_active) continue
  plan.push({
    smartsheet_row_id: null, full_name: c.name, email: c.email?.toLowerCase() ?? null, phone: c.mobile ?? c.phone ?? null,
    department: OWNERS.has(c.name) ? 'management' : departmentFor(c.title, null), job_title: c.title, hire_date: null,
    is_dot_driver: false, is_active: true, termination_date: null, contact_id: c.id,
    profile_id: c.email ? profileByEmail.get(c.email.toLowerCase()) ?? null : null, notes: null, items: [],
  })
}

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${plan.length} employees, ${plan.reduce((n, p) => n + p.items.length, 0)} records`)
for (const p of plan) {
  console.log(`${p.is_active ? ' ' : 'x'} ${p.full_name.padEnd(28)} ${p.department.padEnd(12)} ${p.is_dot_driver ? 'DOT' : '   '} ${(p.email ?? '(no email)').padEnd(34)} ${p.items.length} records`)
  for (const i of p.items) if (!typeId.has(i.type)) console.log(`    !! unknown requirement type: ${i.type}`)
}
if (!APPLY) process.exit(0)

let empN = 0, itemN = 0
for (const p of plan) {
  const { items, ...fields } = p
  const match = existing.find(x => (p.smartsheet_row_id && String(x.smartsheet_row_id) === String(p.smartsheet_row_id)) || x.full_name.toLowerCase() === p.full_name.toLowerCase())
  let empId = match?.id
  if (empId) {
    await admin.from('hr_employees').update(fields).eq('id', empId)
  } else {
    const { data, error } = await admin.from('hr_employees').insert({ ...fields, company_id: COMPANY_ID }).select('id').single()
    if (error) { console.error(p.full_name, error.message); continue }
    empId = data.id; empN++
  }
  const rows = items.filter(i => typeId.has(i.type)).map(i => ({
    company_id: COMPANY_ID, employee_id: empId, type_id: typeId.get(i.type),
    status: 'on_file', expiration_date: i.expiration_date, smartsheet_row_id: i.row_id,
    notes: i.completed ? null : 'Smartsheet: date entered but "Completed" was not ticked',
  }))
  if (rows.length) {
    const { error } = await admin.from('hr_employee_items').upsert(rows, { onConflict: 'employee_id,type_id' })
    if (error) console.error(p.full_name, error.message); else itemN += rows.length
  }
}
console.log(`Done: ${empN} new employees, ${itemN} records written.`)
