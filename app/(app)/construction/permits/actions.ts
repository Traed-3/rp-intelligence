'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { canWriteConstruction } from '@/lib/construction'
import {
  PERMIT_STATUS_VALUES, REQUIREMENT_STATUSES, isInHandOrLater,
  defaultPulledBy, computeReadyToWork, iso,
} from '@/lib/permits'
import { findOrCreateJobForPermitSite, linkProjectToChosenJob } from '@/lib/permit-job-link'

export type ActionState = { error: string } | null

function str(v: FormDataEntryValue | null) {
  const s = (v as string)?.trim()
  return s || null
}
function num(v: FormDataEntryValue | null): number | null {
  const s = (v as string)?.trim()
  if (!s) return null
  const x = Number(s.replace(/[$,]/g, ''))
  return isFinite(x) ? x : null
}

async function getProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from('profiles').select('id, company_id, role, full_name').eq('id', user.id).single()
  return data as { id: string; company_id: string; role: string; full_name: string } | null
}

type Prof = { id: string; company_id: string; role: string; full_name: string }

async function logEvent(
  admin: ReturnType<typeof createAdminClient>, prof: Prof, permitId: string,
  from: string | null, to: string | null, note: string | null,
) {
  await admin.from('con_permit_events').insert({
    company_id: prof.company_id,
    permit_id: permitId,
    changed_by: prof.id,
    changed_by_name: prof.full_name,
    from_status: from,
    to_status: to,
    note,
  })
}

// ── Inline status change from the board / site view ──
// Writes an event every time, and enforces the auto-resolve rule in code.
export async function updatePermitStatus(permitId: string, newStatus: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  if (!PERMIT_STATUS_VALUES.includes(newStatus as never)) return
  const admin = createAdminClient()

  const { data: permit } = await admin.from('con_permits')
    .select('id, project_id, permit_type, status, date_completed')
    .eq('id', permitId).eq('company_id', profile.company_id).single()
  if (!permit) return
  if (permit.status === newStatus) return

  // Marking a permit Complete stamps today's date as the completion date (unless one is already set).
  const patch: { status: string; date_completed?: string } = { status: newStatus }
  if (newStatus === 'Complete' && !permit.date_completed) patch.date_completed = iso(new Date())
  await admin.from('con_permits').update(patch).eq('id', permitId).eq('company_id', profile.company_id)
  await logEvent(admin, profile, permitId, permit.status, newStatus, null)

  // AUTO-RESOLVE: electrical reaching Permit In-Hand (or later) proves the
  // jurisdiction wanted nothing else — clear every Unknown on the project.
  if (permit.permit_type === 'Electrical' && isInHandOrLater(newStatus)) {
    const { data: unknowns } = await admin.from('con_permits')
      .select('id, status')
      .eq('company_id', profile.company_id)
      .eq('project_id', permit.project_id)
      .eq('requirement_status', 'Unknown')
    for (const u of unknowns ?? []) {
      await admin.from('con_permits').update({ requirement_status: 'Not Required' })
        .eq('id', u.id).eq('company_id', profile.company_id)
      await logEvent(admin, profile, u.id, u.status, u.status, 'auto-resolved: electrical issued')
    }
  }

  revalidatePath('/construction/permits')
  revalidatePath('/construction')
}

// ── Flip an Unknown placeholder to Required or Not Required ──
export async function setPermitRequirement(permitId: string, requirement: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  if (!REQUIREMENT_STATUSES.includes(requirement as never)) return
  const admin = createAdminClient()
  const { data: permit } = await admin.from('con_permits')
    .select('id, status, requirement_status').eq('id', permitId).eq('company_id', profile.company_id).single()
  if (!permit || permit.requirement_status === requirement) return

  await admin.from('con_permits').update({ requirement_status: requirement })
    .eq('id', permitId).eq('company_id', profile.company_id)
  await logEvent(admin, profile, permitId, permit.status, permit.status,
    `requirement changed: ${permit.requirement_status} → ${requirement}`)
  revalidatePath('/construction/permits')
  revalidatePath('/construction')
}

