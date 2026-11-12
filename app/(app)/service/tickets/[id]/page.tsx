import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FileText, Receipt } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { canWriteServiceTickets } from '@/lib/service-tickets'
import { loadTicket } from '@/lib/service-ticket-data'
import { TicketForm } from '@/components/svc/ticket-form'
import { Button } from '@/components/ui/button'
import { convertTicketToInvoice } from '../actions'

export default async function ServiceTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user!.id).single()
  const data = await loadTicket(id, profile!.company_id)
  if (!data) notFound()
  const canWrite = canWriteServiceTickets(profile?.role)
  const t = data.ticket
  const readyToInvoice = canWrite && !data.invoice && ['complete', 'signed'].includes(t.status)

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-5">
        <Link href="/service/tickets" className="text-sm text-gray-500 hover:text-gray-700">← Field Tickets</Link>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
          <h1 className="rp-title font-mono">{t.ticket_number}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {(t as { work_order_id?: string | null }).work_order_id && (
              <Link href={`/service/${(t as { work_order_id?: string | null }).work_order_id}`}><Button variant="outline" className="gap-2"><FileText className="w-3.5 h-3.5" />Work order</Button></Link>
            )}
            {data.invoice ? (
              <Link href={`/billing/invoices/${data.invoice.id}`}><Button variant="outline" className="gap-2"><Receipt className="w-3.5 h-3.5" />Invoice {data.invoice.invoice_number ?? ''}</Button></Link>
            ) : readyToInvoice ? (
              <form action={convertTicketToInvoice.bind(null, id)}><Button type="submit" className="gap-2"><Receipt className="w-3.5 h-3.5" />Create invoice →</Button></form>
            ) : null}
          </div>
        </div>
        {!data.invoice && !readyToInvoice && canWrite && (
          <p className="text-xs text-gray-500 mt-2">The invoice button appears once the ticket is marked <b>Work done</b> or both signatures are in. Labor is priced from the {t.brand ?? 'Independent'} rate card; disposables are added per tech-day.</p>
        )}
      </div>
      <TicketForm ticket={t} labor={data.labor} parts={data.parts} photos={data.photos} trucks={data.trucks} techs={data.techs} canWrite={canWrite} />
    </div>
  )
}
