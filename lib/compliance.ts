/**
 * DQF & Certifications module — shared types and rules (no DB access here).
 *
 * Tables: hr_employees, hr_requirement_types, hr_employee_items, hr_item_history,
 * hr_compliance_settings, hr_notice_log (supabase/migrations/hr_compliance_module.sql).
 */

export const COMPLIANCE_READ_ROLES = ['owner', 'manager', 'construction_manager']
export const COMPLIANCE_WRITE_ROLES = ['owner', 'manager', 'construction_manager']

type GateProfile = { id?: string | null; role?: string | null } | null | undefined
export const canReadCompliance = (p: GateProfile) => !!p?.id && COMPLIANCE_READ_ROLES.includes(p.role ?? '')
export const canWriteCompliance = (p: GateProfile) => !!p?.id && COMPLIANCE_WRITE_ROLES.includes(p.role ?? '')

export const HR_BUCKET = 'hr-compliance'

export const DEPARTMENTS = [
  { value: 'construction', label: 'Construction' },
  { value: 'service',      label: 'Service' },
  { value: 'mechanics',    label: 'Mechanics / Warehouse' },
  { value: 'parts',        label: 'Parts Department' },
  { value: 'office',       label: 'Office' },
  { value: 'management',   label: 'Management' },
] as const
export const departmentLabel = (v: string | null | undefined) => DEPARTMENTS.find(d => d.value === v)?.label ?? v ?? '—'

export const CATEGORIES = [
  { value: 'dqf',           label: 'Driver Qualification File' },
  { value: 'certification', label: 'Certifications' },
  { value: 'personnel',     label: 'Personnel File' },
] as const
export type Category = typeof CATEGORIES[number]['value']

export const CERT_KINDS = [
  { value: 'jurisdiction', label: 'State / jurisdiction' },
  { value: 'manufacturer', label: 'Manufacturer' },
  { value: 'safety',       label: 'Safety & training' },
  { value: 'equipment',    label: 'Equipment operator' },
] as const

export const APPLIES_TO = [
  { value: 'dot',      label: 'Every DOT driver' },
  { value: 'cdl',      label: 'CDL drivers only' },
  { value: 'all',      label: 'Every employee' },
  { value: 'optional', label: 'Only when added to someone' },
] as const

export const ITEM_STATUSES = [
  { value: 'missing',      label: 'Missing' },
  { value: 'in_progress',  label: 'In progress' },
  { value: 'on_file',      label: 'On file' },
  { value: 'not_required', label: 'Not required' },
] as const

export type RequirementType = {
  id: string
  name: string
  category: Category
  kind: string | null
  issuer: string | null
  applies_to: 'dot' | 'cdl' | 'all' | 'optional'
  departments: string[] | null
  expires: boolean
  renewal_months: number | null
  notice_days: number[] | null
  regulation: string | null
  description: string | null
  sort_order: number
  is_active: boolean
  notify: boolean          // send automatic expiry emails for this type (DOT items yes; certifications only if switched on)
}

export type Employee = {
  id: string
  company_id: string
  full_name: string
  email: string | null
  personal_email: string | null
  phone: string | null
  department: string
  job_title: string | null
  hire_date: string | null
  is_dot_driver: boolean
  is_cdl: boolean
  license_number: string | null
  license_state: string | null
  license_class: string | null
  is_active: boolean
  termination_date: string | null
  notify_employee: boolean
  notes: string | null
}

export type EmployeeItem = {
  id: string
  employee_id: string
  type_id: string
  status: 'missing' | 'in_progress' | 'on_file' | 'not_required'
  issued_date: string | null
  expiration_date: string | null
  cert_number: string | null
  notes: string | null
  document_path: string | null
  document_name: string | null
  verified_at: string | null
}

export type ComplianceSettings = {
  company_id: string
  emails_enabled: boolean
  dqf_notice_days: number[]
  cert_notice_days: number[]
  overdue_repeat_days: number
  notify_employee: boolean
  management_emails: string[]
  dqf_management_emails: string[]
  cert_management_emails: string[]
  weekly_digest: boolean
  digest_weekday: number
}

/** Does this requirement belong in this employee's file even if nobody added it by hand? */
export function isRequiredFor(t: Pick<RequirementType, 'applies_to' | 'departments' | 'is_active'>, e: Pick<Employee, 'is_dot_driver' | 'is_cdl' | 'department'>): boolean {
  if (!t.is_active) return false
  if (t.applies_to === 'dot') return e.is_dot_driver
  if (t.applies_to === 'cdl') return e.is_dot_driver && e.is_cdl
  if (t.applies_to === 'all') return !t.departments?.length || t.departments.includes(e.department)
  return false
}