// ── Edit the detail fields of a permit ──
export async function updatePermitDetails(permitId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'No permission.' }
  const admin = createAdminClient()
  const { error } = await admin.from('con_permits').update({
    pulled_by: str(formData.get('pulled_by')) ?? 'RPS',
    permit_number: str(formData.get('permit_number')),
    fee: num(formData.get('fee')),
    date_submitted_to_hash: str(formData.get('date_submitted_to_hash')),
    date_hash_confirmed: str(formData.get('date_hash_confirmed')),
    date_submitted_to_jurisdiction: str(formData.get('date_submitted_to_jurisdiction')),
    date_issued: str(formData.get('date_issued')),
    inspection_date: str(formData.get('inspection_date')),
    date_completed: str(formData.get('date_completed')),
    notes: str(formData.get('notes')),
  }).eq('id', permitId).eq('company_id', profile.company_id)
  if (error) return { error: error.message }
  revalidatePath('/construction/permits')
  return null
}

// ── Create a project and auto-create its permits ──
export async function createPermitProject(_state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'No permission.' }
  const admin = createAdminClient()

  const siteNumber = str(formData.get('site_number'))
  if (!siteNumber) return { error: 'Site number is required.' }
  const projectType = str(formData.get('project_type')) ?? 'Dispenser Replacement'

  // find or create the site
  let { data: site } = await admin.from('con_permit_sites')
    .select('id, jurisdiction_id').eq('company_id', profile.company_id).eq('site_number', siteNumber).maybeSingle()
  if (!site) {
    const jid = str(formData.get('jurisdiction_id'))
    const ins = await admin.from('con_permit_sites').insert({
      company_id: profile.company_id,
      site_number: siteNumber,
      name: str(formData.get('site_name')),
      address: str(formData.get('address')),
      city: str(formData.get('city')),
      state: str(formData.get('state')),
      brand: str(formData.get('brand')),
      jurisdiction_id: jid,
    }).select('id, jurisdiction_id').single()
    if (ins.error) return { error: ins.error.message }
    site = ins.data
  }

  const proj = await admin.from('con_permit_projects').insert({
    company_id: profile.company_id,
    site_id: site.id,
    project_type: projectType,
    request_type: str(formData.get('request_type')),
    scheduled_work_date: str(formData.get('scheduled_work_date')),
    scope: str(formData.get('scope')),
  }).select('id').single()
  if (proj.error) return { error: proj.error.message }
  const projectId = proj.data.id

  // Every project starts with its Electrical permit. Building/Mechanical
  // permits are added manually on the rare occasions a jurisdiction wants them.
  await admin.from('con_permits').insert({
    company_id: profile.company_id, project_id: projectId, permit_key: `${siteNumber}-ELEC`,
    permit_type: 'Electrical', pulled_by: defaultPulledBy('Electrical'), requirement_status: 'Required', status: 'Not Started',
  })

  // "If we have a permit, it's a project" — auto-link (or auto-create) the
  // matching Construction job right away rather than leave this orphaned.
  const { data: fullSite } = await admin.from('con_permit_sites')
    .select('id, site_number, name, address, city, state, brand').eq('id', site.id).single()
  if (fullSite) {
    const linkResult = await findOrCreateJobForPermitSite(admin, profile.company_id, fullSite, { id: projectId, project_type: projectType })
    if (linkResult.status === 'created' || linkResult.status === 'linked') {
      revalidatePath('/construction/jobs')
      revalidatePath(`/construction/jobs/${linkResult.jobId}`)
    }
  }

  revalidatePath('/construction/permits')
  revalidatePath('/construction')
  redirect(`/construction/permits/sites/${site.id}`)
}

// ── Link a permit project to a job the user picked (ambiguous-match case) ──
export async function linkPermitProjectToJob(projectId: string, jobId: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await linkProjectToChosenJob(admin, profile.company_id, projectId, jobId)
  const { data: project } = await admin.from('con_permit_projects').select('site_id').eq('id', projectId).single()
  if (project?.site_id) revalidatePath(`/construction/permits/sites/${project.site_id}`)
  revalidatePath(`/construction/jobs/${jobId}`)
}

// ── Create a brand-new job for a permit project instead of linking one ──
export async function createJobForPermitProject(projectId: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { data: project } = await admin.from('con_permit_projects').select('id, site_id, project_type').eq('id', projectId).eq('company_id', profile.company_id).single()
  if (!project) return
  const { data: site } = await admin.from('con_permit_sites').select('id, site_number, name, address, city, state, brand').eq('id', project.site_id).single()
  if (!site) return
  const result = await findOrCreateJobForPermitSite(admin, profile.company_id, site, project, { forceCreate: true })
  if (result.status !== 'created' && result.status !== 'already_linked') return
  revalidatePath(`/construction/permits/sites/${project.site_id}`)
  revalidatePath('/construction/jobs')
  redirect(`/construction/jobs/${result.jobId}`)
}

