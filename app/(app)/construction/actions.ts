'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  canWriteConstruction,
  CON_DOC_CATEGORY_VALUES,
} from '@/lib/construction'
import { classifySite } from '@/lib/site-number'

export type ActionState = { error: string } | null

// ── small parsers ───────────────────────────────────────────
function str(val: FormDataEntryValue | null) {
  const s = (val as string)?.trim()
  return s || null
}
function num(val: FormDataEntryValue | null): number | null {
  const s = (val as string)?.trim()
  if (!s) return null
  const v = Number(s.replace(/[$,]/g, ''))
  return isFinite(v) ? v : null
}
async function getProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from('profiles').select('id, company_id, role, full_name').eq('id', user.id).single()
  return data
}

// ============================================================
// CUSTOMERS
// ============================================================
export async function saveCustomer(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'You do not have permission to edit customers.' }

  const name = str(formData.get('name'))
  if (!name) return { error: 'Customer name is required.' }

  const admin = createAdminClient()
  const fields = {
    name,
    billing_contact: str(formData.get('billing_contact')),
    email:           str(formData.get('email')),
    phone:           str(formData.get('phone')),
    billing_address: str(formData.get('billing_address')),
    notes:           str(formData.get('notes')),
  }

  let customerId = id
  if (id) {
    const { error } = await admin.from('con_customers').update(fields).eq('id', id).eq('company_id', profile.company_id)
    if (error) return { error: error.message }
  } else {
    const { data, error } = await admin.from('con_customers')
      .insert({ ...fields, company_id: profile.company_id }).select('id').single()
    if (error) return { error: error.message }
    customerId = data!.id
  }

  revalidatePath('/construction/customers')
  redirect(`/construction/customers/${customerId}`)
}

export async function deleteCustomer(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  // Detach sites (keep the site rows; just unlink) then remove the customer.
  await admin.from('con_sites').update({ customer_id: null }).eq('customer_id', id).eq('company_id', profile.company_id)
  await admin.from('con_customers').delete().eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/customers')
  redirect('/construction/customers')
}

// ============================================================
// SITES
// ============================================================
export async function saveSite(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'You do not have permission to edit sites.' }

  const site_number = str(formData.get('site_number'))
  if (!site_number) return { error: 'Site number / name is required.' }

  const admin = createAdminClient()
  const fields = {
    customer_id:     str(formData.get('customer_id')),
    site_number,
    store_brand:     str(formData.get('store_brand')),
    address:         str(formData.get('address')),
    city:            str(formData.get('city')),
    state:           str(formData.get('state')),
    zip:             str(formData.get('zip')),
    dispenser_count: num(formData.get('dispenser_count')),
    dispenser_type:  str(formData.get('dispenser_type')),
    tank_count:      num(formData.get('tank_count')),
    tank_type:       str(formData.get('tank_type')),
    stp_count:       num(formData.get('stp_count')),
    stp_type:        str(formData.get('stp_type')),
    fill_spill_bucket_count: num(formData.get('fill_spill_bucket_count')),
    fill_spill_bucket_type:  str(formData.get('fill_spill_bucket_type')),
    vapor_bucket_count:      num(formData.get('vapor_bucket_count')),
    vapor_bucket_type:       str(formData.get('vapor_bucket_type')),
    notes:           str(formData.get('notes')),
  }

  if (id) {
    const { error } = await admin.from('con_sites').update(fields).eq('id', id).eq('company_id', profile.company_id)
    if (error) return { error: error.message }
  } else {
    const { error } = await admin.from('con_sites').insert({ ...fields, company_id: profile.company_id })
    if (error) return { error: error.message }
  }

  const redirectTo = str(formData.get('redirect_to'))
  revalidatePath('/construction/customers')
  if (redirectTo) redirect(redirectTo)
  if (fields.customer_id) redirect(`/construction/customers/${fields.customer_id}`)
  redirect('/construction/customers')
}

export async function deleteSite(id: string, redirectTo?: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_sites').delete().eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/customers')
  if (redirectTo) redirect(redirectTo)
}

