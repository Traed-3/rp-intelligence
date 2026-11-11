import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canReadConstruction, stageMeta } from '@/lib/construction'
import { toCsv } from '@/lib/csv'
import { jobCostRows } from '@/lib/construction-reports'


export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile || !canReadConstruction(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const report = new URL(request.url).searchParams.get('report') ?? 'job_cost'
  let rows: (string | number | null)[][] = []
  let filename = 'construction_report.csv'
  const today = new Date()
  const todayIso = today.toISOString().split('T')[0]

  if (report === 'job_cost') {
    const data = await jobCostRows(admin, profile.company_id)
    rows = [['Job', 'Customer', 'Program', 'Stage', 'Quoted', 'Invoiced', 'Material Cost', 'Labor Cost', 'Margin', 'Margin %']]
    for (const r of data) {
      rows.push([r.site, r.customer, r.program, stageMeta(r.stage).label,
        r.quoted.toFixed(2), r.invoiced.toFixed(2), r.materialCost.toFixed(2), r.laborCost.toFixed(2),
        r.margin.toFixed(2), r.marginPct == null ? '' : r.marginPct.toFixed(1)])
    }
    filename = 'job_cost.csv'
  } else if (report === 'ar') {
    const { data } = await admin
      .from('con_invoices').select('invoice_number, status, invoice_grand_total, invoice_date, due_date, con_customers(name)')
      .eq('company_id', profile.company_id).in('status', ['sent', 'overdue']).order('due_date', { nullsFirst: false })
    rows = [['Invoice', 'Customer', 'Invoice Date', 'Due Date', 'Days Overdue', 'Amount']]
    for (const inv of data ?? []) {
      const days = inv.due_date && inv.due_date < todayIso
        ? Math.floor((today.getTime() - new Date(inv.due_date + 'T00:00:00').getTime()) / 86400000) : 0
      rows.push([inv.invoice_number, (inv as any).con_customers?.name ?? '', inv.invoice_date ?? '', inv.due_date ?? '', days, (Number(inv.invoice_grand_total) || 0).toFixed(2)])
    }
    filename = 'open_invoices_ar.csv'
  } else if (report === 'pipeline') {
    const { data } = await admin
      .from('con_jobs').select('site_number, stage, program, date_received, con_customers(name)')
      .eq('company_id', profile.company_id).neq('stage', 'complete').order('stage')
    rows = [['Job', 'Customer', 'Program', 'Stage', 'Date Received', 'Age (days)']]
    for (const j of data ?? []) {
      const age = j.date_received ? Math.floor((today.getTime() - new Date(j.date_received + 'T00:00:00').getTime()) / 86400000) : ''
      rows.push([j.site_number ?? '', (j as any).con_customers?.name ?? '', j.program ?? '', stageMeta(j.stage).label, j.date_received ?? '', age])
    }
    filename = 'pipeline_aging.csv'
  } else {
    return NextResponse.json({ error: 'Unknown report' }, { status: 400 })
  }

  return new NextResponse(toCsv(rows), {
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${filename}"` },
  })
}
