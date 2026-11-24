import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { canWriteServiceTickets } from '@/lib/service-tickets'
import { loadTicket } from '@/lib/service-ticket-data'
import { TicketForm } from '@/components/svc/ticket-form'

export default async function MobileServiceTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user!.id).single()
  const data = await loadTicket(id, profile!.company_id)
  if (!data) notFound()

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-16">
      <div className="max-w-md mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <Link href="/mobile/service-ticket" className="text-sm text-blue-600">← Tickets</Link>
          <Link href={`/service/tickets/${id}`} className="text-xs text-gray-400 hover:text-gray-600">Full view →</Link>
        </div>
        {data.invoice && <Link href={`/construction/invoices/${data.invoice.id}`} className="block rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">Invoiced as <b className="font-mono">{data.invoice.invoice_number ?? 'draft'}</b> →</Link>}
        <TicketForm ticket={data.ticket} labor={data.labor} parts={data.parts} photos={data.photos} trucks={data.trucks} techs={data.techs} canWrite={canWriteServiceTickets(profile?.role)} compact />
      </div>
    </div>
  )
}