// ============================================================
// JOBS
// ============================================================
function jobFields(formData: FormData) {
  return {
    site_id:             str(formData.get('site_id')),
    site_number:         str(formData.get('site_number')),
    customer_id:         str(formData.get('customer_id')),
    work_order_number:   str(formData.get('work_order_number')),
    po_number:           str(formData.get('po_number')),
    master_sync_hold:    formData.get('master_sync_hold') === 'on',
    stage:               str(formData.get('stage')) ?? 'survey',
    status_detail:       str(formData.get('status_detail')),
    scope_of_work:       str(formData.get('scope_of_work')),
    facility_address:    str(formData.get('facility_address')),
    gas_brand:           str(formData.get('gas_brand')),
    program:             str(formData.get('program')),
    priority:            str(formData.get('priority')) ?? 'normal',
    date_received:       str(formData.get('date_received')),
    project_start_date:  str(formData.get('project_start_date')),
    response_time:       str(formData.get('response_time')),
    assigned_manager_id: str(formData.get('assigned_manager_id')),
    notes:               str(formData.get('notes')),
  }
}

export async function saveJob(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'You do not have permission to edit jobs.' }

  const fields = jobFields(formData)
  if (!fields.site_number && !fields.site_id) return { error: 'A site number (or selected site) is required.' }

  const admin = createAdminClient()
  let jobId = id
  if (id) {
    const { error } = await admin.from('con_jobs').update(fields).eq('id', id).eq('company_id', profile.company_id)
    if (error) return { error: error.message }
  } else {
    const { data, error } = await admin.from('con_jobs')
      .insert({ ...fields, company_id: profile.company_id }).select('id').single()
    if (error) return { error: error.message }
    jobId = data!.id
  }

  revalidatePath('/construction/jobs')
  revalidatePath('/construction')
  redirect(`/construction/jobs/${jobId}`)
}

/** Quick stage change from the kanban / detail header. */
export async function changeJobStage(id: string, stage: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_jobs').update({ stage }).eq('id', id).eq('company_id', profile.company_id)
  // The con_jobs_stage_history trigger just wrote a row with no actor — patch
  // it with who made the change (see supabase/migrations/con_job_stage_history.sql).
  const { data: latest } = await admin.from('con_job_stage_history')
    .select('id').eq('job_id', id).order('changed_at', { ascending: false }).limit(1).maybeSingle()
  if (latest) {
    await admin.from('con_job_stage_history').update({ changed_by: profile.id, changed_by_name: profile.full_name })
      .eq('id', latest.id)
  }
  revalidatePath('/construction/jobs')
  revalidatePath('/construction')
  revalidatePath(`/construction/jobs/${id}`)
}

export async function deleteJob(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  // Child rows with ON DELETE CASCADE (materials, labor, closeout) go automatically;
  // quotes/invoices/schedule/documents keep their rows but null their job link.
  await admin.from('con_jobs').delete().eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/jobs')
  revalidatePath('/construction')
  redirect('/construction/jobs')
}

// ============================================================
// JOB MATERIALS
// ============================================================
export async function saveMaterial(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'You do not have permission to edit materials.' }

  const job_id = str(formData.get('job_id'))
  if (!job_id) return { error: 'Material must belong to a job.' }
  const description = str(formData.get('description'))
  if (!description) return { error: 'Description is required.' }

  const admin = createAdminClient()
  const fields = {
    job_id,
    item_number:  str(formData.get('item_number')),
    part_number:  str(formData.get('part_number')),
    description,
    quantity:     num(formData.get('quantity')),
    unit_cost:    num(formData.get('unit_cost')),
    status:       str(formData.get('status')) ?? 'needed',
    vendor:       str(formData.get('vendor')),
    ordered_date: str(formData.get('ordered_date')),
    received_date: str(formData.get('received_date')),
    notes:        str(formData.get('notes')),
  }

  if (id) {
    const { error } = await admin.from('con_job_materials').update(fields).eq('id', id).eq('company_id', profile.company_id)
    if (error) return { error: error.message }
  } else {
    const { error } = await admin.from('con_job_materials').insert({ ...fields, company_id: profile.company_id })
    if (error) return { error: error.message }
  }

  revalidatePath('/construction/materials')
  revalidatePath(`/construction/jobs/${job_id}`)
  return null
}

