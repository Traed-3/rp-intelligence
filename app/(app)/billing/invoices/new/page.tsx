import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireBilling } from '@/lib/billing-guard'
import { loadBuilderLists } from '@/lib/billing-data'
import { Rev19Builder } from '@/components/billing/rev19-builder'
import { saveInvoice } from '../../actions'

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ job?: string; department?: string }> }) {
  const { job, department } = await searchParams
  const { id: userId, company_id, canWrite } = await requireBilling()
  if (!canWrite) redirect('/billing/invoices')
  const lists = await loadBuilderLists(createAdminClient(), company_id)
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-5"><Link href="/billing/invoices" className="text-sm text-gray-500 hover:text-gray-700">← Invoices</Link><h1 className="rp-title mt-1">New invoice</h1><p className="text-sm text-gray-500">Same twelve categories as the quote. Labor by day, mobilization by tech-travel-day, receipts on the material lines.</p></div>
      <Rev19Builder action={saveInvoice.bind(null, null)} header={{ kind: 'invoice', job_id: job ?? null, department: department ?? 'construction' } as never} customers={lists.customers} jobs={lists.jobs} rateCards={lists.rateCards} team={lists.team} quickPicks={lists.quickPicks} currentUser={lists.team.find(t => t.id === userId) ?? null} />
    </div>
  )
}
