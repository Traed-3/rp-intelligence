// Quotes & Invoices, Inventory, DQF & Certs, Expenses.
// Billing, DQF and Expenses are office-only areas (see access.ts). Inventory is open to techs, but they get cost only:
// sell price and markup are left out for them exactly as the parts page hides them.

import { canSeeSellPrices } from '../access'
import { type ToolDef, out, term, num, today, addDays, siteVariants } from '../types'

const iso = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null)
const money = (v: unknown) => (v == null ? null : Math.round(Number(v) * 100) / 100)

export const officeTools: ToolDef[] = [
  // ── Quotes & Invoices ─────────────────────────────────────
  {
    name: 'find_quotes', area: 'billing',
    description: 'Find quotes and change orders by quote number, site number, or words in the description; optionally by status (draft, sent, approved, rejected). Shows totals.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, status: { type: 'string', enum: ['draft', 'sent', 'approved', 'rejected'] } } },
    async run(input, ctx) {
      const q = term(input.query)
      let query = ctx.admin.from('con_quotes')
        .select('id, quote_number, kind, site_number, store_label, project_description, status, department, final_total, nte_amount, proposal_date, sent_date, decision_date, valid_until, job_id')
        .eq('company_id', ctx.companyId)
      const forms = siteVariants(q)
      if (q) query = /\d/.test(q) && forms.length
        ? query.or(`quote_number.ilike.%${q}%,site_number.in.(${forms.map(f => `"${f}"`).join(',')}),work_order_number.ilike.%${q}%`)
        : query.or(`project_description.ilike.%${q}%,store_label.ilike.%${q}%,facility_address.ilike.%${q}%`)
      if (['draft', 'sent', 'approved', 'rejected'].includes(String(input.status))) query = query.eq('status', String(input.status))
      const { data } = await query.order('proposal_date', { ascending: false, nullsFirst: false }).limit(15)
      return out((data ?? []).map(d => ({ quote: d.quote_number, kind: d.kind, site: d.site_number, what: (d.project_description ?? '').slice(0, 140), status: d.status, department: d.department, total: money(d.final_total), nte: money(d.nte_amount), date: d.proposal_date, sent: d.sent_date, decided: d.decision_date, valid_until: d.valid_until, has_job: !!d.job_id, link: `/billing/quotes/${d.id}` })))
    },
  },
  {
    name: 'find_invoices', area: 'billing',
    description: 'Find invoices by invoice number, site number, PO / work order, or words; optionally by status (draft, sent, paid, overdue, void). Shows totals and sent / due / paid dates.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, status: { type: 'string', enum: ['draft', 'sent', 'paid', 'overdue', 'void'] } } },
    async run(input, ctx) {
      const q = term(input.query)
      let query = ctx.admin.from('con_invoices')
        .select('id, invoice_number, site_number, store_label, project_description, status, department, invoice_grand_total, invoice_date, sent_date, due_date, paid_date, po_number, portal_wo_number')
        .eq('company_id', ctx.companyId)
      const forms = siteVariants(q)
      if (q) query = /\d/.test(q) && forms.length
        ? query.or(`invoice_number.ilike.%${q}%,site_number.in.(${forms.map(f => `"${f}"`).join(',')}),po_number.ilike.%${q}%,portal_wo_number.ilike.%${q}%,work_order_number.ilike.%${q}%`)
        : query.or(`project_description.ilike.%${q}%,store_label.ilike.%${q}%`)
      if (['draft', 'sent', 'paid', 'overdue', 'void'].includes(String(input.status))) query = query.eq('status', String(input.status))
      const { data } = await query.order('invoice_date', { ascending: false, nullsFirst: false }).limit(15)
      return out((data ?? []).map(d => ({ invoice: d.invoice_number, site: d.site_number, what: (d.project_description ?? '').slice(0, 140), status: d.status, department: d.department, total: money(d.invoice_grand_total), date: d.invoice_date, sent: d.sent_date, due: d.due_date, paid: d.paid_date, po: d.po_number, wo: d.portal_wo_number, link: `/billing/invoices/${d.id}` })))
    },
  },
  {
    name: 'billing_summary', area: 'billing',
    description: 'Quotes & Invoices at a glance, the same numbers as the Quotes & Invoices page: quotes still in draft or sent and waiting on a decision, draft invoices not sent yet, and what has been invoiced this year (construction and service).',
    input_schema: { type: 'object', properties: {} },
    async run(_input, ctx) {
      const year = today().slice(0, 4)
      const [quotes, drafts, invoiced] = await Promise.all([
        ctx.admin.from('con_quotes').select('status, final_total').eq('company_id', ctx.companyId).in('status', ['draft', 'sent']).limit(2000),
        ctx.admin.from('con_invoices').select('id', { count: 'exact', head: true }).eq('company_id', ctx.companyId).eq('status', 'draft'),
        ctx.admin.from('con_invoices').select('invoice_grand_total, department').eq('company_id', ctx.companyId).neq('status', 'draft').neq('status', 'void').gte('invoice_date', `${year}-01-01`).limit(5000),
      ])
      const sum = (rows: { [k: string]: unknown }[], col: string) => money(rows.reduce((s, r) => s + Number(r[col] ?? 0), 0))
      const q = quotes.data ?? [], inv = invoiced.data ?? []
      return out({
        quotes_draft: q.filter(x => x.status === 'draft').length,
        quotes_sent_waiting: q.filter(x => x.status === 'sent').length, quotes_sent_value: sum(q.filter(x => x.status === 'sent'), 'final_total'),
        invoices_draft: drafts.count ?? 0,
        invoiced_this_year: inv.length, invoiced_this_year_value: sum(inv, 'invoice_grand_total'),
        invoiced_this_year_service: sum(inv.filter(i => i.department === 'service'), 'invoice_grand_total'),
        note: 'The app does not track which invoices have been paid (older imported invoices all show "sent"), so do not report an unpaid total.',
      })
    },
  },

  // ── Inventory ─────────────────────────────────────────────
  {
    name: 'find_part', area: 'inventory',
    description: 'Look up a part in the catalog by part number, description or manufacturer: cost, where the cost came from and when, and how many are on hand at each location (shop, trucks).',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async run(input, ctx) {
      const q = term(input.query, 50)
      if (!q) return 'Give me a part number or a few words.'
      const words = q.split(' ').filter(Boolean).slice(0, 4)
      let query = ctx.admin.from('parts')
        .select('id, part_number, sku, manufacturer, description, uom, unit_cost, cost_vendor, cost_date, price_status, sell_price, markup_pct, primary_vendor')
        .eq('company_id', ctx.companyId).eq('active', true)
      query = words.length > 1
        ? words.reduce((acc, w) => acc.ilike('description', `%${w}%`), query)
        : query.or(`part_number.ilike.%${q}%,sku.ilike.%${q}%,description.ilike.%${q}%,manufacturer.ilike.%${q}%`)
      const { data } = await query.limit(10)
      const ids = (data ?? []).map(p => p.id)
      const { data: stock } = ids.length
        ? await ctx.admin.from('stock_on_hand').select('part_id, location_name, on_hand').eq('company_id', ctx.companyId).in('part_id', ids).gt('on_hand', 0)
        : { data: [] as any[] }
      const sell = canSeeSellPrices(ctx)
      return out((data ?? []).map(p => ({
        part_number: p.part_number, manufacturer: p.manufacturer, description: p.description, uom: p.uom,
        cost: money(p.unit_cost), cost_from: p.cost_vendor, cost_date: p.cost_date, price_status: p.price_status, vendor: p.primary_vendor,
        ...(sell ? { sell_price: money(p.sell_price), markup_pct: p.markup_pct } : {}),
        on_hand: (stock ?? []).filter((s: any) => s.part_id === p.id).map((s: any) => `${s.on_hand} at ${s.location_name}`),
        link: `/inventory/parts/${p.id}`,
      })))
    },
  },
  {
    name: 'stock_below_min', area: 'inventory',
    description: 'Parts that are below their minimum stock level, by location (shop shelf or a truck).',
    input_schema: { type: 'object', properties: { location: { type: 'string', description: 'Part of a location name, e.g. "Office", a truck number. Leave out for all.' } } },
    async run(input, ctx) {
      let q = ctx.admin.from('stock_on_hand').select('location_name, part_number, description, on_hand, min_qty, max_qty').eq('company_id', ctx.companyId).eq('below_min', true)
      const loc = term(input.location, 30)
      if (loc) q = q.ilike('location_name', `%${loc}%`)
      const { data } = await q.order('location_name').limit(60)
      return out(data ?? [])
    },
  },

  // ── DQF & Certs ───────────────────────────────────────────
  {
    name: 'dqf_attention', area: 'compliance',
    description: 'Driver files and certifications that need attention: items expired or expiring soon, and required items still missing, for active employees.',
    input_schema: { type: 'object', properties: { within_days: { type: 'number', description: 'Look ahead this many days. Default 30.' } } },
    async run(input, ctx) {
      const until = addDays(today(), num(input.within_days, 30, 0, 365))
      const { data } = await ctx.admin.from('hr_employee_items')
        .select('status, expiration_date, hr_employees!inner(full_name, is_active, is_dot_driver), hr_requirement_types!inner(name, category, is_active)')
        .eq('company_id', ctx.companyId).eq('hr_employees.is_active', true).eq('hr_requirement_types.is_active', true)
        .or(`expiration_date.lte.${until},status.eq.missing`).limit(400)
      const rows = (data ?? []).filter((r: any) => r.status !== 'not_required').map((r: any) => ({
        person: r.hr_employees.full_name, dot_driver: r.hr_employees.is_dot_driver, item: r.hr_requirement_types.name, kind: r.hr_requirement_types.category,
        status: r.status === 'missing' ? 'missing' : r.expiration_date < today() ? 'expired' : 'expiring', expires: r.expiration_date,
      }))
      rows.sort((a, b) => (a.status === b.status ? (a.expires ?? '').localeCompare(b.expires ?? '') : ['expired', 'missing', 'expiring'].indexOf(a.status) - ['expired', 'missing', 'expiring'].indexOf(b.status)))
      return out({ looked_through: until, items: rows.slice(0, 60), more: Math.max(0, rows.length - 60), note: 'Required DOT items that were never started may not show here; the DOT audit page (/compliance/audit) lists every gap.' })
    },
  },
  {
    name: 'employee_file', area: 'compliance',
    description: "One employee's DQF / certification file: each item, its status and expiration date.",
    input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    async run(input, ctx) {
      const name = term(input.name, 40)
      const { data: people } = await ctx.admin.from('hr_employees').select('id, full_name, department, job_title, hire_date, is_dot_driver, is_active')
        .eq('company_id', ctx.companyId).ilike('full_name', `%${name}%`).limit(5)
      if (!people?.length) return `No employee file matches "${name}".`
      if (people.length > 1) return `Several people match "${name}": ${people.map(p => p.full_name).join(', ')}. Ask which one.`
      const p = people[0]
      const { data: items } = await ctx.admin.from('hr_employee_items').select('status, issued_date, expiration_date, hr_requirement_types(name, category)')
        .eq('company_id', ctx.companyId).eq('employee_id', p.id).limit(80)
      return out({ ...p, link: `/compliance/employees/${p.id}`, items: (items ?? []).map((i: any) => ({ item: i.hr_requirement_types?.name, kind: i.hr_requirement_types?.category, status: i.status, issued: i.issued_date, expires: i.expiration_date })) })
    },
  },

  // ── Expenses ──────────────────────────────────────────────
  {
    name: 'find_expenses', area: 'expenses',
    description: 'Search expenses / receipts by vendor, site or job number, truck, person or description, within a date range. Gives the list and the total.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } } },
    async run(input, ctx) {
      const q = term(input.query)
      const from = iso(input.from) ?? addDays(today(), -30)
      const to = iso(input.to) ?? today()
      let query = ctx.admin.from('expenses')
        .select('id, expense_date, amount, vendor, description, expense_type, store_number, project_number, payment_method_code, submitter_name, assets(unit_number)')
        .eq('company_id', ctx.companyId).gte('expense_date', from).lte('expense_date', to)
      if (q) query = query.or(`vendor.ilike.%${q}%,description.ilike.%${q}%,store_number.ilike.%${q}%,project_number.ilike.%${q}%,submitter_name.ilike.%${q}%`)
      const { data } = await query.order('expense_date', { ascending: false }).limit(200)
      const rows = data ?? []
      return out({
        from, to, count: rows.length, total: money(rows.reduce((s, r) => s + Number(r.amount ?? 0), 0)),
        expenses: rows.slice(0, 25).map((e: any) => ({ date: e.expense_date, amount: money(e.amount), vendor: e.vendor, what: (e.description ?? '').slice(0, 100), charged_to: e.assets?.unit_number || e.store_number || e.project_number || e.expense_type, paid_with: e.payment_method_code, by: e.submitter_name, link: `/expenses/${e.id}` })),
        note: rows.length === 200 ? 'Only the newest 200 were counted; narrow the dates for an exact total.' : undefined,
      })
    },
  },
]
