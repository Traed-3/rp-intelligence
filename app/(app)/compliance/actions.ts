'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { complianceCaller } from '@/lib/compliance-guard'
import { DEPARTMENTS, HR_BUCKET, parseDaysList, parseEmailList } from '@/lib/compliance'
import { runComplianceCheck, sendTestEmail, type CheckResult } from '@/lib/compliance-notices'

export type ActionState = { ok?: boolean; error?: string; message?: string }

const str = (fd: FormData, k: string) => {
  const v = fd.get(k)
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
const date = (fd: FormData, k: string) => {
  const v = str(fd, k)
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}
const bool = (fd: FormData, k: string) => fd.get(k) === 'on' || fd.get(k) === 'true'

function employeeFields(fd: FormData) {
  const dept = str(fd, 'department') ?? 'construction'
  return {
    full_name: str(fd, 'full_name'),
    email: str(fd, 'email')?.toLowerCase() ?? null,
    personal_email: str(fd, 'personal_email')?.toLowerCase() ?? null,
    phone: str(fd, 'phone'),
    department: DEPARTMENTS.some(d => d.value === dept) ? dept : 'construction',
    job_title: str(fd, 'job_title'),
    hire_date: date(fd, 'hire_date'),
    is_dot_driver: bool(fd, 'is_dot_driver'),
    is_cdl: bool(fd, 'is_cdl'),
    license_number: str(fd, 'license_number'),
    license_state: str(fd, 'license_state')?.toUpperCase() ?? null,
    license_class: str(fd, 'license_class'),
    notify_employee: bool(fd, 'notify_employee'),
    notes: str(fd, 'notes'),
  }
}

export async function createEmployee(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await complianceCaller(true)
  if (!me) return { error: 'You do not have permission to add employees here.' }
  const fields = employeeFields(fd)
  if (!fields.full_name) return { error: 'Name is required.' }
  const admin = createAdminClient()
  const { data, error } = await admin.from('hr_employees').insert({ ...fields, company_id: me.company_id }).select('id').single()
  if (error || !data) return { error: error?.message ?? 'Could not save.' }
  revalidatePath('/compliance')
  redirect(`/compliance/employees/${data.id}`)
}

export async function updateEmployee(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await complianceCaller(true)
  if (!me) return { error: 'You do not have permission to edit employees here.' }
  const fields = employeeFields(fd)
  if (!fields.full_name) return { error: 'Name is required.' }
  const is_active = !bool(fd, 'inactive')
  const admin = createAdminClient()
  const { error } = await admin.from('hr_employees')
    .update({ ...fields, is_active, termination_date: is_active ? null : (date(fd, 'termination_date') ?? new Date().toISOString().slice(0, 10)) })
    .eq('id', id).eq('company_id', me.company_id)
  if (error) return { error: error.message }
  revalidatePath('/compliance')
  revalidatePath(`/compliance/employees/${id}`)
  return { ok: true, message: 'Saved.' }
}

async function ensureItem(admin: ReturnType<typeof createAdminClient>, companyId: string, employeeId: string, typeId: string) {
  const { data: emp } = await admin.from('hr_employees').select('id').eq('id', employeeId).eq('company_id', companyId).single()
  const { data: type } = await admin.from('hr_requirement_types').select('id').eq('id', typeId).eq('company_id', companyId).single()
  if (!emp || !type) return null
  const { data: existing } = await admin.from('hr_employee_items').select('*').eq('employee_id', employeeId).eq('type_id', typeId).maybeSingle()
  if (existing) return existing
  const { data: created } = await admin.from('hr_employee_items')
    .insert({ company_id: companyId, employee_id: employeeId, type_id: typeId, status: 'missing' }).select('*').single()
  return created
}

/** Save one requirement on one employee. A new expiry date or card replaces the old one, which goes to history. */
export async function saveItem(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await complianceCaller(true)
  if (!me) return { error: 'You do not have permission to edit records here.' }
  const employeeId = str(fd, 'employee_id'), typeId = str(fd, 'type_id')
  if (!employeeId || !typeId) return { error: 'Missing employee or requirement.' }
  const admin = createAdminClient()
  const item = await ensureItem(admin, me.company_id, employeeId, typeId)
  if (!item) return { error: 'Not found.' }

  const issued_date = date(fd, 'issued_date')
  const expiration_date = date(fd, 'expiration_date')
  let status = str(fd, 'status') ?? 'on_file'
  if (!['missing', 'in_progress', 'on_file', 'not_required'].includes(status)) status = 'on_file'
  // Entering a date is the same as saying it's on file.
  if (status === 'missing' && (issued_date || expiration_date)) status = 'on_file'

  const renewed = (item.expiration_date && expiration_date && item.expiration_date !== expiration_date)
    || (item.issued_date && issued_date && item.issued_date !== issued_date)
  if (renewed) {
    await admin.from('hr_item_history').insert({
      company_id: me.company_id, item_id: item.id, issued_date: item.issued_date, expiration_date: item.expiration_date,
      cert_number: item.cert_number, document_path: item.document_path, document_name: item.document_name, replaced_by: me.id,
    })
  }
  const { error } = await admin.from('hr_employee_items').update({
    status, issued_date, expiration_date,
    cert_number: str(fd, 'cert_number'),
    notes: str(fd, 'notes'),
    verified_by: status === 'on_file' ? me.id : null,
    verified_at: status === 'on_file' ? new Date().toISOString() : null,
  }).eq('id', item.id)
  if (error) return { error: error.message }
  revalidatePath(`/compliance/employees/${employeeId}`)
  revalidatePath('/compliance')
  return { ok: true, message: renewed ? 'Renewed — the old dates were kept in history.' : 'Saved.' }
}

/** Put an optional requirement (e.g. a manufacturer cert) on someone's file. */
export async function addRequirement(fd: FormData) {
  const me = await complianceCaller(true)
  if (!me) return
  const employeeId = str(fd, 'employee_id'), typeId = str(fd, 'type_id')
  if (!employeeId || !typeId) return
  await ensureItem(createAdminClient(), me.company_id, employeeId, typeId)
  revalidatePath(`/compliance/employees/${employeeId}`)
}

export async function removeItem(fd: FormData) {
  const me = await complianceCaller(true)
  if (!me) return
  const id = str(fd, 'item_id'), employeeId = str(fd, 'employee_id')
  if (!id) return
  const admin = createAdminClient()
  const { data: item } = await admin.from('hr_employee_items').select('document_path').eq('id', id).eq('company_id', me.company_id).single()
  if (item?.document_path) await admin.storage.from(HR_BUCKET).remove([item.document_path])
  await admin.from('hr_employee_items').delete().eq('id', id).eq('company_id', me.company_id)
  if (employeeId) revalidatePath(`/compliance/employees/${employeeId}`)
}

/** Step 1 of an upload: a one-time signed URL so the phone/browser sends the scan straight to storage (no size cap from the app). */
export async function prepareUpload(employeeId: string, typeId: string, filename: string): Promise<{ path?: string; token?: string; itemId?: string; error?: string }> {
  const me = await complianceCaller(true)
  if (!me) return { error: 'No permission.' }
  const admin = createAdminClient()
  const item = await ensureItem(admin, me.company_id, employeeId, typeId)
  if (!item) return { error: 'Not found.' }
  const safe = filename.replace(/[^\w.\-]+/g, '_').slice(-80) || 'document'
  const path = `${me.company_id}/${employeeId}/${typeId}/${Date.now()}-${safe}`
  const { data, error } = await admin.storage.from(HR_BUCKET).createSignedUploadUrl(path)
  if (error || !data) return { error: error?.message ?? 'Could not start upload.' }
  return { path, token: data.token, itemId: item.id }
}

/** Step 2: point the record at the uploaded file (old scan kept in history). */
export async function attachDocument(itemId: string, path: string, name: string): Promise<ActionState> {
  const me = await complianceCaller(true)
  if (!me) return { error: 'No permission.' }
  const admin = createAdminClient()
  const { data: item } = await admin.from('hr_employee_items').select('*').eq('id', itemId).eq('company_id', me.company_id).single()
  if (!item) return { error: 'Not found.' }
  // Only accept the exact folder prepareUpload issued for THIS item (no traversal, no other employee's files).
  const prefix = `${me.company_id}/${item.employee_id}/${item.type_id}/`
  const rest = path.slice(prefix.length)
  if (!path.startsWith(prefix) || !/^\d+-[\w.\-]+$/.test(rest) || rest.includes('..')) return { error: 'Bad path.' }
  if (item.document_path) {
    await admin.from('hr_item_history').insert({
      company_id: me.company_id, item_id: item.id, issued_date: item.issued_date, expiration_date: item.expiration_date,
      cert_number: item.cert_number, document_path: item.document_path, document_name: item.document_name, replaced_by: me.id,
    })
  }
  await admin.from('hr_employee_items').update({
    document_path: path, document_name: name.slice(0, 200), status: item.status === 'missing' ? 'on_file' : item.status,
  }).eq('id', item.id)
  revalidatePath(`/compliance/employees/${item.employee_id}`)
  return { ok: true, message: 'Uploaded.' }
}

export async function saveSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await complianceCaller(true)
  if (!me) return { error: 'No permission.' }
  const dqf = parseDaysList(String(fd.get('dqf_notice_days') ?? ''))
  const cert = parseDaysList(String(fd.get('cert_notice_days') ?? ''))
  if (!dqf.length || !cert.length) return { error: 'Enter at least one notice day for each side (e.g. 60, 30, 14, 7).' }
  const repeat = Math.max(1, Math.min(60, parseInt(String(fd.get('overdue_repeat_days') ?? '7'), 10) || 7))
  const weekday = Math.max(0, Math.min(6, parseInt(String(fd.get('digest_weekday') ?? '1'), 10) || 0))
  const admin = createAdminClient()
  const { error } = await admin.from('hr_compliance_settings').upsert({
    company_id: me.company_id,
    emails_enabled: bool(fd, 'emails_enabled'),
    dqf_notice_days: dqf,
    cert_notice_days: cert,
    overdue_repeat_days: repeat,
    notify_employee: bool(fd, 'notify_employee'),
    management_emails: parseEmailList(String(fd.get('management_emails') ?? '')),
    dqf_management_emails: parseEmailList(String(fd.get('dqf_management_emails') ?? '')),
    cert_management_emails: parseEmailList(String(fd.get('cert_management_emails') ?? '')),
    weekly_digest: bool(fd, 'weekly_digest'),
    digest_weekday: weekday,
    updated_by: me.id,
    updated_at: new Date().toISOString(),
  })
  if (error) return { error: error.message }
  revalidatePath('/compliance/settings')
  return { ok: true, message: 'Settings saved.' }
}