export async function setMaterialStatus(id: string, status: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const today = new Date().toISOString().split('T')[0]
  const updates: Record<string, unknown> = { status }
  if (status === 'ordered') updates.ordered_date = today
  if (status === 'received') updates.received_date = today
  await admin.from('con_job_materials').update(updates).eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/materials')
}

export async function deleteMaterial(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { data } = await admin.from('con_job_materials').select('job_id').eq('id', id).single()
  await admin.from('con_job_materials').delete().eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/materials')
  if (data?.job_id) revalidatePath(`/construction/jobs/${data.job_id}`)
}

// ============================================================
// SCHEDULE ENTRIES
// ============================================================
export async function saveScheduleEntry(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'You do not have permission to edit the schedule.' }

  const schedule_date = str(formData.get('schedule_date'))
  if (!schedule_date) return { error: 'A date is required.' }

  // crew arrives as a comma/space separated string → text[]
  const crewRaw = str(formData.get('crew'))
  const crew = crewRaw ? crewRaw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean) : null

  const entryTypeRaw = str(formData.get('entry_type'))
  const entry_type = ['job', 'time_off', 'note'].includes(entryTypeRaw ?? '') ? entryTypeRaw : 'job'

  const admin = createAdminClient()
  const fields = {
    schedule_date,
    entry_type,
    job_id:           entry_type === 'job' ? str(formData.get('job_id')) : null,
    site_number:      str(formData.get('site_number')),
    task_description: str(formData.get('task_description')),
    crew,
    equipment:        str(formData.get('equipment')),
    notes:            str(formData.get('notes')),
  }

  if (id) {
    const { error } = await admin.from('con_schedule_entries').update(fields).eq('id', id).eq('company_id', profile.company_id)
    if (error) return { error: error.message }
  } else {
    const { error } = await admin.from('con_schedule_entries').insert({ ...fields, company_id: profile.company_id })
    if (error) return { error: error.message }
  }

  revalidatePath('/construction/schedule')
  return null
}

export async function moveScheduleEntry(id: string, schedule_date: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_schedule_entries').update({ schedule_date }).eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/schedule')
}

export async function deleteScheduleEntry(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_schedule_entries').delete().eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/schedule')
}

export async function toggleChecklistItem(id: string, done: boolean): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_checklist_items').update({ done }).eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/checklist')
}

// ── Subcontractors ──────────────────────────────────────────
export async function saveSubcontractor(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'You do not have permission to edit subcontractors.' }

  const name = str(formData.get('name'))
  if (!name) return { error: 'Name is required.' }

  const admin = createAdminClient()
  const fields = {
    name,
    trade:        str(formData.get('trade')),
    contact_name: str(formData.get('contact_name')),
    phone:        str(formData.get('phone')),
    email:        str(formData.get('email')),
    notes:        str(formData.get('notes')),
    is_active:    formData.get('is_active') != null,
  }
  if (id) {
    const { error } = await admin.from('con_subcontractors').update(fields).eq('id', id).eq('company_id', profile.company_id)
    if (error) return { error: error.message }
  } else {
    const { error } = await admin.from('con_subcontractors').insert({ ...fields, company_id: profile.company_id })
    if (error) return { error: error.message }
  }
  revalidatePath('/construction/subcontractors')
  redirect('/construction/subcontractors')
}

export async function deleteSubcontractor(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_subcontractors').delete().eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/subcontractors')
  redirect('/construction/subcontractors')
}

export async function assignSubcontractor(jobId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'You do not have permission to assign subcontractors.' }
  const subId = str(formData.get('subcontractor_id'))
  if (!subId) return { error: 'Pick a subcontractor.' }
  const admin = createAdminClient()
  const { error } = await admin.from('con_job_subcontractors').upsert(
    { company_id: profile.company_id, job_id: jobId, subcontractor_id: subId, role: str(formData.get('role')) },
    { onConflict: 'job_id,subcontractor_id' },
  )
  if (error) return { error: error.message }
  revalidatePath(`/construction/jobs/${jobId}`)
  return null
}

export async function unassignSubcontractor(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_job_subcontractors').delete().eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/jobs/[id]', 'page')
}

