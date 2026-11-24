import { createAdminClient } from '@/lib/supabase/admin'
import { requireBilling } from '@/lib/billing-guard'
import { DocList, type DocRow } from '@/components/billing/doc-list'

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; department?: string }> }) {
  const { status = '', department = '' } = await searchParams
  const { company_id, canWrite } = await requireBilling()
  let q = createAdminClient().from('con_invoices').select('id, invoice_number, invoice_date, status, invoice_grand_total, store_label, department, con_customers(name)').eq('company_id', company_id).order('invoice_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(400)
  if (status) q = q.eq('status', status)
  if (department) q = q.eq('department', department)
  const { data } = await q
  const rows: DocRow[] = (data ?? []).map(r => ({ id: r.id, number: r.invoice_number, date: r.invoice_date, status: r.status, total: r.invoice_grand_total, store_label: r.store_label, department: r.department, customer: (r as unknown as { con_customers: { name: string } | null }).con_customers?.name ?? null }))
  return <DocList kind="invoices" rows={rows} status={status} department={department} canWrite={canWrite} statuses={['draft', 'sent', 'void']} />
}
