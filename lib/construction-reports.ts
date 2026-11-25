import { createAdminClient } from '@/lib/supabase/admin'
import { loadAllJobCosts, allRows } from '@/lib/job-costs'

type Admin = ReturnType<typeof createAdminClient>

export type JobCostRow = {
  jobId: string
  site: string
  customer: string
  program: string
  stage: string
  quoted: number
  invoiced: number
  materialCost: number
  laborCost: number
  margin: number
  marginPct: number | null
}

const num = (v: any) => (typeof v === 'number' ? v : Number(v) || 0)

/**
 * Per-job cost rows (quoted vs invoiced vs cost + margin). Costs come from lib/job-costs.ts, the same rules as
 * the job's Cost Summary tab: materialCost = material purchases + other job expenses, laborCost = man-hours x rate.
 */
export async function jobCostRows(admin: Admin, companyId: string): Promise<JobCostRow[]> {
  // Read page by page: the database hands back at most 1,000 rows per request whatever limit is asked for, and
  // there are more jobs than that, so a single request silently dropped a third of them from this report.
  type JobRow = { id: string; site_number: string | null; po_number: string | null; gas_brand: string | null; program: string | null; stage: string; con_customers: { name: string | null } | null }
  const [jobs, quotes, invoices] = await Promise.all([
    allRows<JobRow>((f, t) => admin.from('con_jobs').select('id, site_number, po_number, gas_brand, program, stage, con_customers(name)').eq('company_id', companyId).order('id').range(f, t)),
    allRows<{ job_id: string | null; final_total: number | null }>((f, t) => admin.from('con_quotes').select('job_id, final_total').eq('company_id', companyId).order('id').range(f, t)),
    allRows<{ id: string; job_id: string | null; invoice_grand_total: number | null }>((f, t) => admin.from('con_invoices').select('id, job_id, invoice_grand_total').eq('company_id', companyId).order('id').range(f, t)),
  ])

  const costs = await loadAllJobCosts(admin, companyId, (jobs ?? []).map(j => ({
    id: j.id, site_number: j.site_number, po_number: j.po_number, gas_brand: j.gas_brand, customer: (j as any).con_customers?.name ?? null,
  })))
  const sumByJob = (rows: { job_id: string | null }[] | null, value: (r: any) => number) => {
    const m = new Map<string, number>()
    for (const r of rows ?? []) if (r.job_id) m.set(r.job_id, (m.get(r.job_id) ?? 0) + value(r))
    return m
  }
  const quotedBy = sumByJob(quotes, q => num(q.final_total))
  const invoicedBy = sumByJob(invoices, i => num(i.invoice_grand_total))

  const rows: JobCostRow[] = (jobs ?? []).map(j => {
    const quoted = quotedBy.get(j.id) ?? 0
    const invoiced = invoicedBy.get(j.id) ?? 0
    const c = costs.get(j.id)
    const materialCost = (c?.materialCost ?? 0) + (c?.otherCost ?? 0)
    const laborCost = c?.laborCost ?? 0
    const margin = invoiced - (materialCost + laborCost)
    return {
      jobId: j.id,
      site: j.site_number ?? '—',
      customer: (j as any).con_customers?.name ?? '',
      program: j.program ?? '',
      stage: j.stage,
      quoted, invoiced, materialCost, laborCost, margin,
      marginPct: invoiced > 0 ? (margin / invoiced) * 100 : null,
    }
  })

  return rows
}

export function sumBy<T extends string>(rows: JobCostRow[], key: 'customer' | 'program') {
  const map = new Map<string, { quoted: number; invoiced: number; cost: number; margin: number }>()
  for (const r of rows) {
    const k = (r[key] || '—') as T
    const cur = map.get(k) ?? { quoted: 0, invoiced: 0, cost: 0, margin: 0 }
    cur.quoted += r.quoted
    cur.invoiced += r.invoiced
    cur.cost += r.materialCost + r.laborCost
    cur.margin += r.margin
    map.set(k, cur)
  }
  return Array.from(map.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.invoiced - a.invoiced)
}
