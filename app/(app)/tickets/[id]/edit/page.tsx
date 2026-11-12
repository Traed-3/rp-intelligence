import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { TicketForm } from '@/components/tickets/ticket-form'
import { updateTicket } from '../../actions'

export default async function EditTicketPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin.from('profiles').select('company_id, role').eq('id', user!.id).single()
  if (!profile || !['owner', 'manager', 'shop_manager'].includes(profile.role)) redirect(`/tickets/${id}`)

  const [{ data: ticket }, { data: assets }, { data: employees }, { data: currentAssignments }] = await Promise.all([
    admin.from('repair_tickets').select('*').eq('id', id).eq('company_id', profile.company_id).single(),
    admin.from('assets').select('id, unit_number, name, make, model').eq('company_id', profile.company_id).neq('status', 'retired').order('unit_number'),
    admin.from('profiles').select('id, full_name, role').eq('company_id', profile.company_id).in('role', ['shop_employee', 'shop_manager', 'mechanic', 'service_tech', 'construction_tech']).eq('is_active', true).order('full_name'),
    admin.from('repair_ticket_assignments').select('profile_id').eq('ticket_id', id).eq('is_active', true),
  ])

  if (!ticket) notFound()

  const currentAssigneeIds = (currentAssignments ?? []).map(a => a.profile_id)
  const action = updateTicket.bind(null, id)

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href={`/tickets/${id}`} className="text-sm text-gray-500 hover:text-gray-700">← Back to Ticket</Link>
        <h1 className="rp-title mt-2">Edit Ticket — {ticket.ticket_number}</h1>
      </div>
      <div className="rp-card p-6">
        <TicketForm action={action} assets={assets ?? []} employees={employees ?? []} ticket={ticket} currentAssigneeIds={currentAssigneeIds} />
      </div>
    </div>
  )
}