// ── Vendors ─────────────────────────────────────────────────
export async function saveVendor(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'You do not have permission to edit vendors.' }

  const name = str(formData.get('name'))
  if (!name) return { error: 'Name is required.' }

  const admin = createAdminClient()
  const fields = {
    name,
    category:       str(formData.get('category')),
    contact_name:   str(formData.get('contact_name')),
    phone:          str(formData.get('phone')),
    email:          str(formData.get('email')),
    account_number: str(formData.get('account_number')),
    notes:          str(formData.get('notes')),
    is_active:      formData.get('is_active') != null,
  }
  if (id) {
    const { error } = await admin.from('con_vendors').update(fields).eq('id', id).eq('company_id', profile.company_id)
    if (error) return { error: error.message }
  } else {
    const { error } = await admin.from('con_vendors').insert({ ...fields, company_id: profile.company_id })
    if (error) return { error: error.message }
  }
  revalidatePath('/construction/vendors')
  redirect('/construction/vendors')
}

export async function deleteVendor(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_vendors').delete().eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/vendors')
  redirect('/construction/vendors')
}

// ── Project Notification (brand pre-start notice) ───────────────
function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function markNotificationSent(jobId: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_jobs')
    .update({ notification_sent_at: todayYmd(), notification_sent_by: profile.id, notification_waived: false })
    .eq('id', jobId).eq('company_id', profile.company_id)
  revalidatePath('/construction')
  revalidatePath('/construction/jobs/[id]', 'page')
}

export async function clearNotificationSent(jobId: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_jobs')
    .update({ notification_sent_at: null, notification_sent_by: null })
    .eq('id', jobId).eq('company_id', profile.company_id)
  revalidatePath('/construction')
  revalidatePath('/construction/jobs/[id]', 'page')
}

export async function setNotificationWaived(jobId: string, waived: boolean): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_jobs')
    .update({ notification_waived: waived })
    .eq('id', jobId).eq('company_id', profile.company_id)
  revalidatePath('/construction')
  revalidatePath('/construction/jobs/[id]', 'page')
}

// ============================================================
// CLOSE-OUT TASKS
// ============================================================
const DEFAULT_CLOSEOUT_TASKS = [
  'Intercom working', 'Iso relays', 'Pump toppers', 'Data disconnect',
  'Dispensers caulked', 'Disp pics & closeout', 'Invoice sent', 'Punchlist',
]

export async function seedCloseoutTasks(jobId: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { count } = await admin.from('con_closeout_tasks')
    .select('*', { count: 'exact', head: true }).eq('job_id', jobId)
  if ((count ?? 0) > 0) return
  await admin.from('con_closeout_tasks').insert(
    DEFAULT_CLOSEOUT_TASKS.map(task_name => ({ company_id: profile.company_id, job_id: jobId, task_name }))
  )
  revalidatePath(`/construction/jobs/${jobId}`)
}

export async function addCloseoutTask(jobId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'No permission.' }
  const task_name = str(formData.get('task_name'))
  if (!task_name) return { error: 'Task name is required.' }
  const admin = createAdminClient()
  await admin.from('con_closeout_tasks').insert({ company_id: profile.company_id, job_id: jobId, task_name })
  revalidatePath(`/construction/jobs/${jobId}`)
  return null
}

export async function toggleCloseoutTask(id: string, isComplete: boolean): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { data: me } = await admin.from('profiles').select('full_name').eq('id', profile.id).single()
  await admin.from('con_closeout_tasks').update({
    is_complete: isComplete,
    completed_by: isComplete ? (me?.full_name ?? null) : null,
    completed_date: isComplete ? new Date().toISOString().split('T')[0] : null,
  }).eq('id', id).eq('company_id', profile.company_id)
  const { data } = await admin.from('con_closeout_tasks').select('job_id').eq('id', id).single()
  if (data?.job_id) revalidatePath(`/construction/jobs/${data.job_id}`)
}

export async function deleteCloseoutTask(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { data } = await admin.from('con_closeout_tasks').select('job_id').eq('id', id).single()
  await admin.from('con_closeout_tasks').delete().eq('id', id).eq('company_id', profile.company_id)
  if (data?.job_id) revalidatePath(`/construction/jobs/${data.job_id}`)
}

