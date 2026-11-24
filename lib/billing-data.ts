import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

/** Pick-lists every builder page needs: customers (with brand/rate card), jobs, rate cards. */
export type TeamMember = { id: string; full_name: string; job_title: string | null; role: string }

/** A rate-card item the builder offers as a one-click chip (parts.quick_pick). */
export type QuickPick = { id: string; part_number: string | null; description: string; category: number; subcategory: string | null; item_type: string | null; uom: string | null; unit_cost: number | null; freight_per_unit: number | null; cost_source: string | null; cost_vendor: string | null; cost_date: string | null; price_status: string | null; taxable: boolean | null }

export async function loadBuilderLists(admin: Admin, company_id: string) {
  const [{ data: customers }, { data: jobs }, { data: rateCards }, { data: team }, { data: quick }] = await Promise.all([
    admin.from('con_customers').select('id, name, brand, rate_card_id').eq('company_id', company_id).order('name'),
    admin.from('con_jobs').select('id, site_number, work_order_number').eq('company_id', company_id).order('created_at', { ascending: false }).limit(300),
    admin.from('billing_rate_cards').select('id, name, labor_rate, sales_tax_pct').eq('company_id', company_id).order('name'),
    admin.from('profiles').select('id, full_name, job_title, role').eq('company_id', company_id).eq('is_active', true).order('full_name'),
    admin.from('parts').select('id, part_number, description, category, subcategory, item_type, uom, unit_cost, freight_per_unit, cost_source, cost_vendor, cost_date, price_status, taxable').eq('company_id', company_id).eq('active', true).eq('quick_pick', true).order('subcategory').order('description'),
  ])
  const quickPicks = (quick ?? []).map(q => ({ ...q, unit_cost: q.unit_cost != null ? Number(q.unit_cost) : null, freight_per_unit: q.freight_per_unit != null ? Number(q.freight_per_unit) : null })) as QuickPick[]
  return { quickPicks, team: (team ?? []) as TeamMember[], customers: customers ?? [], jobs: jobs ?? [], rateCards: (rateCards ?? []).map(r => ({ ...r, labor_rate: Number(r.labor_rate), sales_tax_pct: r.sales_tax_pct != null ? Number(r.sales_tax_pct) : null })) }
}

/** One quote or invoice with its lines and customer, scoped to the company. */
export async function loadDoc(admin: Admin, kind: 'quote' | 'invoice', id: string, company_id: string) {
  const table = kind === 'quote' ? 'con_quotes' : 'con_invoices'
  const lineTable = kind === 'quote' ? 'con_quote_line_items' : 'con_invoice_line_items'
  const fk = kind === 'quote' ? 'quote_id' : 'invoice_id'
  const { data: row } = await admin.from(table).select('*, con_customers(id, name, billing_address, email, billing_contact)').eq('id', id).eq('company_id', company_id).maybeSingle()
  if (!row) return null
  const { data: lines } = await admin.from(lineTable).select('*').eq(fk, id).order('sort_order', { nullsFirst: false }).order('section').order('line_no')
  return { row: row as Record<string, unknown> & { con_customers: { id: string; name: string; billing_address: string | null; email: string | null; billing_contact: string | null } | null }, lines: (lines ?? []) as Record<string, unknown>[] }
}
