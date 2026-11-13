import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { SectionCard } from '@/components/ui/section-card'
import { SiteTag } from '@/components/ui/site-tag'
import { StatusPill } from '@/components/ui/status-pill'
import { chargedTo, expenseTypeLabel } from '@/lib/expense-display'
import { money, shortDate } from '@/lib/receipt-report'
import { submitterLabel } from '@/lib/receipt-submitter'
import { safeReceiptUrl } from '@/lib/receipt-url'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === '' || children === false) return null
  return (
    <div className="flex items-start justify-between gap-6 py-2.5 border-b border-hairline last:border-0">
      <dt className="rp-label pt-0.5 shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-foreground text-right whitespace-pre-line">{children}</dd>
    </div>
  )
}

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
  const to = chargedTo(expense)
  const amount = Number(expense.amount)
  const truck = expense.expense_type === 'asset' ? [expense.assets?.make, expense.assets?.model].filter(Boolean).join(' ') : ''
  const category = expense.expense_categories?.name ?? expense.category_custom

  return (
    <div className="rp-page max-w-3xl">
      <PageHeader
        crumbs={[{ label: 'Expenses', href: '/expenses' }, { label: 'Receipt' }]}
        title={money(amount)}
        description={`${expense.vendor || expense.description || 'No vendor'} · ${shortDate(expense.expense_date)}`}
        actions={<>
          {amount < 0 && <StatusPill tone="info">Return / credit</StatusPill>}
          {expense.statement_checked_at
            ? <StatusPill tone="success" dot>On the bill</StatusPill>
            : <StatusPill tone="warning" dot>Not checked off</StatusPill>}
          {expense.payment_method_code && <span className="rp-site-tag !text-sm !py-1.5 !px-2.5 font-semibold">{expense.payment_method_code}</span>}
        </>}
      />

      <div className="space-y-5">
        <SectionCard title="Details">
          <dl>
            <Row label="Sent by">{submitterLabel(expense)}</Row>
            <Row label="Email">{expense.submitter_name ? expense.submitter_email : null}</Row>
            <Row label="Charged to">
              <span className="inline-flex items-center gap-2">
                {to.kind !== 'overhead' && <span className="text-xs font-normal text-muted-foreground">{expenseTypeLabel(expense.expense_type)}</span>}
                {to.kind === 'site' ? <SiteTag site={to.label} /> : to.kind === 'asset' ? <StatusPill tone="info">{to.label}</StatusPill> : <StatusPill>{to.label}</StatusPill>}
              </span>
              {truck && <span className="block text-xs font-normal text-muted-foreground mt-0.5">{truck}</span>}
            </Row>
            <Row label="Category">{to.kind === 'overhead' ? null : category}</Row>
            <Row label="What it was">{expense.description}</Row>
            <Row label="Vendor">{expense.vendor}</Row>
            <Row label="Paid with">{[expense.payment_method_code, expense.card_last4 ? `card …${expense.card_last4}` : null].filter(Boolean).join(' · ')}</Row>
            <Row label="Notes">{expense.notes}</Row>
            {expense.repair_tickets && (
              <Row label="Repair ticket">
                <Link href={`/tickets/${expense.repair_ticket_id}`} className="text-primary hover:underline">{expense.repair_tickets.ticket_number}</Link>
              </Row>
            )}
            {expense.con_jobs && (
              <Row label="Project">
                <Link href={`/construction/jobs/${expense.con_job_id}`} className="text-primary hover:underline">{expense.con_jobs.site_number ?? 'Open the project'}</Link>
              </Row>
            )}
          </dl>
        </SectionCard>

        {receiptUrl && (
          <SectionCard
            title="Receipt"
            action={<a href={receiptUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><ExternalLink className="size-3.5" />Open in a new tab</a>}
          >
            {/\.pdf(\?|$)/i.test(receiptUrl) ? (
              <iframe src={receiptUrl} title="Receipt" referrerPolicy="no-referrer" className="w-full h-[70vh] rounded-lg border border-border" />
            ) : (
              <a href={receiptUrl} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={receiptUrl} alt="Receipt" className="max-w-full rounded-lg border border-border" />
              </a>
            )}
          </SectionCard>
        )}
      </div>
    </div>
  )
}
