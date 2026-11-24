// Service Dispatch: the service calls (svc_work_orders, synced from rpdispatcher + rpinvoicing) and the
// tickets the techs email in (svc_work_order_documents, the "All tickets" log).

import { canSeeSellPrices } from '../access'
import { type AssistantCtx, type ToolDef, out, str, term, num, today, addDays, siteVariants } from '../types'

const OPEN_STATUSES = ['dispatched', 'new', 'on_site', 'in_progress', 'waiting_parts', 'rtn_needed']

const callRow = (w: any, ctx: AssistantCtx) => ({
  wo: w.portal_wo_number, incident: w.incident_number || null, client: w.client_name, site: w.site_number,
  place: [w.site_city, w.site_state].filter(Boolean).join(', ') || null, status: w.status, priority: w.priority_raw,
  problem: (w.subject_raw || w.description || '').slice(0, 160), tech: w.svc_technicians?.full_name ?? null,
  dispatched: w.dispatched_at?.slice(0, 10) ?? null, last_update: w.last_update_at?.slice(0, 10) ?? null,
  completed: w.completed_at?.slice(0, 10) ?? null,
  return_trip: w.return_trip_needed ? (w.return_trip_reason || 'yes') : null,
  ...(canSeeSellPrices(ctx) ? { invoiced: w.invoiced, invoice_number: w.invoice_number || null, invoice_rejected: w.invoice_rejected ? (w.invoice_rejection_reason || 'yes') : null } : {}),
  link: `/service/${w.id}`,
})

/** A one-line version of a call for the summary lists. */
const brief = (w: any) => ({ wo: w.portal_wo_number, site: w.site_number, client: w.client_name, status: w.status, tech: w.svc_technicians?.full_name ?? null, last_update: (w.last_update_at ?? w.dispatched_at)?.slice(0, 10) ?? null, link: `/service/${w.id}` })

const CALL_COLS = 'id, portal_wo_number, incident_number, client_name, site_number, site_city, site_state, status, priority_raw, subject_raw, description, dispatched_at, last_update_at, completed_at, return_trip_needed, return_trip_reason, invoiced, invoice_number, invoice_rejected, invoice_rejection_reason, archived, svc_technicians!svc_work_orders_assigned_technician_id_fkey(full_name)'

