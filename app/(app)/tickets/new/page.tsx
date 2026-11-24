import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { TicketForm } from '@/components/tickets/ticket-form'
import { createTicket } from '../actions'

export default async function NewTicketPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin.from('profiles').select('company_id, role').eq('id', user!.id).single()
  if (!profile || !['owner', 'manager', 'shop_manager'].includes(profile.role)) redirect('/tickets')

  const [{ data: assets }, { data: employees }] = await Promise.all([
    admin.from('assets').select('id, unit_number, name, make, model').eq('company_id', profile.company_id).neq('status', 'retired').order('unit_number'),
    admin.from('profiles').select('id, full_name, role').eq('company_id', profile.company_id).in('role', ['shop_employee', 'shop_manager', 'mechanic', 'service_tech', 'construction_tech']).eq('is_active', true).order('full_name'),
  ])

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href="/tickets" className="text-sm text-gray-500 hover:text-gray-700">← Back to Tickets</Link>
        <h1 className="rp-title mt-2">New Repair Ticket</h1>
      </div>
      <div className="rp-card p-6">
        <TicketForm action={createTicket} assets={assets ?? []} employees={employees ?? []} />
      </div>
    </div>
  )
}
