// ============================================================
// Shared BILLING engine — quotes & invoices for ANY operational
// department (Construction, Service, …). PURE module: no server
// imports, safe for both server pages and client components.
//
// This is the shared source of truth for line-item money math,
// quote/invoice statuses, and money/percent/date formatting.
// New departments (Service, …) import directly from '@/lib/billing'.
// lib/construction.ts re-exports these, so Construction and Service share one engine.
// ============================================================

// ── Quote / invoice statuses ────────────────────────────────
export const QUOTE_STATUSES = [
  { value: 'draft',    label: 'Draft',    className: 'bg-gray-100 text-gray-700 border-gray-200' },
  { value: 'sent',     label: 'Sent',     className: 'bg-blue-100 text-blue-800 border-blue-200' },
  { value: 'approved', label: 'Approved', className: 'bg-green-200 text-green-900 border-green-300' },
  { value: 'rejected', label: 'Rejected', className: 'bg-red-100 text-red-800 border-red-200' },
] as const

// RPS does not run accounts receivable here. Once a job is invoiced it is revenue and
// accounting takes it from there — so there is no "paid" to chase and nothing goes overdue.
// The stored value stays 'sent' (the DB check constraint predates this) but reads as Invoiced.
export const INVOICE_STATUSES = [
  { value: 'draft', label: 'Draft',    className: 'bg-gray-100 text-gray-700 border-gray-200' },
  { value: 'sent',  label: 'Invoiced', className: 'bg-green-200 text-green-900 border-green-300' },
  { value: 'void',  label: 'Void',     className: 'bg-gray-100 text-gray-400 border-gray-200' },
] as const

export function statusMeta(
  list: ReadonlyArray<{ value: string; label: string; className: string }>,
  value: string,
) {
  return list.find(s => s.value === value) ?? list[0]
}

// ── Money math (recomputed server-side; never trust the client) ──
export type LineItemInput = {
  section: 'basic' | 'additional'
  line_no?: number | null
  description?: string | null
  quantity?: number | null
  unit_cost?: number | null
  labor_hours?: number | null
  labor_rate?: number | null
  item_type?: string | null
  is_stock?: boolean
  part_id?: string | null        // catalog part this line was picked from (Inventory module)
  part_number?: string | null
}

export type ComputedLineItem = LineItemInput & {
  material_total: number
  total_labor: number
  total_material_labor: number
}

export type DocumentTotals = {
  basic_subtotal_material: number
  basic_subtotal_labor: number
  basic_total: number
  additional_subtotal_material: number
  additional_subtotal_labor: number
  additional_total: number
  grand_total: number
  profit_overhead_amount: number
  tax_amount: number
  final_total: number
}

const n = (v: number | null | undefined) => (typeof v === 'number' && isFinite(v) ? v : 0)
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

/** Compute the per-line material/labor totals for one line item. */
export function computeLineItem(item: LineItemInput): ComputedLineItem {
  const material_total = round2(n(item.quantity) * n(item.unit_cost))
  const total_labor = round2(n(item.labor_hours) * n(item.labor_rate))
  return {
    ...item,
    material_total,
    total_labor,
    total_material_labor: round2(material_total + total_labor),
  }
}

/**
 * Compute every subtotal + total for a quote/invoice from its line items.
 * `profitOverheadPercent` and `salesTaxPercent` are decimals (0.06 = 6%).
 * Sales tax applies to MATERIAL subtotals only.
 */
export function computeDocumentTotals(
  items: LineItemInput[],
  profitOverheadPercent: number,
  salesTaxPercent: number,
): { totals: DocumentTotals; lines: ComputedLineItem[] } {
  const lines = items.map(computeLineItem)

  const sum = (section: 'basic' | 'additional', key: 'material_total' | 'total_labor') =>
    round2(lines.filter(l => l.section === section).reduce((acc, l) => acc + l[key], 0))

  const basic_subtotal_material = sum('basic', 'material_total')
  const basic_subtotal_labor = sum('basic', 'total_labor')
  const basic_total = round2(basic_subtotal_material + basic_subtotal_labor)

  const additional_subtotal_material = sum('additional', 'material_total')
  const additional_subtotal_labor = sum('additional', 'total_labor')
  const additional_total = round2(additional_subtotal_material + additional_subtotal_labor)

  const grand_total = round2(basic_total + additional_total)
  const profit_overhead_amount = round2(grand_total * n(profitOverheadPercent))
  const tax_amount = round2((basic_subtotal_material + additional_subtotal_material) * n(salesTaxPercent))
  const final_total = round2(grand_total + profit_overhead_amount + tax_amount)

  return {
    lines,
    totals: {
      basic_subtotal_material,
      basic_subtotal_labor,
      basic_total,
      additional_subtotal_material,
      additional_subtotal_labor,
      additional_total,
      grand_total,
      profit_overhead_amount,
      tax_amount,
      final_total,
    },
  }
}

// ── Formatting ──────────────────────────────────────────────
export function money(v: number | null | undefined) {
  return (n(v)).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function pctFromDecimal(v: number | null | undefined) {
  return round2(n(v) * 100)
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  // date-only strings: render without TZ shifting
  const parts = d.slice(0, 10).split('-')
  if (parts.length === 3) {
    const [y, m, day] = parts.map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// ── Departments that can bill (quotes + invoices) ───────────
export const BILLING_DEPARTMENTS = [
  { value: 'construction', label: 'Construction' },
  { value: 'service',      label: 'Service' },
] as const

export type BillingDepartment = (typeof BILLING_DEPARTMENTS)[number]['value']

// ── Who can see / edit quotes and invoices (shared by Construction and Service) ──
// The Construction allowlist (lib/construction.ts) is OR'ed in by lib/billing-guard.ts.
export const BILLING_READ_ROLES  = ['owner', 'manager', 'construction_manager', 'estimator', 'office_staff', 'viewer'] as const
export const BILLING_WRITE_ROLES = ['owner', 'manager', 'construction_manager', 'estimator', 'office_staff'] as const
