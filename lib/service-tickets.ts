// ============================================================
// SERVICE TICKETS — pure helpers (no server imports).
// The field document a tech fills on a phone: what was found, what was
// done, hours + trips per day, parts pulled from the truck, photos, and
// two signatures. A signed ticket becomes an invoice through the rate card.
// ============================================================
import type { LineItemInput } from '@/lib/billing'

export const TICKET_STATUSES = [
  { value: 'open',       label: 'Open',        className: 'bg-gray-100 text-gray-700 border-gray-200' },
  { value: 'dispatched', label: 'Dispatched',  className: 'bg-blue-100 text-blue-800 border-blue-200' },
  { value: 'on_site',    label: 'On site',     className: 'bg-amber-100 text-amber-800 border-amber-200' },
  { value: 'complete',   label: 'Work done',   className: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  { value: 'signed',     label: 'Signed',      className: 'bg-green-200 text-green-900 border-green-300' },
  { value: 'invoiced',   label: 'Invoiced',    className: 'bg-green-100 text-green-800 border-green-200' },
  { value: 'void',       label: 'Void',        className: 'bg-gray-100 text-gray-400 border-gray-200' },
] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]['value']
export function ticketStatusMeta(v: string) { return TICKET_STATUSES.find(s => s.value === v) ?? TICKET_STATUSES[0] }

export const CHARGE_TYPES = [
  { value: 'billable',  label: 'Billable' },
  { value: 'no_charge', label: 'No charge' },
  { value: 'warranty',  label: 'Warranty' },
  { value: 'contract',  label: 'Contract / PM' },
  { value: 'callback',  label: 'Callback' },
] as const

export const BRANDS = ['7-Eleven', 'Sunoco', 'Wawa', 'Sheetz', 'Global', 'Independent'] as const

/** Which of the four RPS rate cards a brand bills at. */
export function rateCardNameForBrand(brand: string | null | undefined): '7-Eleven' | 'Global' | 'Sunoco' | 'Independent' {
  const b = (brand ?? '').toLowerCase()
  if (b.includes('7-eleven') || b.includes('7eleven') || b.includes('7 eleven')) return '7-Eleven'
  if (b.includes('sunoco')) return 'Sunoco'
  if (b.includes('global')) return 'Global'
  return 'Independent'
}

/** Brand name from a Service Dispatch work order (portal + client name). */
export function brandFromWorkOrder(sourcePortal: string | null | undefined, clientName: string | null | undefined): string {
  const p = (sourcePortal ?? '').toLowerCase(), c = (clientName ?? '').toLowerCase()
  if (p === '7help' || c.includes('7-eleven')) return '7-Eleven'
  if (p === 'wtsc' || c.includes('wawa')) return 'Wawa'
  if (p === 'it_service_desk' || c.includes('sunoco')) return 'Sunoco'
  if (c.includes('sheetz')) return 'Sheetz'
  if (c.includes('global')) return 'Global'
  return clientName?.trim() || 'Independent'
}

/** Observed on 74 of 112 finals: disposables are billed per tech-day at $17.50. */
export const DISPOSABLES_PER_TECH_DAY = 17.5
/** Observed on 112 of 113 finals: 6% sales tax on material only. */
export const DEFAULT_SERVICE_TAX = 0.06

export type TicketLabor = { work_date: string; kind: 'labor' | 'trip' | 'overtime'; hours: number; tech_id?: string | null }
export type TicketPart = { description: string; quantity: number; unit_cost?: number | null; sell_price?: number | null; part_id?: string | null; charge_type?: string | null; is_stock?: boolean | null }
export type RateCard = { labor_rate: number; overtime_rate?: number | null; trip_rate?: number | null; trip_mode?: string | null }

const mdy = (d: string) => { const [y, m, day] = d.slice(0, 10).split('-'); return `${Number(m)}/${Number(day)}/${y.slice(2)}` }

/**
 * Turn a ticket's labor and parts into invoice lines in the exact layout Peggy
 * builds by hand today: "Labor M/D/YY" + "Trip" rows per day, one Disposables
 * row per tech-day, then parts. Labor rate comes from the customer's rate card.
 */
export function buildInvoiceLines(labor: TicketLabor[], parts: TicketPart[], card: RateCard, opts: { disposablesPerDay?: number } = {}): LineItemInput[] {
  const lines: LineItemInput[] = []
  const days = [...labor].sort((a, b) => a.work_date.localeCompare(b.work_date))
  const tripRate = card.trip_mode === 'none' ? 0 : (card.trip_rate ?? card.labor_rate)
  for (const l of days) {
    if (l.kind === 'trip') lines.push({ section: 'basic', description: 'Trip', labor_hours: l.hours, labor_rate: tripRate, item_type: 'trip' })
    else lines.push({ section: 'basic', description: `Labor ${mdy(l.work_date)}${l.kind === 'overtime' ? ' (OT)' : ''}`, labor_hours: l.hours, labor_rate: l.kind === 'overtime' ? (card.overtime_rate ?? card.labor_rate * 1.5) : card.labor_rate, item_type: 'labor' })
  }
  const techDays = new Set(days.filter(l => l.kind !== 'trip').map(l => `${l.tech_id ?? 'x'}|${l.work_date.slice(0, 10)}`)).size
  if (techDays > 0) lines.push({ section: 'basic', description: 'Disposables', quantity: techDays, unit_cost: opts.disposablesPerDay ?? DISPOSABLES_PER_TECH_DAY, item_type: 'disposables' })
  for (const p of parts) {
    const billable = !p.charge_type || p.charge_type === 'billable'
    lines.push({ section: 'basic', description: billable ? p.description : `${p.description} (${p.charge_type})`, quantity: p.quantity, unit_cost: billable ? (p.sell_price ?? 0) : 0, item_type: 'material', part_id: p.part_id ?? null, is_stock: !!p.is_stock })
  }
  return lines.map((l, i) => ({ ...l, line_no: i + 1 }))
}

/** Roles that can create, edit and sign field tickets. */
export const SERVICE_TICKET_WRITE_ROLES = ['owner', 'manager', 'shop_manager', 'construction_manager', 'estimator', 'service_tech', 'construction_tech', 'mechanic']
export function canWriteServiceTickets(role: string | null | undefined) { return !!role && SERVICE_TICKET_WRITE_ROLES.includes(role) }
