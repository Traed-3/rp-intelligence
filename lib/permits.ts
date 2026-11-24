// ── Permits module: shared constants, status ladder, and rule engine ──
// Everything the permit board, alerts, jurisdiction, and site views agree on.

// The nine — and only nine — permit statuses, in ladder order.
export const PERMIT_STATUSES = [
  { value: 'Not Started',              className: 'bg-gray-100 text-gray-600 border-gray-200' },
  { value: 'Submitted to Hash',        className: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'Hash Submitted Confirmed', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { value: 'In Progress',              className: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'Permit In-Hand',           className: 'bg-green-100 text-green-800 border-green-300' },
  { value: 'Inspection Scheduled',     className: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  { value: 'Complete',                 className: 'bg-teal-100 text-teal-800 border-teal-300' },
  { value: 'On Hold',                  className: 'bg-red-100 text-red-700 border-red-300' },
  { value: 'Rejected',                 className: 'bg-red-100 text-red-800 border-red-400' },
] as const

export const PERMIT_STATUS_VALUES = PERMIT_STATUSES.map(s => s.value)
export type PermitStatus = (typeof PERMIT_STATUS_VALUES)[number]

export function permitStatusMeta(status: string) {
  return PERMIT_STATUSES.find(s => s.value === status) ?? PERMIT_STATUSES[0]
}

// "In hand or later" — the only states that clear a site to work.
export const IN_HAND_OR_LATER: readonly string[] = [
  'Permit In-Hand', 'Inspection Scheduled', 'Complete',
]
export function isInHandOrLater(status: string) {
  return IN_HAND_OR_LATER.includes(status)
}

// ── Dashboard buckets ──
// Every permit lands in exactly one of three piles on the Permits dashboard.
//   waiting    — not in hand yet (not started, with Hash, at the jurisdiction, on hold, rejected)
//   inspection — permit is in hand, the final inspection is still owed
//   complete   — final passed / closed out. Nothing left to do, so no alerts.
export type PermitBucket = 'waiting' | 'inspection' | 'complete'
export const PERMIT_BUCKETS: readonly { key: PermitBucket; label: string; blurb: string }[] = [
  { key: 'waiting',    label: 'Waiting / In progress',  blurb: 'Not in hand yet' },
  { key: 'inspection', label: 'Need final inspection',  blurb: 'Permit in hand, final still owed' },
  { key: 'complete',   label: 'Completed',              blurb: 'Final passed, closed out' },
]
export function permitBucket(status: string): PermitBucket {
  if (status === 'Complete') return 'complete'
  if (status === 'Permit In-Hand' || status === 'Inspection Scheduled') return 'inspection'
  return 'waiting'
}
export function isPermitComplete(status: string) {
  return status === 'Complete'
}

export const PERMIT_TYPES = ['Electrical', 'Building', 'Mechanical', 'Plumbing', 'Fire', 'Zoning', 'Other'] as const
export const PULLED_BY = ['Hash Construction', 'J&J Electric', 'RPS', 'Engineering Firm'] as const
export const REQUIREMENT_STATUSES = ['Unknown', 'Required', 'Not Required'] as const
export const PROJECT_TYPES = ['Dispenser Replacement', 'STP Circuit Repair', 'Tank Replacement', 'MUL Conversion', 'Product Line / UDC Replacement'] as const
export const REQUEST_TYPES = ['Non-PE Stamped', 'PE Stamped'] as const

// Who pulls a permit, by type (and state). Electrical is Hash in VA and
// J&J Electric in MD/WV (Hash's license is VA only); everything else is RPS.
export function defaultPulledBy(permitType: string, state?: string | null): string {
  if (permitType !== 'Electrical') return 'RPS'
  const st = (state ?? '').toUpperCase()
  return st === 'MD' || st === 'WV' ? 'J&J Electric' : 'Hash Construction'
}

// The 28-day rule: permit due date is always the work date minus 28 days.
// (In the DB this is a generated column; this mirror is for computing in JS.)
export const PERMIT_LEAD_DAYS = 28

export function toDate(d: string | null | undefined): Date | null {
  if (!d) return null
  const parts = d.slice(0, 10).split('-').map(Number)
  if (parts.length === 3 && parts.every(x => !Number.isNaN(x))) {
    return new Date(parts[0], parts[1] - 1, parts[2])
  }
  return null
}

export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function permitDueDate(scheduled: string | null | undefined): string | null {
  const d = toDate(scheduled)
  if (!d) return null
  d.setDate(d.getDate() - PERMIT_LEAD_DAYS)
  return iso(d)
}

export function daysUntil(dateStr: string | null | undefined, now = new Date()): number | null {
  const d = toDate(dateStr)
  if (!d) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((d.getTime() - today.getTime()) / 86_400_000)
}

// ── Permit shape used by the rule engine ──
export type PermitRow = {
  id: string
  project_id: string
  permit_key: string | null
  permit_type: string
  pulled_by: string
  requirement_status: string
  status: string
}

// A project is ready to work only when it has at least one Required permit
// and every Required permit sits at Permit In-Hand or later.
export function computeReadyToWork(permits: Pick<PermitRow, 'requirement_status' | 'status'>[]): boolean {
  const required = permits.filter(p => p.requirement_status === 'Required')
  if (required.length === 0) return false
  return required.every(p => isInHandOrLater(p.status))
}

// AUTO-RESOLVE: once the Electrical permit on a project reaches Permit In-Hand
// or later, the jurisdiction wanted nothing else — flip every Unknown on that
// project to Not Required. Returns true if the change should fire.
export function electricalIsIssued(permits: Pick<PermitRow, 'permit_type' | 'status'>[]): boolean {
  return permits.some(p => p.permit_type === 'Electrical' && isInHandOrLater(p.status))
}

// ── Business-day math for the "stalled at Hash" alert ──
export function businessDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0
  let count = 0
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  while (cur < end) {
    cur.setDate(cur.getDate() + 1)
    const dow = cur.getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}
