import Link from 'next/link'
import { submitterLabel } from '@/lib/receipt-submitter'
import { safeReceiptUrl } from '@/lib/receipt-url'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id, role').eq('id', user!.id).single()

  const { data: expense } = await admin
    .from('expenses')
    .select('*, assets(unit_number, make, model), profiles!expenses_submitted_by_fkey(full_name), repair_tickets(ticket_number, title), con_jobs(site_number, work_order_number), expense_categories(name)')
    .eq('id', id)
    .eq('company_id', profile!.company_id)
    .single()

  if (!expense) notFound()
  // Only a link into our own receipts storage is opened, framed or shown.
  const receiptUrl = safeReceiptUrl(expense.receipt_url)

  function Row({ label, value }: { label: string; value?: string | number | null }) {
    if (value == null || value === '') return null
    return (
      <div className="flex justify-between py-2 border-b border-gray-50 last:border-0">
        <span className="text-sm text-gray-500">{label}</span>
        <span className="text-sm font-medium text-gray-900">{value}</span>
      </div>
    )
  }

  const chargedTo = expense.expense_type === 'asset'
    ? `${(expense as any).assets?.unit_number} — ${(expense as any).assets?.make ?? ''} ${(expense as any).assets?.model ?? ''}`.trim()
    : expense.expense_type === 'store' ? `Store ${expense.store_number}`
    : expense.expense_type === 'project' ? `Project ${(expense as any).con_jobs?.site_number ?? expense.project_number ?? ''}`.trim()
    : 'General'

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/expenses" className="text-sm text-gray-500 hover:text-gray-700">← Expenses</Link>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="rp-title">${Number(expense.amount).toFixed(2)}</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {expense.vendor || 'No vendor'} ·{' '}
            {new Date(expense.expense_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        {expense.payment_method_code && (
          <span className="text-sm font-mono font-bold bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-lg">
            {expense.payment_method_code}
          </span>
        )}
      </div>

      <div className="space-y-5">
        <div className="rp-card p-5">
          <h2 className="font-semibold text-gray-900 mb-3">Details</h2>
          <Row label="Submitted By" value={submitterLabel(expense as any)} />
          {(expense as any).submitter_email && (expense as any).submitter_name && <Row label="Submitter Email" value={(expense as any).submitter_email} />}
          <Row label="Charged To" value={chargedTo} />
          <Row label="Category" value={(expense as any).expense_categories?.name ?? expense.category_custom} />
          <Row label="Description" value={expense.description} />
          <Row label="Vendor" value={expense.vendor} />
          <Row label="Payment" value={expense.payment_method_code} />
          <Row label="Notes" value={expense.notes} />
          {(expense as any).repair_tickets && (
            <div className="flex justify-between py-2">
              <span className="text-sm text-gray-500">Linked Ticket</span>
              <Link href={`/tickets/${expense.repair_ticket_id}`} className="text-sm text-blue-600 font-medium hover:underline">
                {(expense as any).repair_tickets.ticket_number}
              </Link>
            </div>
          )}
          {(expense as any).con_jobs && (
            <div className="flex justify-between py-2">
              <span className="text-sm text-gray-500">Linked Project</span>
              <Link href={`/construction/jobs/${expense.con_job_id}`} className="text-sm text-blue-600 font-medium hover:underline">
                {(expense as any).con_jobs.site_number ?? 'View project'}
              </Link>
            </div>
          )}
        </div>

        {receiptUrl && (
          <div className="rp-card p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Receipt</h2>
            {/\.pdf(\?|$)/i.test(receiptUrl) ? (
              <>
                <iframe src={receiptUrl} title="Receipt" referrerPolicy="no-referrer" className="w-full h-[70vh] rounded-lg border border-gray-100" />
                <a href={receiptUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-medium text-blue-600 hover:underline">Open the receipt in a new tab →</a>
              </>
            ) : (
              <a href={receiptUrl} target="_blank" rel="noopener noreferrer">
                <img src={receiptUrl} alt="Receipt" className="max-w-full rounded-lg border border-gray-100" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
