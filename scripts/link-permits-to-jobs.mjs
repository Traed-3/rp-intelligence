#!/usr/bin/env node
/**
 * Backfill job_id on every existing con_permit_projects row that doesn't
 * have one yet — "if we have a permit, it's a project" applied to the
 * backlog that existed before permits_jobs_link.sql. Same rule as
 * lib/permit-job-link.ts (reimplemented here in plain JS, matching how the
 * other one-time scripts in this repo do it rather than importing TS):
 *   0 open jobs at the site  -> create one (stage: 'permitting')
 *   1 open job at the site   -> link it
 *   2+ open jobs at the site -> flag as ambiguous, skip (needs a human pick
 *                               on the site's permit page)
 *
 *   node scripts/link-permits-to-jobs.mjs            # dry run
 *   node scripts/link-permits-to-jobs.mjs --apply    # write
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n').map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const APPLY = process.argv.includes('--apply')

async function main() {
  const { data: projects } = await sb.from('con_permit_projects')
    .select('id, company_id, site_id, project_type, job_id')
    .is('job_id', null)
  if (!projects?.length) { console.log('Nothing to link — every permit project already has a job.'); return }

  console.log(`${projects.length} permit project(s) with no job_id.\n`)

  let created = 0, linked = 0, ambiguous = 0, noSite = 0, errors = 0

  for (const proj of projects) {
    const { data: site } = await sb.from('con_permit_sites')
      .select('id, site_number, address, city, state, brand').eq('id', proj.site_id).single()
    if (!site?.site_number) { console.log(`  [skip] project ${proj.id}: site has no site_number`); noSite++; continue }

    const { data: openJobs } = await sb.from('con_jobs')
      .select('id, job_number, stage')
      .eq('company_id', proj.company_id).eq('site_number', site.site_number).neq('stage', 'complete')

    if (openJobs && openJobs.length === 1) {
      console.log(`${site.site_number} (${proj.project_type}): -> link to job ${openJobs[0].job_number ?? openJobs[0].id} [${openJobs[0].stage}]`)
      if (APPLY) {
        const { error } = await sb.from('con_permit_projects').update({ job_id: openJobs[0].id }).eq('id', proj.id)
        if (error) { console.log(`    ERROR: ${error.message}`); errors++; continue }
      }
      linked++
    } else if (openJobs && openJobs.length > 1) {
      console.log(`${site.site_number} (${proj.project_type}): AMBIGUOUS — ${openJobs.length} open jobs (${openJobs.map(j => j.job_number ?? j.id).join(', ')}) — resolve on the site's permit page`)
      ambiguous++
    } else {
      const facilityAddress = [site.address, site.city, site.state].filter(Boolean).join(', ') || null
      console.log(`${site.site_number} (${proj.project_type}): -> create new job at stage 'permitting'`)
      if (APPLY) {
        const { data: job, error } = await sb.from('con_jobs').insert({
          company_id: proj.company_id, site_number: site.site_number, stage: 'permitting',
          facility_address: facilityAddress, gas_brand: site.brand ?? null,
          notes: `Started from permit project — ${proj.project_type}`,
        }).select('id').single()
        if (error || !job) { console.log(`    ERROR: ${error?.message ?? 'insert failed'}`); errors++; continue }
        const { error: linkErr } = await sb.from('con_permit_projects').update({ job_id: job.id }).eq('id', proj.id)
        if (linkErr) { console.log(`    ERROR linking: ${linkErr.message}`); errors++; continue }
      }
      created++
    }
  }

  console.log(`\n${linked} linked, ${created} new jobs created, ${ambiguous} ambiguous (needs a human pick), ${noSite} skipped (no site number), ${errors} error(s).`)
  if (!APPLY) console.log('Dry run only. Re-run with --apply to write these changes.')
}

main()
