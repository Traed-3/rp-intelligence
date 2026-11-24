import { createAdminClient } from '@/lib/supabase/admin'

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

/** Compute per-job cost rows (quoted vs invoiced vs material vs labor + margin). */
export async function jobCostRows(admin: Admin, companyId: string): Promise<JobCostRow[]> {
  const [{ data: jobs }, { data: quotes }, { data: invoices }, { data: materials }, { data: jobLabor }] = await Promise.all([
    // Explicit limit — an unfiltered select silently caps at Supabase's
    // default 1000 rows once completed jobs pile up, and this report needs
    // every job, complete ones included.
    admin.from('con_jobs').select('id, site_number, program, stage, con_customers(name)').eq('company_id', companyId).limit(5000),
    admin.from('con_quotes').select('job_id, final_total').eq('company_id', companyId),
    admin.from('con_invoices').select('id, job_id, invoice_grand_total').eq('company_id', companyId),
    admin.from('con_job_materials').select('job_id, quantity, unit_cost, status').eq('company_id', companyId),
    admin.from('con_job_labor').select('job_id, hours, labor_rate').eq('company_id', companyId),
  ])

  // invoice line-item labor, keyed back to job through the invoice → job map
  const invoiceJob = new Map<string, string | null>()
  for (const inv of invoices ?? []) invoiceJob.set(inv.id, inv.job_id)
  const invoiceIds = (invoices ?? []).map(i => i.id)
  const invLaborByJob = new Map<string, number>()
  if (invoiceIds.length) {
    const { data: liLabor } = await admin.from('con_invoice_line_items').select('invoice_id, total_labor').in('invoice_id', invoiceIds)
    for (const li of liLabor ?? []) {
      const jid = invoiceJob.get(li.invoice_id)
      if (jid) invLaborByJob.set(jid, (invLaborByJob.get(jid) ?? 0) + num(li.total_labor))
    }
  }

  const rows: JobCostRow[] = (jobs ?? []).map(j => {
    const quoted = (quotes ?? []).filter(q => q.job_id === j.id).reduce((a, q) => a + num(q.final_total), 0)
    const invoiced = (invoices ?? []).filter(i => i.job_id === j.id).reduce((a, i) => a + num(i.invoice_grand_total), 0)
    const materialCost = (materials ?? [])
      .filter(m => m.job_id === j.id && ['ordered', 'received', 'in_stock'].includes(m.status))
      .reduce((a, m) => a + num(m.quantity) * num(m.unit_cost), 0)
    const manualLabor = (jobLabor ?? []).filter(l => l.job_id === j.id).reduce((a, l) => a + num(l.hours) * num(l.labor_rate), 0)
    const laborCost = (invLaborByJob.get(j.id) ?? 0) + manualLabor
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
