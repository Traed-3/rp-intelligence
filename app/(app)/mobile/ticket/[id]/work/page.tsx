import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { LaborTimer } from '@/app/(app)/tickets/[id]/labor-timer'

export default async function MobileWorkPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('id, company_id').eq('id', user!.id).single()

  const [{ data: ticket }, { data: laborHistory }, { data: empStatus }] = await Promise.all([
    admin.from('repair_tickets')
      .select('id, ticket_number, title, status, priority, assets(unit_number, make, model, year)')
      .eq('id', id)
      .eq('company_id', profile!.company_id)
      .single(),
    admin.from('labor_entries')
      .select('id, started_at, ended_at, total_minutes, entry_type, profiles(full_name)')
      .eq('ticket_id', id)
      .eq('entry_type', 'ticket')
      .order('started_at', { ascending: false })
      .limit(10),
    admin.from('employee_statuses')
      .select('clock_status, current_ticket_id, active_labor_entry_id')
      .eq('profile_id', profile!.id)
      .maybeSingle(),
  ])

  if (!ticket) notFound()

  const isActiveOnThis = empStatus?.current_ticket_id === id && !!empStatus?.active_labor_entry_id
  const isClockedIn = empStatus?.clock_status === 'clocked_in'

  let activeLaborStartedAt: string | null = null
  if (isActiveOnThis && empStatus?.active_labor_entry_id) {
    const { data: entry } = await admin.from('labor_entries').select('started_at').eq('id', empStatus.active_labor_entry_id).single()
    activeLaborStartedAt = entry?.started_at ?? null
  }

  const asset = (ticket as any).assets

  return (
    <div className="min-h-screen bg-gray-50 p-5">
      <div className="max-w-sm mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <Link href="/shop/my-tasks" className="text-sm text-blue-600">← My Tasks</Link>
          <Link href={`/tickets/${id}`} className="text-xs text-gray-400 hover:text-gray-600">Full view →</Link>
        </div>

        {/* Ticket header */}
        <div className="rp-card p-5">
          <p className="text-xs font-mono text-gray-400 mb-1">{ticket.ticket_number}</p>
          <h1 className="text-lg font-bold text-gray-900 leading-tight">{ticket.title}</h1>
          {asset && (
            <p className="text-sm text-gray-500 mt-1">
              {asset.unit_number}
              {[asset.year, asset.make, asset.model].filter(Boolean).length > 0 &&
                ` — ${[asset.year, asset.make, asset.model].filter(Boolean).join(' ')}`}
            </p>
          )}
        </div>

        {/* Labor timer — full size for mobile */}
        <LaborTimer
          ticketId={id}
          isActive={isActiveOnThis}
          startedAt={activeLaborStartedAt}
          totalLaborHours={(ticket as any).total_labor_hours ?? 0}
          laborHistory={(laborHistory ?? []).map(e => ({
            ...e,
            profiles: Array.isArray(e.profiles) ? e.profiles[0] ?? null : (e.profiles as any) ?? null,
          }))}
          isClockedIn={isClockedIn}
        />
      </div>
    </div>
  )
}
