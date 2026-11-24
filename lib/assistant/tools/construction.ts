// Construction (jobs, schedule, permits, daily updates, contacts) and Site Lookup.
// Nothing here returns a price: what we charge lives in Quotes & Invoices (tools/billing.ts), behind its own check.

import { CON_STAGES, stageMeta } from '@/lib/construction'
import { permitBucket, PERMIT_BUCKETS, type PermitBucket } from '@/lib/permits'
import { type AssistantCtx, type ToolDef, out, str, term, today, addDays, siteVariants } from '../types'

const STAGE_VALUES = CON_STAGES.map(s => s.value)
const stageLabel = (v: string | null) => (v ? stageMeta(v).label : null)

/** Jobs at a site, newest first. Site numbers are matched in all the ways people type them. */
async function jobsAtSite(ctx: AssistantCtx, site: unknown, limit = 10) {
  const forms = siteVariants(site)
  if (!forms.length) return []
  const { data } = await ctx.admin.from('con_jobs')
    .select('id, job_number, site_number, work_order_number, po_number, stage, status_detail, scope_of_work, gas_brand, program, priority, date_received, project_start_date')
    .eq('company_id', ctx.companyId).in('site_number', forms).order('date_received', { ascending: false, nullsFirst: false }).limit(limit)
  return data ?? []
}

const jobRow = (j: any) => ({
  job: j.job_number, site: j.site_number, stage: stageLabel(j.stage), detail: j.status_detail || null,
  scope: j.scope_of_work ? String(j.scope_of_work).slice(0, 160) : null, wo: j.work_order_number || null, po: j.po_number || null,
  received: j.date_received, start: j.project_start_date, priority: j.priority, link: `/construction/jobs/${j.id}`,
})

