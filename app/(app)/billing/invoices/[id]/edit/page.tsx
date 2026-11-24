import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireBilling } from '@/lib/billing-guard'
import { loadBuilderLists, loadDoc } from '@/lib/billing-data'
import { Rev19Builder, type Rev19Header } from '@/components/billing/rev19-builder'
import { rowsFromLines } from '@/lib/rev19-rows'
import { saveInvoice } from '../../../actions'

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { id: userId, company_id, canWrite } = await requireBilling()
  if (!canWrite) redirect(`/billing/invoices/${id}`)
  const admin = createAdminClient()
  const [d, lists] = await Promise.all([loadDoc(admin, 'invoice', id, company_id), loadBuilderLists(admin, company_id)])
  if (!d) notFound()
  const r = d.row
  const header: Rev19Header = { ...(r as unknown as Rev19Header), kind: 'invoice', id, customer_id: r.con_customers?.id ?? (r.customer_id as string | null) }
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-5"><Link href={`/billing/invoices/${id}`} className="text-sm text-gray-500 hover:text-gray-700">← {String(r.invoice_number ?? 'Invoice')}</Link><h1 className="rp-title mt-1">Edit invoice</h1></div>
      <Rev19Builder action={saveInvoice.bind(null, id)} header={header} initialLines={rowsFromLines(d.lines)} customers={lists.customers} jobs={lists.jobs} rateCards={lists.rateCards} team={lists.team} quickPicks={lists.quickPicks} currentUser={lists.team.find(t => t.id === userId) ?? null} />
    </div>
  )
}