// ============================================================
// JOB LABOR (manual log for job-cost)
// ============================================================
export async function addJobLabor(jobId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'No permission.' }
  const hours = num(formData.get('hours'))
  if (hours == null) return { error: 'Hours are required.' }
  const admin = createAdminClient()
  await admin.from('con_job_labor').insert({
    company_id: profile.company_id,
    job_id: jobId,
    work_date: str(formData.get('work_date')),
    crew_member: str(formData.get('crew_member')),
    hours,
    labor_rate: num(formData.get('labor_rate')),
    task_note: str(formData.get('task_note')),
  })
  revalidatePath(`/construction/jobs/${jobId}`)
  return null
}

export async function deleteJobLabor(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { data } = await admin.from('con_job_labor').select('job_id').eq('id', id).single()
  await admin.from('con_job_labor').delete().eq('id', id).eq('company_id', profile.company_id)
  if (data?.job_id) revalidatePath(`/construction/jobs/${data.job_id}`)
}

// ============================================================
// DAILY UPDATES (Phase 2) — ticket + techs/initials/hours -> man-hours
// ============================================================
export async function addDailyUpdate(jobId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'No permission.' }

  const workDescription = str(formData.get('work_description'))
  // Tech rows arrive as parallel arrays: tech_name[], initials[], hours[]
  const names = formData.getAll('tech_name').map((v) => (v as string)?.trim())
  const inits = formData.getAll('initials').map((v) => (v as string)?.trim())
  const hrs = formData.getAll('hours').map((v) => num(v))
  const techs = names
    .map((name, i) => ({ tech_name: name, initials: inits[i] || null, hours: hrs[i] ?? 0 }))
    .filter((t) => t.tech_name)

  if (!workDescription && techs.length === 0) {
    return { error: 'Add a work description or at least one tech.' }
  }

  const admin = createAdminClient()

  // The update row comes first so every file we file in the doc center can point
  // back at it — that link is what lets an update show its own gallery.
  const { data: du, error } = await admin.from('con_daily_updates').insert({
    company_id: profile.company_id,
    job_id: jobId,
    // A blank date used to hit the NOT NULL constraint and lose the whole update; default to today (Eastern).
    work_date: str(formData.get('work_date')) ?? new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
    work_description: workDescription || '',
    notes: str(formData.get('notes')),
    submitted_by: profile.id,
  }).select('id').single()
  if (error) return { error: error.message }

  // Upload a file to storage and file it in the doc center against this update.
  const fileIt = async (f: File, category: string, docType: string) => {
    const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
    const path = `${profile.company_id}/${jobId}/daily/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`
    const buf = Buffer.from(await f.arrayBuffer())
    const { error: upErr } = await admin.storage.from('construction-docs')
      .upload(path, buf, { contentType: f.type || 'application/octet-stream', upsert: true })
    if (upErr) return { path: null as string | null, docId: null as string | null, error: upErr.message }
    const { data: doc } = await admin.from('con_documents').insert({
      company_id: profile.company_id, job_id: jobId, daily_update_id: du.id,
      file_name: f.name, original_filename: f.name,
      storage_path: path, category, doc_type: docType,
      uploaded_by: profile.id, review_status: 'filed',
    }).select('id').single()
    return { path, docId: doc?.id ?? null, error: null as string | null }
  }

  const ticket = formData.get('ticket') as File | null
  if (ticket && typeof ticket === 'object' && ticket.size > 0) {
    const r = await fileIt(ticket, 'daily_updates', 'daily_ticket')
    if (r.error) return { error: `Ticket upload failed: ${r.error}` }
    await admin.from('con_daily_updates')
      .update({ ticket_storage_path: r.path, ticket_document_id: r.docId })
      .eq('id', du.id)
  }

  const photos = formData.getAll('photos').filter(
    (f): f is File => typeof f === 'object' && f !== null && (f as File).size > 0,
  )
  for (const photo of photos) {
    const r = await fileIt(photo, 'photos', 'photo')
    if (r.error) return { error: `Photo upload failed: ${r.error}` }
  }

  if (techs.length > 0) {
    const { error: tErr } = await admin.from('con_daily_update_techs').insert(
      techs.map((t) => ({ company_id: profile.company_id, daily_update_id: du.id, ...t })),
    )
    if (tErr) return { error: tErr.message }
  }

  revalidatePath(`/construction/jobs/${jobId}`)
  return null
}

