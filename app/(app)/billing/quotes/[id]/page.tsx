import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireBilling } from '@/lib/billing-guard'
import { loadDoc } from '@/lib/billing-data'
import { DocDetail } from '@/components/billing/doc-detail'

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { company_id, canWrite } = await requireBilling()
  const admin = createAdminClient()
  const d = await loadDoc(admin, 'quote', id, company_id)
  if (!d) notFound()
  const { data: invs } = await admin.from('con_invoices').select('id, invoice_number, status').eq('quote_id', id).eq('company_id', company_id)
  const { data: changeOrders } = await admin.from('con_quotes').select('id, quote_number, status').eq('parent_quote_id', id).eq('company_id', company_id)
  return <DocDetail kind="quote" row={d.row} lines={d.lines} canWrite={canWrite} invoicesFromQuote={invs ?? []} changeOrders={changeOrders ?? []} />
}
