import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type ComplianceSettings, type Employee, type EmployeeItem, type RequirementType, type Health,
  isRequiredFor, itemHealth, noticeDaysFor, todayET,
} from '@/lib/compliance'

export type Row = {
  type: RequirementType
  item: EmployeeItem | null
  required: boolean
  health: Health
  exp: string | null
  daysLeft: number | null
}

export type EmployeeFile = {
  employee: Employee
  rows: Row[]                       // every requirement that is required, or has a record
  counts: Record<Health, number>
  worst: Health
}

const SEVERITY: Health[] = ['expired', 'missing', 'due_soon', 'in_progress', 'ok', 'no_date', 'not_required']

export async function loadSettings(admin: SupabaseClient, companyId: string): Promise<ComplianceSettings> {
  const { data } = await admin.from('hr_compliance_settings').select('*').eq('company_id', companyId).maybeSingle()
  if (data) return data as ComplianceSettings
  const { data: created } = await admin.from('hr_compliance_settings').insert({ company_id: companyId }).select('*').single()
  return created as ComplianceSettings
}

export async function loadTypes(admin: SupabaseClient, companyId: string, includeInactive = false): Promise<RequirementType[]> {
  let q = admin.from('hr_requirement_types').select('*').eq('company_id', companyId).order('sort_order').order('name')
  if (!includeInactive) q = q.eq('is_active', true)
  const { data } = await q
  return (data ?? []) as RequirementType[]
}

/** Build each employee's file: required requirements + anything recorded, with today's health. */
export function buildFiles(employees: Employee[], types: RequirementType[], items: EmployeeItem[], settings: ComplianceSettings): EmployeeFile[] {
  const today = todayET()
  const byEmp = new Map<string, Map<string, EmployeeItem>>()
  for (const it of items) {
    if (!byEmp.has(it.employee_id)) byEmp.set(it.employee_id, new Map())
    byEmp.get(it.employee_id)!.set(it.type_id, it)
  }
  return employees.map(employee => {
    const mine = byEmp.get(employee.id) ?? new Map<string, EmployeeItem>()
    const rows: Row[] = []
    for (const type of types) {
      const item = mine.get(type.id) ?? null
      const required = isRequiredFor(type, employee, today)
      if (!required && !item) continue
      const soon = Math.max(0, ...noticeDaysFor(type, settings))
      const { health, exp, daysLeft } = itemHealth(item, type, soon, today)
      rows.push({ type, item, required, health, exp, daysLeft })
    }
    const counts = Object.fromEntries(SEVERITY.map(h => [h, 0])) as Record<Health, number>
    // A missing optional record is not a gap — only count missing items that are required.
    for (const r of rows) if (r.health !== 'missing' || r.required) counts[r.health]++
    // Standing: personnel-file paperwork (W-4, direct deposit…) doesn't make someone "Missing" — only expiring or
    // DQF/certification gaps do.
    const standing = rows.filter(r => !(r.type.category === 'personnel' && r.health === 'missing'))
    const worst = SEVERITY.find(h => h !== 'not_required' && standing.some(r => r.health === h && (h !== 'missing' || r.required))) ?? 'ok'
    return { employee, rows, counts, worst }
  })
}

export async function loadFiles(admin: SupabaseClient, companyId: string, opts: { includeInactive?: boolean; employeeId?: string } = {}) {
  let eq = admin.from('hr_employees').select('*').eq('company_id', companyId).order('full_name')
  if (!opts.includeInactive) eq = eq.eq('is_active', true)
  if (opts.employeeId) eq = eq.eq('id', opts.employeeId)
  let iq = admin.from('hr_employee_items').select('*').eq('company_id', companyId)
  if (opts.employeeId) iq = iq.eq('employee_id', opts.employeeId)
  const [{ data: employees }, types, { data: items }, settings] = await Promise.all([
    eq, loadTypes(admin, companyId, true), iq, loadSettings(admin, companyId),
  ])
  const files = buildFiles((employees ?? []) as Employee[], types, (items ?? []) as EmployeeItem[], settings)
  return { files, types, settings }
}