// ── Disposables (Phase 2, increment 2) ──────────────────────
// Rows arrive as parallel arrays, the same shape the tech rows use. Only
// items the crew actually put a number against are stored, so a form with
// three entries doesn't persist twenty empty ones.
export async function addDisposablesForm(state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'No permission.' }

  const jobId = str(formData.get('job_id'))
  if (!jobId) return { error: 'Missing job.' }

  const codes  = formData.getAll('item_code').map((v) => v as string)
  const labels = formData.getAll('item_label').map((v) => v as string)
  const amts   = formData.getAll('item_amount').map((v) => num(v))
  const ords   = formData.getAll('item_ordered').map((v) => num(v))

  const items = codes
    .map((code, i) => ({ code, label: labels[i] ?? code, amount: amts[i] ?? null, ordered: ords[i] ?? null }))
    .filter((r) => r.amount !== null || r.ordered !== null)

  const xLabels = formData.getAll('extra_label').map((v) => (v as string)?.trim())
  const xAmts   = formData.getAll('extra_amount').map((v) => num(v))
  const xOrds   = formData.getAll('extra_ordered').map((v) => num(v))
  xLabels.forEach((label, i) => {
    if (label) items.push({ code: 'DSP-OTHER', label, amount: xAmts[i] ?? null, ordered: xOrds[i] ?? null })
  })

  const formNames  = formData.getAll('form_name').map((v) => v as string)
  const formCopies = formData.getAll('form_copies').map((v) => num(v))
  const forms = formNames
    .map((name, i) => ({ name, copies: formCopies[i] ?? null }))
    .filter((f) => f.copies !== null)

  if (items.length === 0 && forms.length === 0) {
    return { error: 'Enter a count against at least one item or form.' }
  }

  const admin = createAdminClient()
  const { error } = await admin.from('con_disposables_forms').insert({
    company_id: profile.company_id,
    job_id: jobId,
    tech_name: str(formData.get('tech_name')),
    truck: str(formData.get('truck')),
    form_date: str(formData.get('form_date')) || undefined,
    items,
    forms,
  })
  if (error) return { error: error.message }

  revalidatePath(`/construction/jobs/${jobId}`)
  return null
}

export async function deleteDisposablesForm(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { data } = await admin.from('con_disposables_forms')
    .select('job_id').eq('id', id).eq('company_id', profile.company_id).single()
  await admin.from('con_disposables_forms').delete().eq('id', id).eq('company_id', profile.company_id)
  if (data?.job_id) revalidatePath(`/construction/jobs/${data.job_id}`)
}

/** Crew-facing variant: the job comes from the form's dropdown, not the URL. */
export async function addDailyUpdateForPickedJob(state: ActionState, formData: FormData): Promise<ActionState> {
  const jobId = str(formData.get('job_id'))
  if (!jobId) return { error: 'Pick a job first.' }
  return addDailyUpdate(jobId, state, formData)
}

export async function deleteDailyUpdate(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { data } = await admin.from('con_daily_updates')
    .select('job_id, ticket_storage_path, ticket_document_id').eq('id', id).eq('company_id', profile.company_id).single()
  if (data?.ticket_storage_path) {
    await admin.storage.from('construction-docs').remove([data.ticket_storage_path])
  }
  // Drop the doc-center row too, or it lingers pointing at the file we just removed.
  if (data?.ticket_document_id) {
    await admin.from('con_documents').delete()
      .eq('id', data.ticket_document_id).eq('company_id', profile.company_id)
  }
  // techs cascade-delete via FK
  await admin.from('con_daily_updates').delete().eq('id', id).eq('company_id', profile.company_id)
  if (data?.job_id) revalidatePath(`/construction/jobs/${data.job_id}`)
}

/** Confirms a backfilled field-ticket draft (review_status: needs_review -> filed).
 * A human reading the billing preview in `notes` is the only thing that ever
 * flips this — the backfill pipeline itself never marks its own rows filed. */
