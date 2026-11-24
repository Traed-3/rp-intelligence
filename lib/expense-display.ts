// What an expense was charged to, in the words the office uses.
//   truck / equipment  → its unit number            (Q17)
//   project            → the site it is for         (SU-7100)
//   store              → the store number           (40013)
//   everything else    → its overhead bucket, or "Shop Stock" (never "general")
// One place, so the expense list, the detail page, the receipts report and the CSV all agree.

export type ChargeKind = 'asset' | 'site' | 'overhead'
export type ChargedTo = { label: string; kind: ChargeKind }

export const SHOP_STOCK = 'Shop Stock'

/** Name for each `expenses.expense_type`, for filters and headings. */
export const EXPENSE_TYPE_LABEL: Record<string, string> = {
  asset: 'Truck / Asset',
  store: 'Store',
  project: 'Project',
  general: SHOP_STOCK,
}
export const expenseTypeLabel = (type: string | null | undefined) => EXPENSE_TYPE_LABEL[type ?? ''] ?? SHOP_STOCK

type Row = {
  expense_type?: string | null
  store_number?: string | null
  project_number?: string | null
  category_custom?: string | null
  assets?: { unit_number?: string | null } | null
  con_jobs?: { site_number?: string | null } | null
  expense_categories?: { name?: string | null } | null
}

const clean = (s: string | null | undefined) => (s ?? '').trim()
/** "shop stock" / "Shop stock" → "Shop Stock"; other buckets keep their own wording. */
const bucket = (s: string) => (/^shop\s*stock$/i.test(s) ? SHOP_STOCK : s)

export function chargedTo(e: Row): ChargedTo {
  if (e.expense_type === 'asset') {
    const unit = clean(e.assets?.unit_number)
    return { label: unit || 'Truck (no unit #)', kind: 'asset' }
  }
  if (e.expense_type === 'project' || e.expense_type === 'store') {
    // The site number is how people know the job (SU-7100); the job number (SU-7100-26) is the fallback.
    const site = clean(e.con_jobs?.site_number) || clean(e.store_number) || clean(e.project_number)
    if (site) return { label: site, kind: 'site' }
  }
  const b = clean(e.category_custom) || clean(e.expense_categories?.name)
  return { label: b ? bucket(b) : SHOP_STOCK, kind: 'overhead' }
}