export const constructionTools: ToolDef[] = [
  {
    name: 'find_jobs', area: 'construction',
    description: 'Find construction jobs by site/store number (e.g. 34006, SU-5015), job number, work order #, PO #, or words in the scope. Returns stage and dates.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, include_complete: { type: 'boolean', description: 'Also show finished jobs. Default false.' } }, required: ['query'] },
    async run(input, ctx) {
      const q = term(input.query)
      if (!q) return 'Give me a site number, job number, work order or a few words from the scope.'
      let rows: any[] = await jobsAtSite(ctx, q, 15)
      if (!rows.length) {
        const { data } = await ctx.admin.from('con_jobs')
          .select('id, job_number, site_number, work_order_number, po_number, stage, status_detail, scope_of_work, gas_brand, program, priority, date_received, project_start_date')
          .eq('company_id', ctx.companyId)
          .or(`job_number.ilike.%${q}%,work_order_number.ilike.%${q}%,po_number.ilike.%${q}%,scope_of_work.ilike.%${q}%,facility_address.ilike.%${q}%`)
          .order('date_received', { ascending: false, nullsFirst: false }).limit(15)
        rows = data ?? []
      }
      if (input.include_complete !== true) {
        const open = rows.filter(r => r.stage !== 'complete')
        if (open.length) rows = open
      }
      return out(rows.map(jobRow))
    },
  },
  {
    name: 'get_job', area: 'construction',
    description: 'Everything about one construction job: stage, scope, dates, manager, permits, the last daily updates, scheduled days and open My Plate tasks tied to it. Pass the site number or job number; use the page the person is on when they say "this job".',
    input_schema: { type: 'object', properties: { site_or_job: { type: 'string' } }, required: ['site_or_job'] },
    async run(input, ctx) {
      const q = term(input.site_or_job, 30)
      let job: any = (await jobsAtSite(ctx, q, 5)).find(j => j.stage !== 'complete') ?? (await jobsAtSite(ctx, q, 1))[0]
      if (!job) {
        const { data } = await ctx.admin.from('con_jobs').select('id').eq('company_id', ctx.companyId).ilike('job_number', q).maybeSingle()
        if (data) job = data
      }
      if (!job) return `No construction job found for "${q}".`
      const { data: full } = await ctx.admin.from('con_jobs')
        .select('*, profiles!con_jobs_assigned_manager_id_fkey(full_name), con_customers(name)')
        .eq('id', job.id).eq('company_id', ctx.companyId).single()
      if (!full) return `No construction job found for "${q}".`
      const [updates, schedule, permitProjects, tasks, docs] = await Promise.all([
        ctx.admin.from('con_daily_updates').select('work_date, work_description, notes').eq('company_id', ctx.companyId).eq('job_id', job.id).order('work_date', { ascending: false }).limit(5),
        ctx.admin.from('con_schedule_entries').select('schedule_date, task_description, crew, equipment').eq('company_id', ctx.companyId).eq('job_id', job.id).order('schedule_date', { ascending: false }).limit(8),
        ctx.admin.from('con_permit_projects').select('id').eq('company_id', ctx.companyId).eq('job_id', job.id),
        ctx.admin.from('con_tasks').select('title, status, due_date, profiles!con_tasks_owner_id_fkey(full_name)').eq('company_id', ctx.companyId).eq('job_id', job.id).in('status', ['open', 'waiting']).limit(10),
        ctx.admin.from('con_documents').select('id', { count: 'exact', head: true }).eq('company_id', ctx.companyId).eq('job_id', job.id),
      ])
      const projectIds = (permitProjects.data ?? []).map(p => p.id)
      const { data: permits } = projectIds.length
        ? await ctx.admin.from('con_permits').select('permit_type, status, permit_number, date_issued, inspection_date, pulled_by').eq('company_id', ctx.companyId).in('project_id', projectIds)
        : { data: [] as any[] }
      const f = full as any
      return out({
        ...jobRow(f), customer: f.con_customers?.name ?? null, brand: f.gas_brand, program: f.program, address: f.facility_address,
        manager: f.profiles?.full_name ?? null, notes: f.notes ? String(f.notes).slice(0, 400) : null,
        project_notification: f.notification_waived ? 'waived' : f.notification_sent_at ? `sent ${f.notification_sent_at}` : 'not sent',
        permits: permits ?? [], last_daily_updates: updates.data ?? [], schedule: schedule.data ?? [],
        open_tasks: (tasks.data ?? []).map((t: any) => ({ title: t.title, status: t.status, due: t.due_date, on: t.profiles?.full_name })),
        documents_on_file: docs.count ?? 0,
      })
    },
  },
  {
    name: 'jobs_by_stage', area: 'construction',
    description: 'How many open construction jobs are in each stage, or the list of jobs in one stage (e.g. "what needs scheduled", "what is waiting on material", "what needs invoiced").',
    input_schema: { type: 'object', properties: { stage: { type: 'string', enum: STAGE_VALUES as unknown as string[], description: 'Leave out for the count per stage.' } } },
    async run(input, ctx) {
      const stage = STAGE_VALUES.includes(String(input.stage) as any) ? String(input.stage) : null
      if (stage) {
        const { data } = await ctx.admin.from('con_jobs')
          .select('id, job_number, site_number, work_order_number, po_number, stage, status_detail, scope_of_work, gas_brand, program, priority, date_received, project_start_date')
          .eq('company_id', ctx.companyId).eq('stage', stage).order('date_received', { ascending: true, nullsFirst: false }).limit(40)
        return out({ stage: stageLabel(stage), count: data?.length ?? 0, jobs: (data ?? []).map(jobRow) })
      }
      const { data } = await ctx.admin.from('con_jobs').select('stage').eq('company_id', ctx.companyId).neq('stage', 'complete').limit(2000)
      const counts: Record<string, number> = {}
      for (const r of data ?? []) counts[stageLabel(r.stage) ?? r.stage] = (counts[stageLabel(r.stage) ?? r.stage] ?? 0) + 1
      return out({ open_jobs: data?.length ?? 0, by_stage: counts })
    },
  },
  {
    name: 'construction_schedule', area: 'construction',
    description: 'The construction crew schedule for a date range: which site, what work, which crew and equipment. Defaults to today through the next 7 days.',
    input_schema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, crew_member: { type: 'string', description: 'Only days this person is on.' } } },
    async run(input, ctx) {
      const iso = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null)
      const from = iso(input.from) ?? today()
      const to = iso(input.to) ?? addDays(from, 7)
      const { data } = await ctx.admin.from('con_schedule_entries')
        .select('schedule_date, site_number, task_description, crew, equipment, notes, entry_type')
        .eq('company_id', ctx.companyId).gte('schedule_date', from).lte('schedule_date', to)
        .order('schedule_date').order('sort_order', { nullsFirst: false }).limit(120)
      let rows = data ?? []
      const who = term(input.crew_member, 30).toLowerCase()
      if (who) rows = rows.filter(r => (r.crew ?? []).some((c: string) => c.toLowerCase().includes(who)))
      return out({ from, to, entries: rows.map(r => ({ date: r.schedule_date, site: r.site_number, work: r.task_description, crew: r.crew, equipment: r.equipment, notes: r.notes, type: r.entry_type })) })
    },
  },
  {
    name: 'permit_status', area: 'construction',
    description: 'Permits on the permit tracker, sorted into the same piles as the Permits page: "waiting" (not in hand yet), "inspection" (in hand, final inspection still owed), "complete". By site number, or every permit not yet complete. Shows type (electrical, building...), status, permit #, who pulls it, issue and inspection dates.',
    input_schema: { type: 'object', properties: { site_number: { type: 'string', description: 'Leave out for all permits not yet complete.' }, pile: { type: 'string', enum: ['waiting', 'inspection', 'complete'], description: 'Only this pile.' } } },
    async run(input, ctx) {
      let siteIds: string[] | null = null
      const forms = siteVariants(input.site_number)
      if (forms.length) {
        const { data: sites } = await ctx.admin.from('con_permit_sites').select('id').eq('company_id', ctx.companyId).in('site_number', forms)
        siteIds = (sites ?? []).map(s => s.id)
        if (!siteIds.length) return `No site ${str(input.site_number, 20)} on the permit tracker.`
      }
      let projects = ctx.admin.from('con_permit_projects').select('id, project_type, scope, scheduled_work_date, permit_due_date, con_permit_sites(site_number, city, state)').eq('company_id', ctx.companyId)
      if (siteIds) projects = projects.in('site_id', siteIds)
      const { data: proj } = await projects.limit(300)
      const byId = new Map((proj ?? []).map((p: any) => [p.id, p]))
      if (!byId.size) return out([])
      let permits = ctx.admin.from('con_permits')
        .select('project_id, permit_type, status, pulled_by, permit_number, date_submitted_to_jurisdiction, date_issued, inspection_date, notes')
        .eq('company_id', ctx.companyId).in('project_id', [...byId.keys()])
      const pile = PERMIT_BUCKETS.some(b => b.key === input.pile) ? (input.pile as PermitBucket) : null
      if (!siteIds && pile !== 'complete') permits = permits.neq('status', 'Complete')
      if (!siteIds) permits = permits.neq('requirement_status', 'Not Required')
      const { data } = await permits.limit(150)
      const rows = (data ?? []).filter((p: any) => !pile || permitBucket(p.status) === pile).slice(0, 80)
      return out(rows.map((p: any) => {
        const pr: any = byId.get(p.project_id)
        return { pile: PERMIT_BUCKETS.find(b => b.key === permitBucket(p.status))?.label, site: pr?.con_permit_sites?.site_number, place: [pr?.con_permit_sites?.city, pr?.con_permit_sites?.state].filter(Boolean).join(', '), project: pr?.project_type, work_date: pr?.scheduled_work_date, permit_due: pr?.permit_due_date, type: p.permit_type, status: p.status, pulled_by: p.pulled_by, number: p.permit_number, submitted: p.date_submitted_to_jurisdiction, issued: p.date_issued, inspection: p.inspection_date, notes: p.notes ? String(p.notes).slice(0, 160) : null }
      }))
    },
  },
  {
    name: 'find_contact', area: 'construction',
    description: 'Look up a customer contact, inspector, vendor or subcontractor (Hash, J&J...) by name, company or trade: phone, email, title.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async run(input, ctx) {
      const q = term(input.query, 40)
      if (!q) return 'Give me a name or company.'
      const [contacts, vendors, subs] = await Promise.all([
        ctx.admin.from('con_contacts').select('name, kind, title, employer, phone, mobile, email, city, state').eq('company_id', ctx.companyId).eq('is_active', true).or(`name.ilike.%${q}%,employer.ilike.%${q}%,title.ilike.%${q}%`).limit(10),
        ctx.admin.from('con_vendors').select('name, category, contact_name, phone, email').eq('company_id', ctx.companyId).eq('is_active', true).or(`name.ilike.%${q}%,contact_name.ilike.%${q}%,category.ilike.%${q}%`).limit(10),
        ctx.admin.from('con_subcontractors').select('name, trade, contact_name, phone, email').eq('company_id', ctx.companyId).eq('is_active', true).or(`name.ilike.%${q}%,contact_name.ilike.%${q}%,trade.ilike.%${q}%`).limit(10),
      ])
      return out({ contacts: contacts.data ?? [], vendors: vendors.data ?? [], subcontractors: subs.data ?? [] })
    },
  },
  {
    name: 'find_site', area: 'sites',
    description: 'Look up a store/site by number, street, city or brand (7-Eleven, Sunoco, Wawa, Sheetz...): address, brand, store phone and the equipment on file (dispensers, tanks, STPs, buckets).',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async run(input, ctx) {
      const q = term(input.query, 40)
      if (!q) return 'Give me a site number, street, city or brand.'
      const forms = siteVariants(q)
      const cols = 'site_number, store_brand, address, city, state, zip, dispenser_count, dispenser_type, tank_count, tank_type, stp_count, stp_type, fill_spill_bucket_count, fill_spill_bucket_type, vapor_bucket_count, vapor_bucket_type, notes'
      let { data } = await ctx.admin.from('con_sites').select(cols).eq('company_id', ctx.companyId).in('site_number', forms).limit(5)
      if (!data?.length) {
        const r = await ctx.admin.from('con_sites').select(cols).eq('company_id', ctx.companyId)
          .or(`site_number.ilike.%${q}%,address.ilike.%${q}%,city.ilike.%${q}%,store_brand.ilike.%${q}%`).order('site_number').limit(12)
        data = r.data
      }
      const nums = [...new Set((data ?? []).map(s => s.site_number))]
      const { data: phones } = nums.length
        ? await ctx.admin.from('con_permit_sites').select('site_number, store_phone').eq('company_id', ctx.companyId).in('site_number', nums)
        : { data: [] as any[] }
      const phone = new Map((phones ?? []).map((p: any) => [p.site_number, p.store_phone]))
      if (!data?.length) {
        const { data: permitSites } = await ctx.admin.from('con_permit_sites').select('site_number, brand, address, city, state, zip, store_phone')
          .eq('company_id', ctx.companyId).or(`site_number.ilike.%${q}%,address.ilike.%${q}%,city.ilike.%${q}%`).limit(10)
        return out(permitSites ?? [])
      }
      return out(data.map(s => ({ ...s, store_phone: phone.get(s.site_number) ?? null, notes: s.notes ? String(s.notes).slice(0, 200) : null })))
    },
  },
]