export async function confirmFieldTicketDraft(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { data } = await admin.from('con_daily_updates')
    .update({ review_status: 'filed' })
    .eq('id', id).eq('company_id', profile.company_id)
    .select('job_id').single()
  if (data?.job_id) revalidatePath(`/construction/jobs/${data.job_id}`)
}

// ============================================================
// DOCUMENTS
// ============================================================
export async function deleteDocument(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { data: doc } = await admin.from('con_documents')
    .select('job_id, storage_path').eq('id', id).eq('company_id', profile.company_id).single()
  if (doc?.storage_path) {
    await admin.storage.from('construction-docs').remove([doc.storage_path])
  }
  await admin.from('con_documents').delete().eq('id', id).eq('company_id', profile.company_id)
  if (doc?.job_id) revalidatePath(`/construction/jobs/${doc.job_id}`)
}

// File a document into a category and clear it from the review queue.
// Used by the "Needs Review" page to approve/reassign an importer guess.
export async function fileDocument(id: string, category: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  if (!CON_DOC_CATEGORY_VALUES.includes(category)) return
  const admin = createAdminClient()
  const { data: doc } = await admin.from('con_documents')
    .select('job_id').eq('id', id).eq('company_id', profile.company_id).single()
  await admin.from('con_documents')
    .update({ category, review_status: 'filed' })
    .eq('id', id).eq('company_id', profile.company_id)
  revalidatePath('/construction/documents/review')
  if (doc?.job_id) revalidatePath(`/construction/jobs/${doc.job_id}`)
}

// ============================================================
// EMAIL OUT (Phase 5) — invoice PDF to the customer via Resend
// ============================================================
export type EmailState = { error?: string; ok?: boolean; sentTo?: string } | null