// ── Add a permit to an existing project (e.g. a Building or Mechanical
//    permit a jurisdiction turns out to want) ──
export async function addPermit(projectId: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'No permission.' }
  const admin = createAdminClient()

  const { data: project } = await admin.from('con_permit_projects')
    .select('id, site_id').eq('id', projectId).eq('company_id', profile.company_id).single()
  if (!project) return { error: 'Project not found.' }
  const { data: site } = await admin.from('con_permit_sites')
    .select('site_number').eq('id', project.site_id).single()

  const permitType = str(formData.get('permit_type')) ?? 'Building'
  const codeMap: Record<string, string> = {
    Electrical: 'ELEC', Building: 'BLDG', Mechanical: 'MECH', Plumbing: 'PLMB', Fire: 'FIRE', Zoning: 'ZON', Other: 'OTH',
  }
  const key = site?.site_number ? `${site.site_number}-${codeMap[permitType] ?? 'OTH'}` : null

  const { error } = await admin.from('con_permits').insert({
    company_id: profile.company_id,
    project_id: projectId,
    permit_key: key,
    permit_type: permitType,
    pulled_by: str(formData.get('pulled_by')) ?? defaultPulledBy(permitType),
    requirement_status: str(formData.get('requirement_status')) ?? 'Required',
    status: 'Not Started',
    notes: str(formData.get('notes')),
  })
  if (error) return { error: error.message }
  revalidatePath('/construction/permits')
  revalidatePath(`/construction/permits/sites/${project.site_id}`)
  return null
}

// ── Mark a project ready to work — gated in code, not just the UI ──
export async function markReadyToWork(projectId: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { data: permits } = await admin.from('con_permits')
    .select('requirement_status, status').eq('company_id', profile.company_id).eq('project_id', projectId)
  if (!computeReadyToWork(permits ?? [])) return // refuse: a Required permit is below Permit In-Hand
  await admin.from('con_permit_projects').update({ ready_to_work: true })
    .eq('id', projectId).eq('company_id', profile.company_id)
  const { data: proj } = await admin.from('con_permit_projects').select('site_id').eq('id', projectId).single()
  if (proj?.site_id) revalidatePath(`/construction/permits/sites/${proj.site_id}`)
}

export async function clearReadyToWork(projectId: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  await admin.from('con_permit_projects').update({ ready_to_work: false })
    .eq('id', projectId).eq('company_id', profile.company_id)
  const { data: proj } = await admin.from('con_permit_projects').select('site_id').eq('id', projectId).single()
  if (proj?.site_id) revalidatePath(`/construction/permits/sites/${proj.site_id}`)
}

// ── Save a jurisdiction (cheat sheet + inheritance flags + contacts) ──
export async function saveJurisdiction(id: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!canWriteConstruction(profile)) return { error: 'No permission.' }
  const tri = (v: string | null) => (v === 'yes' || v === 'no' ? v : 'unknown')
  const admin = createAdminClient()
  const { error } = await admin.from('con_jurisdictions').update({
    department: str(formData.get('department')),
    contact_name: str(formData.get('contact_name')),
    phone: str(formData.get('phone')),
    email: str(formData.get('email')),
    portal_url: str(formData.get('portal_url')),
    submittal_method: str(formData.get('submittal_method')),
    typical_turnaround_days: str(formData.get('typical_turnaround_days')),
    fee_notes: str(formData.get('fee_notes')),
    contractor_requirements: str(formData.get('contractor_requirements')),
    cheat_sheet: str(formData.get('cheat_sheet')),
    requires_building_with_electrical: tri(str(formData.get('requires_building_with_electrical'))),
    requires_mechanical_with_electrical: tri(str(formData.get('requires_mechanical_with_electrical'))),
  }).eq('id', id).eq('company_id', profile.company_id)
  if (error) return { error: error.message }
  revalidatePath(`/construction/permits/jurisdictions/${id}`)
  revalidatePath('/construction/permits/jurisdictions')
  return null
}

// ── Delete a deliverable (and its stored file) ──
export async function deleteDeliverable(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction(profile)) return
  const admin = createAdminClient()
  const { data } = await admin.from('con_permit_deliverables')
    .select('site_id, storage_path').eq('id', id).eq('company_id', profile.company_id).single()
  if (data?.storage_path) await admin.storage.from('construction-docs').remove([data.storage_path])
  await admin.from('con_permit_deliverables').delete().eq('id', id).eq('company_id', profile.company_id)
  if (data?.site_id) revalidatePath(`/construction/permits/sites/${data.site_id}`)
}
