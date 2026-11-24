// ── Permits ↔ Jobs: "if we have a permit, it's a project" ──────────────────
// Shared by the permits actions, the one-time link-backlog script, and the
// historical-permit-email backfill script, so all three agree on the rule:
//   0 open jobs at the site  -> auto-create one (stage: 'permitting')
//   1 open job at the site   -> auto-link, no prompt
//   2+ open jobs at the site -> too ambiguous to guess; caller must ask
import type { SupabaseClient } from '@supabase/supabase-js'

export type PermitSiteRow = {
  id: string
  site_number: string
  name: string | null
  address: string | null
  city: string | null
  state: string | null
}
export type PermitProjectRow = { id: string; project_type: string }

export type JobLinkResult =
  | { status: 'already_linked'; jobId: string }
  | { status: 'created'; jobId: string }
  | { status: 'linked'; jobId: string }
  | { status: 'ambiguous'; candidates: { id: string; job_number: string | null; stage: string }[] }
  | { status: 'no_site_number' }

/** Find (or create) the job a permit project belongs to, and write job_id. */
export async function findOrCreateJobForPermitSite(
  admin: SupabaseClient,
  companyId: string,
  site: PermitSiteRow,
  project: PermitProjectRow,
  opts: { forceCreate?: boolean } = {},
): Promise<JobLinkResult> {
  const { data: existingProject } = await admin.from('con_permit_projects')
    .select('job_id').eq('id', project.id).eq('company_id', companyId).single()
  if (existingProject?.job_id) return { status: 'already_linked', jobId: existingProject.job_id }

  if (!site.site_number) return { status: 'no_site_number' }

  if (!opts.forceCreate) {
    const { data: openJobs } = await admin.from('con_jobs')
      .select('id, job_number, stage')
      .eq('company_id', companyId).eq('site_number', site.site_number).neq('stage', 'complete')

    if (openJobs && openJobs.length === 1) {
      await admin.from('con_permit_projects').update({ job_id: openJobs[0].id }).eq('id', project.id).eq('company_id', companyId)
      return { status: 'linked', jobId: openJobs[0].id }
    }
    if (openJobs && openJobs.length > 1) {
      return { status: 'ambiguous', candidates: openJobs }
    }
  }

  const facilityAddress = [site.address, site.city, site.state].filter(Boolean).join(', ') || null
  const { data: job, error } = await admin.from('con_jobs').insert({
    company_id: companyId,
    site_number: site.site_number,
    stage: 'permitting',
    facility_address: facilityAddress,
    gas_brand: (site as { brand?: string | null }).brand ?? null,
    notes: `Started from permit project — ${project.project_type}`,
  }).select('id').single()
  if (error || !job) return { status: 'ambiguous', candidates: [] }

  await admin.from('con_permit_projects').update({ job_id: job.id }).eq('id', project.id).eq('company_id', companyId)
  return { status: 'created', jobId: job.id }
}

/** Link a permit project to a specific job the user picked (the ambiguous-case resolution). */
export async function linkProjectToChosenJob(
  admin: SupabaseClient, companyId: string, projectId: string, jobId: string,
): Promise<void> {
  await admin.from('con_permit_projects').update({ job_id: jobId }).eq('id', projectId).eq('company_id', companyId)
}
