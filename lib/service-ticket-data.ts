import { createAdminClient } from '@/lib/supabase/admin'
import type { TicketRecord, LaborRow, PartRow, PhotoRow } from '@/components/svc/ticket-form'

/** Everything the ticket form needs, loaded once for both the mobile and desktop pages. */
export async function loadTicket(id: string, company_id: string) {
  const admin = createAdminClient()
  const [{ data: ticket }, { data: labor }, { data: parts }, { data: photos }, { data: trucks }, { data: techs }, { data: invoice }] = await Promise.all([
    admin.from('service_tickets').select('*').eq('id', id).eq('company_id', company_id).maybeSingle(),
    admin.from('service_ticket_labor').select('*, profiles(full_name)').eq('ticket_id', id).order('work_date').order('kind'),
    admin.from('service_ticket_parts').select('*, parts(part_number), stock_locations(name)').eq('ticket_id', id).order('id'),
    admin.from('service_ticket_photos').select('*').eq('ticket_id', id).order('created_at'),
    admin.from('stock_locations').select('id, name').eq('company_id', company_id).eq('active', true).in('kind', ['truck', 'office']).order('kind', { ascending: false }).order('name'),
    admin.from('svc_technicians').select('id, full_name').eq('company_id', company_id).eq('is_active', true).order('full_name'),
    admin.from('con_invoices').select('id, invoice_number, status').eq('service_ticket_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (!ticket) return null
  return {
    ticket: ticket as TicketRecord,
    labor: (labor ?? []).map(l => ({ id: l.id, work_date: l.work_date, kind: l.kind, hours: Number(l.hours), tech_name: (l as { profiles?: { full_name: string } | null }).profiles?.full_name ?? null })) as LaborRow[],
    parts: (parts ?? []).map(p => ({ id: p.id, description: p.description, quantity: Number(p.quantity), unit_cost: p.unit_cost, sell_price: p.sell_price, charge_type: p.charge_type,
      part_number: (p as { parts?: { part_number: string | null } | null }).parts?.part_number ?? null, location_name: (p as { stock_locations?: { name: string } | null }).stock_locations?.name ?? null })) as PartRow[],
    photos: (photos ?? []) as PhotoRow[],
    trucks: (trucks ?? []).map(t => ({ id: t.id, name: t.name })),
    techs: (techs ?? []).map(t => ({ id: t.id, name: t.full_name })),
    invoice,
  }
}
