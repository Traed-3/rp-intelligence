import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { ExpenseForm } from './expense-form'
import { createExpense } from '../actions'
import { noAccountingOrHr } from '@/lib/role-access'

export default async function NewExpensePage({ searchParams }: { searchParams: Promise<{ doc?: string; sent?: string }> }) {
  const { doc: rawDocId, sent } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id, role').eq('id', user!.id).single()
  // Techs, mechanics and shop employees only turn in their own receipt: no inbox email pre-fill, no way into Expenses.
  const locked = noAccountingOrHr(profile?.role)
  const docId = locked ? undefined : rawDocId

  const [
    { data: assets },
    { data: paymentMethods },
    { data: assetCategories },
    { data: storeCategories },
    { data: openTickets },
    { data: constructionJobs },
    { data: storeRows },
    { data: quoteRows },
  ] = await Promise.all([
    admin.from('assets').select('id, unit_number, name, make, model')
      .eq('company_id', profile!.company_id).neq('status', 'retired').order('unit_number'),
    admin.from('payment_methods').select('id, code, name')
      .eq('company_id', profile!.company_id).eq('is_active', true).order('code'),
    admin.from('expense_categories').select('id, name')
      .eq('company_id', profile!.company_id).eq('context', 'asset').order('sort_order'),
    admin.from('expense_categories').select('id, name')
      .eq('company_id', profile!.company_id).eq('context', 'store').order('sort_order'),
    admin.from('repair_tickets').select('id, ticket_number, title')
      .eq('company_id', profile!.company_id)
      .not('status', 'in', '(completed,closed,deferred)')
      .order('updated_at', { ascending: false }).limit(30),
    admin.from('con_jobs').select('id, site_number, work_order_number, stage')
      .eq('company_id', profile!.company_id).neq('stage', 'complete')
      .order('site_number').limit(500),
    admin.from('expenses').select('store_number')
      .eq('company_id', profile!.company_id).not('store_number', 'is', null).limit(2000),
    admin.from('con_quotes').select('id, job_id')
      .eq('company_id', profile!.company_id).not('job_id', 'is', null),
  ])

  // Opened from a receipt email in the billing inbox: carry the email's sender through
  // so the expense is credited to whoever sent it, and pre-fill what we extracted.
  let sourceDoc: { id: string; sender: string | null; senderEmail: string | null; vendor: string | null; date: string | null; amount: number | null } | null = null
  if (docId) {
    const { data: d } = await admin.from('billing_inbox_documents')
      .select('id, sender, sender_email, vendor, document_date, received_at, extracted')
      .eq('id', docId).eq('company_id', profile!.company_id).maybeSingle()
    if (d) {
      const total = Number((d.extracted as { total?: unknown } | null)?.total)
      sourceDoc = {
        id: d.id, sender: d.sender, senderEmail: d.sender_email, vendor: d.vendor,
        date: d.document_date ?? (d.received_at ? String(d.received_at).slice(0, 10) : null),
        amount: Number.isFinite(total) && total > 0 ? total : null,
      }
    }
  }

  const storeNumbers = Array.from(
    new Set((storeRows ?? []).map(r => (r.store_number ?? '').trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  // Map each construction project to the line-item descriptions from its bid(s),
  // so charging an expense to a project offers those as categories.
  const projectCategories: Record<string, string[]> = {}
  const quoteToJob = new Map((quoteRows ?? []).map(q => [q.id, q.job_id as string]))
  if (quoteToJob.size > 0) {
    const { data: liRows } = await admin.from('con_quote_line_items')
      .select('quote_id, description').in('quote_id', Array.from(quoteToJob.keys()))
    for (const li of liRows ?? []) {
      const jobId = quoteToJob.get(li.quote_id as string)
      const d = (li.description ?? '').trim()
      if (!jobId || !d) continue
      ;(projectCategories[jobId] ??= [])
      if (!projectCategories[jobId].includes(d)) projectCategories[jobId].push(d)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        {!locked && <Link href="/expenses" className="text-sm text-gray-500 hover:text-gray-700">← Expenses</Link>}
        <h1 className="rp-title mt-2">New Expense / Receipt</h1>
      </div>
      {sent && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">Receipt turned in. You can add another one below.</div>
      )}
      <div className="rp-card p-6">
        <ExpenseForm
          action={createExpense}
          assets={assets ?? []}
          paymentMethods={paymentMethods ?? []}
          assetCategories={assetCategories ?? []}
          storeCategories={storeCategories ?? []}
          openTickets={openTickets ?? []}
          constructionJobs={constructionJobs ?? []}
          storeNumbers={storeNumbers}
          projectCategories={projectCategories}
          sourceDoc={sourceDoc}
        />
      </div>
    </div>
  )
}