export async function saveRequirementType(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await complianceCaller(true)
  if (!me) return { error: 'No permission.' }
  const id = str(fd, 'id')
  const name = str(fd, 'name')
  if (!name) return { error: 'Name is required.' }
  const category = str(fd, 'category') ?? 'certification'
  const applies = str(fd, 'applies_to') ?? 'optional'
  const months = parseInt(String(fd.get('renewal_months') ?? ''), 10)
  const notice = parseDaysList(String(fd.get('notice_days') ?? ''))
  const row = {
    company_id: me.company_id,
    name,
    category: ['dqf', 'certification', 'personnel'].includes(category) ? category : 'certification',
    kind: str(fd, 'kind'),
    issuer: str(fd, 'issuer'),
    applies_to: ['dot', 'cdl', 'all', 'optional'].includes(applies) ? applies : 'optional',
    expires: bool(fd, 'expires'),
    notify: bool(fd, 'notify'),
    renewal_months: Number.isFinite(months) && months > 0 ? months : null,
    notice_days: notice.length ? notice : null,
    regulation: str(fd, 'regulation'),
    description: str(fd, 'description'),
    is_active: !bool(fd, 'retired'),
  }
  const admin = createAdminClient()
  const { error } = id
    ? await admin.from('hr_requirement_types').update(row).eq('id', id).eq('company_id', me.company_id)
    : await admin.from('hr_requirement_types').insert({ ...row, sort_order: 500 })
  if (error) return { error: error.message.includes('duplicate') ? 'A requirement with that name already exists.' : error.message }
  revalidatePath('/compliance/settings')
  revalidatePath('/compliance')
  return { ok: true, message: id ? 'Updated.' : 'Added.' }
}

export async function previewCheck(): Promise<CheckResult | { error: string }> {
  const me = await complianceCaller()
  if (!me) return { error: 'No permission.' }
  return runComplianceCheck(createAdminClient(), me.company_id, { dryRun: true })
}

export async function sendTest(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await complianceCaller(true)
  if (!me) return { error: 'No permission.' }
  const to = parseEmailList(String(fd.get('to') ?? ''))[0]
  if (!to) return { error: 'Enter an email address.' }
  const err = await sendTestEmail(to)
  return err ? { error: err } : { ok: true, message: `Test sent to ${to}.` }
}

/** DQF settings → "Who else can use DQF & Certs": people (any role) with full DQF access. Owners/managers only. */
export async function saveComplianceAccess(fd: FormData): Promise<void> {
  const me = await complianceCaller(true)
  if (!me || !['owner', 'manager'].includes(me.role)) return
  const ids = fd.getAll('profile_id').map(String).filter(v => /^[0-9a-f-]{36}$/i.test(v))
  const admin = createAdminClient()
  await admin.from('hr_compliance_settings').update({ access_profile_ids: ids, updated_by: me.id, updated_at: new Date().toISOString() }).eq('company_id', me.company_id)
  revalidatePath('/compliance/settings')
}
