// ============================================================
// INVENTORY + PARTS CATALOG — pure helpers (no server imports).
// Shared by the Inventory module pages and, later, quote/ticket line pickers.
// ============================================================

export type Part = {
  id: string
  company_id: string
  sku: string | null
  part_number: string | null
  manufacturer: string | null
  description: string
  category: number | null
  category_name: string | null
  subcategory: string | null
  uom: string | null
  item_type: string | null
  taxable: boolean | null
  is_stocked: boolean | null
  unit_cost: number | null
  cost_source: string | null
  cost_vendor: string | null
  cost_invoice_ref: string | null
  cost_date: string | null
  price_status: 'ok' | 'price_needed' | 'verify' | 'held_high' | null
  freight_per_unit: number | null
  markup_pct: number | null
  sell_price: number | null
  last_cost: number | null
  avg_cost: number | null
  primary_vendor: string | null
  notes: string | null
  active: boolean | null
  updated_at: string | null
}

export type StockLocation = {
  id: string
  name: string
  kind: 'office' | 'truck' | 'jobsite' | 'vendor_rma' | 'customer_owned'
  department: 'construction' | 'service' | 'shared' | null
  asset_id: string | null
  active: boolean | null
}

/** REV19 twelve cost categories. Taxable = materials (1–4). */
export const PART_CATEGORIES = [
  { n: 1,  label: 'Electrical Supply',                       taxable: true },
  { n: 2,  label: 'Hard Pipe and Fittings',                  taxable: true },
  { n: 3,  label: 'ICON',                                    taxable: true },
  { n: 4,  label: 'Pump & Tank Materials',                   taxable: true },
  { n: 5,  label: 'Concrete / Rebar / Backfill / Disposal',  taxable: false },
  { n: 6,  label: 'Hotel Lodging / Per Diem',                taxable: false },
  { n: 7,  label: 'RPS Labor',                               taxable: false },
  { n: 8,  label: 'Trip Charges / Mobilization',             taxable: false },
  { n: 9,  label: 'RPS Equipment',                           taxable: false },
  { n: 10, label: 'Misc / Disposables / DOT Barrels',        taxable: false },
  { n: 11, label: 'Subcontractor',                           taxable: false },
  { n: 12, label: 'Trade Permits and Onsite Inspections',    taxable: false },
] as const

export function categoryLabel(n: number | null | undefined) {
  if (n == null) return 'Service ticket items'
  return PART_CATEGORIES.find(c => c.n === n)?.label ?? `Category ${n}`
}

export const PRICE_STATUS = {
  ok:           { label: 'Priced',        className: 'bg-green-100 text-green-700 border-green-200' },
  price_needed: { label: 'Price needed',  className: 'bg-pink-100 text-pink-700 border-pink-200' },
  verify:       { label: 'Verify',        className: 'bg-amber-100 text-amber-800 border-amber-200' },
  held_high:    { label: 'Held high',     className: 'bg-amber-100 text-amber-800 border-amber-200' },
} as const

export const COST_SOURCE_LABEL: Record<string, string> = {
  receipt: 'Receipt', vendor_quote: 'Vendor quote', book: 'Price book', web: 'Web price',
  estimate: 'Estimate', rate_card: 'Rate card', sell_billed: 'Billed on invoice',
}

export const SEED_TAG_LABEL: Record<string, string> = {
  REV19_LIBRARY: 'REV19 library', PRICE_BOOK: 'Price book', WEB_VERIFIED: 'Web verified 2026',
  SVC_INVOICES_2026: 'Service invoices 2026',
  SNA_7ELEVEN_2026: 'Source NA 7-Eleven list 2026',
}

export const LOCATION_KINDS = [
  { value: 'office',         label: 'Office / shelf' },
  { value: 'truck',          label: 'Truck' },
  { value: 'jobsite',        label: 'Job site' },
  { value: 'vendor_rma',     label: 'Vendor RMA' },
  { value: 'customer_owned', label: 'Customer owned' },
] as const

/** Price older than this many days is flagged for verification (RPS rule: 6 months). */
export const PRICE_STALE_DAYS = 183

export function priceAgeDays(costDate: string | null | undefined, now = new Date()) {
  if (!costDate) return null
  const d = new Date(costDate.slice(0, 10) + 'T00:00:00')
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000)
}

/** Standard RPS material markup (flat 20%, every supplier, every category). */
export const DEFAULT_MATERIAL_MARKUP = 0.20

/**
 * Sell price for one unit of a catalog part.
 *
 * Returns `null` when the part has no usable cost, so callers fall back to the
 * explicit `sell_price` column (used for service-ticket items whose cost we
 * do not know) or show "Price needed".
 *
 * Inputs: the part row, the sales-tax rate for the job's state as a decimal
 * (0.053 for Virginia, 0.06 for Sheetz / Maryland, 0 for schools and municipal)
 * and the markup as a decimal (defaults to the flat 20%).
 */
export function computeSellPrice(
  part: Pick<Part, 'unit_cost' | 'freight_per_unit' | 'taxable' | 'markup_pct' | 'sell_price'>,
  salesTaxRate: number,
  markup: number = DEFAULT_MATERIAL_MARKUP,
): number | null {
  // RPS line-price rule (quote builder REV19): (Cost + Tax) × (1 + Markup) + Freight per unit.
  // Tax is RPS's own cost on taxable material (categories 1–4), recovered through the markup,
  // never shown to the customer as a separate charge.
  const cost = part.unit_cost
  if (cost == null || !isFinite(cost) || cost <= 0) return null   // caller falls back to sell_price / "Price needed"
  const tax = part.taxable ? cost * Math.max(0, salesTaxRate || 0) : 0
  const mk = part.markup_pct != null && isFinite(part.markup_pct) ? part.markup_pct : markup
  const freight = part.freight_per_unit && isFinite(part.freight_per_unit) ? part.freight_per_unit : 0
  const sell = (cost + tax) * (1 + Math.max(0, mk)) + freight
  return Math.round((sell + Number.EPSILON) * 100) / 100
}

/** Sell price to put on a quote line: computed from cost when we have one, else the explicit sell price. */
export function sellPriceForLine(
  part: Pick<Part, 'unit_cost' | 'freight_per_unit' | 'taxable' | 'markup_pct' | 'sell_price'>,
  salesTaxRate: number,
  markup: number = DEFAULT_MATERIAL_MARKUP,
): number | null {
  return computeSellPrice(part, salesTaxRate, markup) ?? part.sell_price ?? null
}

export function money(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return '—'
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Roles that may add/edit catalog parts and post inventory movements. */
export const INVENTORY_WRITE_ROLES = ['owner', 'manager', 'shop_manager', 'parts_manager', 'construction_manager', 'estimator', 'service_tech', 'construction_tech']
export function canWriteInventory(role: string | null | undefined) {
  return !!role && INVENTORY_WRITE_ROLES.includes(role)
}
