import { createAdminClient } from '@/lib/supabase/admin'
import { requireBilling } from '@/lib/billing-guard'
import { DocList, type DocRow } from '@/components/billing/doc-list'

export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ status?: string; department?: string }> }) {
  const { status = '', department = '' } = await searchParams
  const { company_id, canWrite } = await requireBilling()
  let q = createAdminClient().from('con_quotes').select('id, quote_number, proposal_date, status, final_total, store_label, department, kind, con_customers(name)').eq('company_id', company_id).order('proposal_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(300)
  if (status) q = q.eq('status', status)
  if (department) q = q.eq('department', department)
  const { data } = await q
  const rows: DocRow[] = (data ?? []).map(r => ({ id: r.id, number: r.quote_number, date: r.proposal_date, status: r.status, total: r.final_total, store_label: r.store_label, department: r.department, isChangeOrder: r.kind === 'change_order', customer: (r as unknown as { con_customers: { name: string } | null }).con_customers?.name ?? null }))
  return <DocList kind="quotes" rows={rows} status={status} department={department} canWrite={canWrite} statuses={['draft', 'sent', 'approved', 'rejected']} />
}
