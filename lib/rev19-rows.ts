// Builder row state and the conversions to/from saved line rows. Kept out of the
// client component so server pages can call rowsFromLines() when they load a document.
import { categoryMeta, defaultLineFor } from '@/lib/rev19'

export type Rev19Row = {
  key: string; section: 'basic' | 'additional'; category: number
  description: string; part_number: string; part_id: string | null; subcategory: string
  quantity: string; unit_cost: string; sales_tax_pct: string; markup_pct: string; freight_per_unit: string; markup_applies: boolean
  men: string; hrs_each: string; labor_rate: string; travel_days: string; techs: string; day_label: string; crew: 'construction' | 'service'
  source_note: string; price_flag: string; is_stock: boolean; item_type: string
}
let _k = 0
export function newRow(section: 'basic' | 'additional', category: number, crew: 'construction' | 'service' = 'construction'): Rev19Row {
  const d = defaultLineFor(category, crew)
  return {
    key: `r${_k++}_${Date.now()}`, section, category, description: '', part_number: '', part_id: null, subcategory: '',
    quantity: d.quantity != null ? String(d.quantity) : '', unit_cost: d.unit_cost != null ? String(d.unit_cost) : '', sales_tax_pct: '', markup_pct: '', freight_per_unit: '', markup_applies: !!d.markup_applies,
    men: d.men != null ? String(d.men) : '', hrs_each: d.hrs_each != null ? String(d.hrs_each) : '', labor_rate: '', travel_days: d.travel_days != null ? String(d.travel_days) : '', techs: d.techs != null ? String(d.techs) : '',
    day_label: '', crew, source_note: '', price_flag: 'ok', is_stock: false, item_type: categoryMeta(category).kind === 'labor' ? 'labor' : categoryMeta(category).kind === 'trip' ? 'trip' : 'material',
  }
}
/** Turn saved line rows back into builder state. */
export function rowsFromLines(items: Record<string, unknown>[]): Rev19Row[] {
  const S = (v: unknown) => (v == null ? '' : String(v))
  return items.map((it, i) => {
    const legacyLabor = Number(it.labor_hours) > 0 && it.unit_cost == null && it.men == null
    const cat = legacyLabor ? 7 : Number(it.category) || 4
    const base = newRow(it.section === 'additional' ? 'additional' : 'basic', cat, it.crew === 'service' ? 'service' : 'construction')
    return {
      ...base, key: `s${i}`, description: S(it.description), part_number: S(it.part_number), part_id: (it.part_id as string | null) ?? null, subcategory: S(it.subcategory),
      quantity: categoryMeta(cat).kind === 'labor' || categoryMeta(cat).kind === 'trip' ? '' : S(it.quantity), unit_cost: S(it.unit_cost),
      sales_tax_pct: it.sales_tax_pct != null ? String(Number(it.sales_tax_pct) * 100) : '', markup_pct: it.markup_pct != null ? String(Number(it.markup_pct) * 100) : '',
      freight_per_unit: it.freight_per_unit ? S(it.freight_per_unit) : '', markup_applies: !!it.markup_applies,
      men: S(it.men), hrs_each: S(it.hrs_each), labor_rate: it.category === 7 && it.men == null && it.labor_rate != null ? S(it.labor_rate) : '', travel_days: S(it.travel_days), techs: S(it.techs),
      day_label: S(it.day_label), source_note: S(it.source_note), price_flag: S(it.price_flag) || 'ok', is_stock: !!it.is_stock, item_type: S(it.item_type) || base.item_type,
      // legacy lines (no men/hrs) keep their hours via quantity fallback
      ...(cat === 7 && it.men == null && it.labor_hours != null ? { men: '1', hrs_each: S(it.labor_hours), labor_rate: S(it.labor_rate) } : {}),
      ...(cat === 8 && it.travel_days == null && it.quantity != null ? { travel_days: S(it.quantity), techs: '1' } : {}),
    }
  })
}