export const serviceTools: ToolDef[] = [
  {
    name: 'find_service_calls', area: 'service',
    description: 'Find service calls (7-Eleven / Sunoco / Wawa / Global dispatches) by site number, work order #, incident #, tech name or problem words. Open calls first.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, include_closed: { type: 'boolean', description: 'Also show completed / invoiced calls. Default false.' } }, required: ['query'] },
    async run(input, ctx) {
      const q = term(input.query)
      if (!q) return 'Give me a site number, work order, tech or a few words.'
      const forms = siteVariants(q)
      let query = ctx.admin.from('svc_work_orders').select(CALL_COLS).eq('company_id', ctx.companyId)
      query = forms.length && /\d/.test(q)
        ? query.or(`site_number.in.(${forms.map(f => `"${f}"`).join(',')}),portal_wo_number.ilike.%${q}%,incident_number.ilike.%${q}%`)
        : query.or(`subject_raw.ilike.%${q}%,description.ilike.%${q}%,site_name.ilike.%${q}%,client_name.ilike.%${q}%`)
      if (input.include_closed !== true) query = query.eq('archived', false).in('status', OPEN_STATUSES)
      let { data } = await query.order('dispatched_at', { ascending: false, nullsFirst: false }).limit(15)
      if (!data?.length && !/\d/.test(q)) {
        // Maybe a tech's name.
        const { data: techs } = await ctx.admin.from('svc_technicians').select('id').eq('company_id', ctx.companyId).ilike('full_name', `%${q}%`).limit(5)
        if (techs?.length) {
          let byTech = ctx.admin.from('svc_work_orders').select(CALL_COLS).eq('company_id', ctx.companyId).in('assigned_technician_id', techs.map(t => t.id))
          if (input.include_closed !== true) byTech = byTech.eq('archived', false).in('status', OPEN_STATUSES)
          data = (await byTech.order('dispatched_at', { ascending: false, nullsFirst: false }).limit(15)).data
        }
      }
      return out((data ?? []).map(w => callRow(w, ctx)))
    },
  },
  {
    name: 'service_summary', area: 'service',
    description: 'The Service Dispatch board at a glance: open calls by status, calls needing a return trip, calls with no update in a week, and (for office roles) rejected invoices.',
    input_schema: { type: 'object', properties: {} },
    async run(_input, ctx) {
      const base = () => ctx.admin.from('svc_work_orders').select(CALL_COLS).eq('company_id', ctx.companyId).eq('archived', false)
      const stale = addDays(today(), -7)
      const [open, rtn, rejected] = await Promise.all([
        base().in('status', OPEN_STATUSES).limit(500),
        base().eq('return_trip_needed', true).not('status', 'in', '(completed,invoiced,paid)').order('last_update_at', { ascending: true, nullsFirst: true }).limit(100),
        canSeeSellPrices(ctx) ? base().eq('invoice_rejected', true).limit(20) : Promise.resolve({ data: [] as any[] }),
      ])
      const byStatus: Record<string, number> = {}
      for (const w of open.data ?? []) byStatus[w.status] = (byStatus[w.status] ?? 0) + 1
      const quiet = (open.data ?? []).filter(w => (w.last_update_at ?? w.dispatched_at ?? '').slice(0, 10) < stale)
        .sort((a, b) => (a.last_update_at ?? a.dispatched_at ?? '').localeCompare(b.last_update_at ?? b.dispatched_at ?? ''))
      return out({
        open_calls: open.data?.length ?? 0, by_status: byStatus,
        return_trips_count: rtn.data?.length ?? 0, return_trips: (rtn.data ?? []).slice(0, 12).map(brief),
        no_update_7_days_count: quiet.length, no_update_7_days: quiet.slice(0, 12).map(brief),
        ...(canSeeSellPrices(ctx) ? { rejected_invoices: (rejected.data ?? []).slice(0, 10).map(w => ({ ...brief(w), reason: w.invoice_rejection_reason || null })) } : {}),
        note: 'Lists are the oldest few of each; use find_service_calls for a site or tech.',
      })
    },
  },
  {
    name: 'service_tickets_sent_in', area: 'service',
    description: 'Tickets the techs emailed in (the "All tickets" log): by site number, tech name, or date range (the day the ticket was emailed in; default the last 7 days). Shows the work date, tech, on-site hours, whether it was complete or needs a return trip, and the parts written on the back.',
    input_schema: { type: 'object', properties: { site_number: { type: 'string' }, technician: { type: 'string' }, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, limit: { type: 'number' } } },
    async run(input, ctx) {
      const iso = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null)
      let q = ctx.admin.from('svc_work_order_documents')
        .select('id, ticket_site, ticket_wo_number, work_date, technician, helper, truck, onsite_hours, crew_size, completion, rtn_needed, parts, received_at, extract_status, svc_work_orders(portal_wo_number, status)')
        .eq('company_id', ctx.companyId).is('duplicate_of', null)
      const forms = siteVariants(input.site_number)
      if (forms.length) {
        // A ticket not read yet has no site of its own; its service call still knows the site.
        const { data: calls } = await ctx.admin.from('svc_work_orders').select('id').eq('company_id', ctx.companyId).in('site_number', forms).limit(200)
        const ids = (calls ?? []).map(c => c.id)
        const siteList = forms.map(f => `"${f}"`).join(',')
        q = q.or(ids.length ? `ticket_site.in.(${siteList}),work_order_id.in.(${ids.join(',')})` : `ticket_site.in.(${siteList})`)
      }
      const tech = term(input.technician, 30)
      if (tech) q = q.or(`technician.ilike.%${tech}%,helper.ilike.%${tech}%`)
      const from = iso(input.from), to = iso(input.to)
      // Many tickets have no work date read off them yet, so the range goes by the day the email came in.
      if (from) q = q.gte('received_at', `${from}T00:00:00-05:00`)
      if (to) q = q.lte('received_at', `${to}T23:59:59-05:00`)
      if (!forms.length && !tech && !from && !to) q = q.gte('received_at', `${addDays(today(), -7)}T00:00:00-05:00`)
      const { data } = await q.order('received_at', { ascending: false }).limit(num(input.limit, 15, 1, 40))
      return out((data ?? []).map((d: any) => ({
        site: d.ticket_site, wo: d.ticket_wo_number || d.svc_work_orders?.portal_wo_number || null, call_status: d.svc_work_orders?.status ?? null,
        work_date: d.work_date, emailed: d.received_at?.slice(0, 10) ?? null, read: d.extract_status === "done" ? undefined : "not read yet", tech: d.technician, helper: d.helper, truck: d.truck, onsite_hours: d.onsite_hours, crew: d.crew_size,
        completion: d.completion, rtn_needed: d.rtn_needed || null,
        parts: Array.isArray(d.parts) ? d.parts.slice(0, 12).map((p: any) => [p.qty, p.description, p.part_number].filter(Boolean).join(' ')) : [],
        link: `/service/tickets/inbox/${d.id}`,
      })))
    },
  },
  {
    name: 'get_service_call', area: 'service',
    description: 'One service call in full by work order # (or site number for its newest open call): the dispatch text, tech, timeline, return-trip reason and every ticket sent in for it.',
    input_schema: { type: 'object', properties: { wo_or_site: { type: 'string' } }, required: ['wo_or_site'] },
    async run(input, ctx) {
      const q = term(input.wo_or_site, 30)
      let { data: call } = await ctx.admin.from('svc_work_orders').select(CALL_COLS + ', completion_note_raw, notes').eq('company_id', ctx.companyId).ilike('portal_wo_number', q).maybeSingle()
      if (!call) {
        const forms = siteVariants(q)
        const r = forms.length ? await ctx.admin.from('svc_work_orders').select(CALL_COLS + ', completion_note_raw, notes').eq('company_id', ctx.companyId).in('site_number', forms).order('dispatched_at', { ascending: false, nullsFirst: false }).limit(1) : { data: [] }
        call = (r.data ?? [])[0] ?? null
      }
      if (!call) return `No service call found for "${str(input.wo_or_site, 30)}".`
      const c = call as any
      const { data: docs } = await ctx.admin.from('svc_work_order_documents')
        .select('id, work_date, technician, onsite_hours, completion, rtn_needed, parts, front_text')
        .eq('company_id', ctx.companyId).eq('work_order_id', c.id).is('duplicate_of', null).order('work_date', { ascending: false, nullsFirst: false }).limit(8)
      return out({
        ...callRow(c, ctx), description: (c.description ?? '').slice(0, 600), completion_note: (c.completion_note_raw ?? '').slice(0, 400), notes: (c.notes ?? '').slice(0, 300),
        tickets: (docs ?? []).map((d: any) => ({ work_date: d.work_date, tech: d.technician, onsite_hours: d.onsite_hours, completion: d.completion, rtn_needed: d.rtn_needed || null, front: (d.front_text ?? '').slice(0, 300), parts: Array.isArray(d.parts) ? d.parts.length : 0, link: `/service/tickets/inbox/${d.id}` })),
      })
    },
  },
]