function splitEmails(s: string | null): string[] {
  return (s ?? '').split(/[,;\s]+/).map(e => e.trim()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

export async function emailInvoice(id: string, _state: EmailState, formData: FormData): Promise<EmailState> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return { error: 'You do not have permission to send invoices.' }
  if (!process.env.RESEND_API_KEY) return { error: 'Email sending is not configured yet. Add RESEND_API_KEY and RESEND_FROM_EMAIL in Vercel → Settings → Environment Variables, then redeploy.' }

  const to = splitEmails(str(formData.get('to')))
  const cc = splitEmails(str(formData.get('cc')))
  const subject = str(formData.get('subject'))
  const message = str(formData.get('message')) ?? ''
  if (!to.length) return { error: 'Enter at least one valid email address.' }
  if (!subject) return { error: 'Subject is required.' }

  const admin = createAdminClient()
  const { buildInvoicePdf } = await import('@/lib/invoice-pdf')
  const built = await buildInvoicePdf(admin, id, profile.company_id)
  if (!built) return { error: 'Invoice not found.' }
  const { pdf, invoice } = built
  const number = invoice.invoice_number ?? 'Invoice'
  const total = Number(invoice.invoice_grand_total) || 0

  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_INVOICE_FROM ?? process.env.RESEND_FROM_EMAIL ?? 'RPS <invoices@rpsmaintenance.com>'
  const replyTo = process.env.RESEND_REPLY_TO
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
      <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#6b7280;letter-spacing:.08em;text-transform:uppercase">Rappahannock Petroleum Services</p>
      <h2 style="margin:0 0 12px;font-size:20px;font-weight:700">Invoice ${escapeHtml(number)}</h2>
      <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;white-space:pre-line">${escapeHtml(message)}</p>
      <table style="font-size:14px;color:#374151;border-collapse:collapse">
        ${invoice.store_label ? `<tr><td style="padding:2px 12px 2px 0;color:#6b7280">Site</td><td>${escapeHtml(invoice.store_label)}</td></tr>` : ''}
        ${invoice.po_number ? `<tr><td style="padding:2px 12px 2px 0;color:#6b7280">PO</td><td>${escapeHtml(invoice.po_number)}</td></tr>` : ''}
        ${invoice.csr_number ? `<tr><td style="padding:2px 12px 2px 0;color:#6b7280">CSR</td><td>${escapeHtml(invoice.csr_number)}</td></tr>` : ''}
        <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Amount due</td><td><b>$${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></td></tr>
        ${invoice.due_date ? `<tr><td style="padding:2px 12px 2px 0;color:#6b7280">Due</td><td>${escapeHtml(String(invoice.due_date))}</td></tr>` : ''}
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#9ca3af">The invoice is attached as a PDF.</p>
    </div>`

  const { data, error } = await resend.emails.send({
    from, to, cc: cc.length ? cc : undefined, replyTo: replyTo || undefined, subject, html,
    text: `${message}\n\nInvoice ${number} — amount due $${total.toFixed(2)}. PDF attached.`,
    attachments: [{ filename: `${number}.pdf`, content: pdf }],
  })

  await admin.from('billing_emails').insert({
    company_id: profile.company_id, invoice_id: id, to_emails: to, cc_emails: cc.length ? cc : null, subject, message,
    provider: 'resend', provider_id: data?.id ?? null, status: error ? 'failed' : 'sent', error: error?.message ?? null, sent_by: profile.id,
  })
  if (error) return { error: `Send failed: ${error.message}` }

  if (invoice.status === 'draft') {
    await admin.from('con_invoices').update({ status: 'sent', sent_date: new Date().toISOString().split('T')[0] }).eq('id', id).eq('company_id', profile.company_id)
  }
  revalidatePath('/construction/invoices')
  revalidatePath(`/construction/invoices/${id}`)
  return { ok: true, sentTo: to.join(', ') }
}

// ── Dispatch → Construction job ─────────────────────────────
/**
 * Turn a dispatched work order (svc_work_orders, already parsed with site number
 * + address) into a construction job: cleans the site number, finds or creates the
 * matching con_sites row, and opens a con_jobs record pre-filled with the site,
 * address, WO number and scope. The job_number trigger numbers it automatically.
 * Idempotent per WO — if a job already carries this WO number it just opens it.
 */
export async function createJobFromWorkOrder(workOrderId: string) {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()

  const { data: wo } = await admin
    .from('svc_work_orders')
    .select('portal_wo_number, site_number, site_name, site_address, site_city, site_state, subject_raw, description, priority_raw, dispatched_at, client_name')
    .eq('id', workOrderId).eq('company_id', profile.company_id).single()
  if (!wo) return

  // Don't create a second job for the same work order.
  if (wo.portal_wo_number) {
    const { data: existing } = await admin.from('con_jobs')
      .select('id').eq('company_id', profile.company_id).eq('work_order_number', wo.portal_wo_number).limit(1).maybeSingle()
    if (existing) redirect(`/construction/jobs/${existing.id}`)
  }

  const { siteNumber, brand } = classifySite(wo.site_number)
  const cityStateZip = [wo.site_city, wo.site_state].filter(Boolean).join(', ')

  // Find or create the site.
  let siteId: string | null = null
  if (siteNumber) {
    const { data: site } = await admin.from('con_sites')
      .select('id').eq('company_id', profile.company_id).eq('site_number', siteNumber).limit(1).maybeSingle()
    if (site) siteId = site.id
    else {
      const { data: created } = await admin.from('con_sites').insert({
        company_id: profile.company_id, site_number: siteNumber, store_brand: brand,
        address: wo.site_address, city: wo.site_city, state: wo.site_state,
      }).select('id').single()
      siteId = created?.id ?? null
    }
  }

  const dispatchedDate = wo.dispatched_at ? new Date(wo.dispatched_at).toISOString().slice(0, 10) : null
  const { data: job, error } = await admin.from('con_jobs').insert({
    company_id: profile.company_id,
    site_id: siteId,
    site_number: siteNumber || wo.site_number,
    work_order_number: wo.portal_wo_number,
    scope_of_work: wo.subject_raw || wo.description || null,
    facility_address: wo.site_address,
    gas_brand: brand,
    date_received: dispatchedDate,
    stage: 'survey',
    notes: [wo.client_name && `Client: ${wo.client_name}`, cityStateZip, wo.priority_raw && `Priority: ${wo.priority_raw}`]
      .filter(Boolean).join(' · ') || null,
  }).select('id').single()
  if (error || !job) return

  revalidatePath('/construction/jobs')
  revalidatePath('/service')
  redirect(`/construction/jobs/${job.id}`)
}
