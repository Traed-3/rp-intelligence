import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireBilling } from '@/lib/billing-guard'
import { loadDoc } from '@/lib/billing-data'
import { DocDetail } from '@/components/billing/doc-detail'

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { company_id, canWrite } = await requireBilling()
  const admin = createAdminClient()
  const d = await loadDoc(admin, 'invoice', id, company_id)
  if (!d) notFound()
  const { data: emails } = await admin.from('billing_emails').select('id, to_emails, sent_at, status, error').eq('invoice_id', id).order('sent_at', { ascending: false }).limit(10)
  return <DocDetail kind="invoice" row={d.row} lines={d.lines} canWrite={canWrite} emails={emails ?? []} resendConfigured={!!process.env.RESEND_API_KEY} />
}