// ── Dates (all plain YYYY-MM-DD, compared in America/New_York) ────────────────
export function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.UTC(+fromISO.slice(0, 4), +fromISO.slice(5, 7) - 1, +fromISO.slice(8, 10))
  const b = Date.UTC(+toISO.slice(0, 4), +toISO.slice(5, 7) - 1, +toISO.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}
export function addMonthsISO(iso: string, months: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1 + months, +iso.slice(8, 10)))
  return d.toISOString().slice(0, 10)
}
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(2, 4)}`
}

/** The date an item runs out: the printed expiry, else issued + the type's renewal period. */
export function effectiveExpiration(item: Pick<EmployeeItem, 'issued_date' | 'expiration_date'>, type: Pick<RequirementType, 'expires' | 'renewal_months'>): string | null {
  if (!type.expires) return null
  if (item.expiration_date) return item.expiration_date
  if (item.issued_date && type.renewal_months) return addMonthsISO(item.issued_date, type.renewal_months)
  return null
}

export type Health = 'expired' | 'due_soon' | 'ok' | 'missing' | 'in_progress' | 'no_date' | 'not_required'

export const HEALTH_STYLE: Record<Health, { label: string; cls: string; dot: string }> = {
  expired:      { label: 'Expired',      cls: 'bg-red-100 text-red-800 border-red-200',         dot: 'bg-red-500' },
  due_soon:     { label: 'Due soon',     cls: 'bg-amber-100 text-amber-800 border-amber-200',   dot: 'bg-amber-400' },
  ok:           { label: 'Current',      cls: 'bg-green-100 text-green-800 border-green-200',   dot: 'bg-green-500' },
  no_date:      { label: 'On file',      cls: 'bg-blue-50 text-blue-700 border-blue-200',       dot: 'bg-blue-400' },
  in_progress:  { label: 'In progress',  cls: 'bg-indigo-50 text-indigo-700 border-indigo-200', dot: 'bg-indigo-400' },
  missing:      { label: 'Missing',      cls: 'bg-gray-100 text-gray-600 border-gray-200',      dot: 'bg-gray-300' },
  not_required: { label: 'N/A',          cls: 'bg-white text-gray-400 border-gray-200',         dot: 'bg-gray-200' },
}

/** One item's standing today. `soonDays` = the widest notice window (e.g. 60). */
export function itemHealth(
  item: Pick<EmployeeItem, 'status' | 'issued_date' | 'expiration_date'> | null | undefined,
  type: Pick<RequirementType, 'expires' | 'renewal_months'>,
  soonDays: number,
  today = todayET(),
): { health: Health; exp: string | null; daysLeft: number | null } {
  if (!item || item.status === 'missing') return { health: 'missing', exp: null, daysLeft: null }
  if (item.status === 'not_required') return { health: 'not_required', exp: null, daysLeft: null }
  const exp = effectiveExpiration(item, type)
  if (exp) {
    const daysLeft = daysBetween(today, exp)
    if (daysLeft < 0) return { health: 'expired', exp, daysLeft }
    if (daysLeft <= soonDays) return { health: 'due_soon', exp, daysLeft }
    return { health: item.status === 'in_progress' ? 'in_progress' : 'ok', exp, daysLeft }
  }
  if (item.status === 'in_progress') return { health: 'in_progress', exp: null, daysLeft: null }
  return { health: 'no_date', exp: null, daysLeft: null }
}

export function noticeDaysFor(type: Pick<RequirementType, 'category' | 'notice_days'>, s: Pick<ComplianceSettings, 'dqf_notice_days' | 'cert_notice_days'>): number[] {
  const days = type.notice_days?.length ? type.notice_days : type.category === 'dqf' ? s.dqf_notice_days : s.cert_notice_days
  return [...days].filter(n => n >= 0).sort((a, b) => b - a)
}

/**
 * Which notice is due for an expiring item today, or null.
 * Stage = the tightest window the item is inside ('30' when 30 ≥ daysLeft > 14 …), 'expired' once past.
 * The caller dedups on (item, stage, expiration date) — and for 'expired', on the repeat interval.
 */
export function noticeStage(daysLeft: number, windows: number[]): string | null {
  if (daysLeft < 0) return 'expired'
  const inside = windows.filter(w => daysLeft <= w)
  if (!inside.length) return null
  return String(Math.min(...inside))
}

export function stageLabel(stage: string, daysLeft: number): string {
  if (stage === 'expired') return `EXPIRED ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago`
  if (daysLeft === 0) return 'expires TODAY'
  return `expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
}

export function parseEmailList(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)))]
}
export function parseDaysList(raw: string): number[] {
  return [...new Set(raw.split(/[\s,;]+/).map(s => parseInt(s, 10)).filter(n => Number.isFinite(n) && n >= 0 && n <= 365))].sort((a, b) => b - a)
}
