import { CheckCircle2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { ExpenseForm } from './expense-form'
import { createExpense } from '../actions'
import { noAccountingOrHr, roleMayVisit } from '@/lib/role-access'

export default async function NewExpensePage({ searchParams }: { searchParams: Promise<{ doc?: string; sent?: string; from?: string }> }) {
  const { doc: rawDocId, sent, from } = await searchParams
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

  // Techs reach this from Forms (they have no Expenses module); the office reaches it from Expenses.
  const viaForms = (locked || from === 'forms') && roleMayVisit(profile?.role, '/forms')
  const home = viaForms ? { label: 'Forms', href: '/forms' } : locked ? null : { label: 'Expenses', href: '/expenses' }

  return (
    <div className="rp-page max-w-3xl">
      <PageHeader
        crumbs={home ? [home, { label: 'Submit a receipt' }] : undefined}
        title="Submit a Receipt"
        description="Take a photo of the receipt first. The app reads it and fills in what it can; check it, then send it in."
      />
      {sent && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-success/25 bg-success-soft px-4 py-3 text-sm font-medium text-success">
          <CheckCircle2 className="size-4 shrink-0" /> Receipt turned in. You can add another one below.
        </div>
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
          cancelHref={home?.href ?? '/'}
          fromForms={viaForms}
        />
      </div>
    </div>
  )
}
