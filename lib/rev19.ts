// ============================================================
// REV19 pricing engine — the twelve RPS cost categories, the per-line
// formulas the MATERIAL AND LABOR BREAKDOWN uses, and the roll-up the
// RP QUOTE TEMPLATE face prints. PURE module (no server imports).
//
// Face columns per category (what prints in the MATERIAL column vs LABOR):
//   1–4   taxable material:  (cost + cost×tax) × (1 + markup) + freight, × qty   → MATERIAL
//   5,9,10,12  cost-plus:    cost × (1 + markup if MARKUP?=Y), × qty              → MATERIAL
//   11    subcontractor:     cost × qty, then 15% sub markup on the category      → MATERIAL
//   6     lodging:           rate × qty (tech-nights)                              → MATERIAL
//   7     labor:             hours = men × hrs each; labor = rate × hours          → LABOR HOURS / RATE / TOTAL LABOR
//   8     mobilization:      tech-travel-days = travel days × techs; × $100        → MATERIAL
// Roll-up: taxable (1–4) → concrete/equipment/subs/disposal/permits (5+9+10+11+12)
//          → labor/mobilization/lodging (6+7+8) → subtotal → contingency → P&O → tax (0.00%) → grand total.
// ============================================================

export const REV19_CATEGORIES = [
  { n: 1,  name: 'ELECTRICAL SUPPLY',                                    short: 'Electrical',        kind: 'material'  as const, taxable: true },
  { n: 2,  name: 'HARD PIPE AND FITTINGS',                               short: 'Pipe & fittings',   kind: 'material'  as const, taxable: true },
  { n: 3,  name: 'ICON',                                                 short: 'ICON',              kind: 'material'  as const, taxable: true },
  { n: 4,  name: 'PUMP & TANK MATERIALS',                                short: 'Pump & tank',       kind: 'material'  as const, taxable: true },
  { n: 5,  name: 'CONCRETE / REBAR / BACKFILL AND CONCRETE DISPOSAL',    short: 'Concrete',          kind: 'costplus'  as const, taxable: false },
  { n: 6,  name: 'HOTEL LODGING / PER DIEM',                             short: 'Lodging',           kind: 'lodging'   as const, taxable: false },
  { n: 7,  name: 'RPS LABOR',                                            short: 'Labor',             kind: 'labor'     as const, taxable: false },
  { n: 8,  name: 'TRIP CHARGES / MOBILIZATION',                          short: 'Mobilization',      kind: 'trip'      as const, taxable: false },
  { n: 9,  name: 'RPS EQUIPMENT',                                        short: 'Equipment',         kind: 'costplus'  as const, taxable: false },
  { n: 10, name: 'MISC / DISPOSABLES / DOT BARRELS',                     short: 'Disposables',       kind: 'costplus'  as const, taxable: false },
  { n: 11, name: 'SUBCONTRACTOR',                                        short: 'Subcontractor',     kind: 'sub'       as const, taxable: false },
  { n: 12, name: 'TRADE PERMITS AND ONSITE INSPECTIONS',                 short: 'Permits',           kind: 'costplus'  as const, taxable: false },
] as const

export type Rev19Category = (typeof REV19_CATEGORIES)[number]['n']
export type Rev19Kind = (typeof REV19_CATEGORIES)[number]['kind']
export const categoryMeta = (n: number) => REV19_CATEGORIES.find(c => c.n === n) ?? REV19_CATEGORIES[3]
export const TAXABLE_CATS = [1, 2, 3, 4] as const
export const CONCRETE_EQUIP_CATS = [5, 9, 10, 11, 12] as const
export const LABOR_MOB_CATS = [6, 7, 8] as const

/** The four RPS labor rates. Schools and municipal = Independent. */
export const LABOR_RATES = [
  { brand: '7-Eleven',    rate: 78.50 },
  { brand: 'Global',      rate: 82.50 },
  { brand: 'Sunoco',      rate: 80.00 },
  { brand: 'Independent', rate: 95.00 },
] as const

export const REV19_DEFAULTS = {
  material_markup_pct: 0.20,
  material_tax_pct: 0.053,       // Virginia; Maryland/Sheetz 0.06; WV 0.06; schools/municipal 0
  sub_markup_pct: 0.15,
  contingency_pct: 0,
  profit_overhead_pct: 0,
  sales_tax_pct: 0,              // quote-level: always 0.00% (tax lives on the material line)
  mobilization_rate: 100,
  lodging_combined: 104.79,
  disposables_per_tech_day: 13.20,
  service_disposables_per_tech_day: 17.50,
}

export const TAX_PRESETS = [
  { label: 'Virginia 5.3%', value: 0.053 }, { label: 'Maryland 6%', value: 0.06 }, { label: 'West Virginia 6%', value: 0.06 },
  { label: 'Sheetz 6%', value: 0.06 }, { label: 'Exempt (schools / municipal / customer-furnished)', value: 0 },
]

export type PriceFlag = 'ok' | 'estimate' | 'price_needed' | 'held_high' | 'verify' | 'hours_needed'

export type Rev19LineInput = {
  section: 'basic' | 'additional'
  category: number
  line_no?: number | null
  description?: string | null
  part_number?: string | null
  part_id?: string | null
  subcategory?: string | null
  quantity?: number | null
  unit_cost?: number | null          // cost (cats 1–5, 9–12), rate (6, 7, 8)
  sales_tax_pct?: number | null      // cats 1–4 only; null = use document material_tax_pct
  markup_pct?: number | null         // cats 1–4 only; null = use document material_markup_pct
  freight_per_unit?: number | null
  markup_applies?: boolean | null    // cats 5,9,10,12
  men?: number | null                // cat 7
  hrs_each?: number | null           // cat 7
  labor_rate?: number | null         // cat 7 override; null = document labor_rate
  travel_days?: number | null        // cat 8
  techs?: number | null              // cat 8
  day_label?: string | null
  crew?: string | null               // 'construction' | 'service'
  source_note?: string | null
  price_flag?: PriceFlag | string | null
  is_stock?: boolean | null
  item_type?: string | null
  /** Legacy documents (imported before categories): print the stored numbers, never re-price. */
  fixed?: { sell_unit: number; material_total: number; labor_hours: number; labor_rate: number | null; total_labor: number } | null
}

export type Rev19Line = Rev19LineInput & {
  sell_unit: number
  quantity_effective: number         // qty, tech-nights, hours, or tech-travel-days depending on category
  material_total: number             // what the face prints in MATERIAL (0 for cat 7)
  labor_hours: number                // cat 7 only
  total_labor: number                // cat 7 only
  total_material_labor: number
}

export type Rev19Inputs = {
  material_markup_pct: number
  material_tax_pct: number
  sub_markup_pct: number
  labor_rate: number
  contingency_pct: number
  contingency_flat: number
  profit_overhead_pct: number
  sales_tax_pct: number              // quote-level, normally 0
}

export type SectionFace = {
  rows: { n: number; name: string; quantity: number; unit_cost: number | null; material: number; labor_hours: number; labor_rate: number | null; total_labor: number; total: number }[]
  subtotal_material: number
  subtotal_labor: number
  total: number
}

export type Rev19Totals = {
  basic: SectionFace
  additional: SectionFace
  category_totals: Record<number, number>
  taxable_material_total: number
  concrete_equipment_total: number
  labor_mobilization_total: number
  sub_markup_amount: number
  grand_total: number                // subtotal all categories, both sections
  contingency_amount: number
  profit_overhead_amount: number
  tax_amount: number
  final_total: number
  // legacy column names the tables still carry
  basic_subtotal_material: number; basic_subtotal_labor: number; basic_total: number
  additional_subtotal_material: number; additional_subtotal_labor: number; additional_total: number
}

const n = (v: number | null | undefined) => (typeof v === 'number' && isFinite(v) ? v : 0)
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100
const r4 = (v: number) => Math.round((v + Number.EPSILON) * 10000) / 10000

/** Sell price per unit for one line under the REV19 rules. */
export function sellUnit(l: Rev19LineInput, inp: Rev19Inputs): number {
  const cost = n(l.unit_cost)
  const kind = categoryMeta(l.category).kind
  switch (kind) {
    case 'material': {
      const tax = l.sales_tax_pct != null ? n(l.sales_tax_pct) : inp.material_tax_pct
      const mk = l.markup_pct != null ? n(l.markup_pct) : inp.material_markup_pct
      return r4((cost + cost * Math.max(0, tax)) * (1 + Math.max(0, mk)) + n(l.freight_per_unit))
    }
    case 'costplus': return r4(l.markup_applies ? cost * (1 + inp.material_markup_pct) : cost)
    case 'sub':      return r4(cost)                       // markup is applied once, on the category
    case 'lodging':  return r4(cost)
    case 'trip':     return r4(cost || REV19_DEFAULTS.mobilization_rate)
    case 'labor':    return r4(l.labor_rate != null && n(l.labor_rate) > 0 ? n(l.labor_rate) : inp.labor_rate)
  }
}

export function computeRev19Line(l: Rev19LineInput, inp: Rev19Inputs): Rev19Line {
  if (l.fixed) {
    const f = l.fixed
    return { ...l, sell_unit: f.sell_unit, quantity_effective: n(l.quantity), material_total: r2(f.material_total), labor_hours: r2(f.labor_hours), total_labor: r2(f.total_labor), total_material_labor: r2(f.material_total + f.total_labor) }
  }
  const kind = categoryMeta(l.category).kind
  const sell = sellUnit(l, inp)
  if (kind === 'labor') {
    const hours = r2(n(l.men) * n(l.hrs_each)) || n(l.quantity)     // quantity fallback for old lines
    const labor = r2(hours * sell)
    return { ...l, sell_unit: sell, quantity_effective: hours, material_total: 0, labor_hours: hours, total_labor: labor, total_material_labor: labor }
  }
  if (kind === 'trip') {
    const ttd = l.travel_days != null || l.techs != null ? r2(n(l.travel_days) * n(l.techs)) : n(l.quantity)
    const ext = r2(ttd * sell)
    return { ...l, sell_unit: sell, quantity_effective: ttd, material_total: ext, labor_hours: 0, total_labor: 0, total_material_labor: ext }
  }
  const qty = n(l.quantity)
  const ext = r2(qty * sell)
  return { ...l, sell_unit: sell, quantity_effective: qty, material_total: ext, labor_hours: 0, total_labor: 0, total_material_labor: ext }
}

/**
 * Which face column a line prints in. Materials (things RPS buys and pays tax on) go in
 * MATERIAL; services (labor, subs, equipment, lodging, mobilization, permits, disposal
 * fees) go in LABOR HOURS × LABOR RATE — the way the RP quote face has always read, and
 * the reason "SALES TAX (MATERIAL ONLY)" only touches the material column.
 * Category 5 is the one mixed bag: concrete / rebar / backfill carry markup and are
 * material; a disposal or tipping fee (no markup) is a service.
 */
export function isServiceLine(l: Rev19LineInput): boolean {
  const kind = categoryMeta(l.category).kind
  if (kind === 'material') return false
  if (l.category === 5) return !l.markup_applies
  if (l.category === 10) return false
  return true
}

/** Extended amount of one line as it prints on the face (category 11 carries the sub markup). */
const faceAmount = (l: Rev19Line, inp: Rev19Inputs) => r2(l.total_material_labor * (l.category === 11 ? 1 + inp.sub_markup_pct : 1))

function face(lines: Rev19Line[], section: 'basic' | 'additional', inp: Rev19Inputs): SectionFace {
  const rows: SectionFace['rows'] = []
  let subtotal_material = 0, subtotal_labor = 0
  for (const c of REV19_CATEGORIES) {
    const ls = lines.filter(l => l.section === section && l.category === c.n)
    if (!ls.length) continue
    const mat = ls.filter(l => !isServiceLine(l)), svc = ls.filter(l => isServiceLine(l))
    const material = r2(mat.reduce((a, l) => a + faceAmount(l, inp), 0))
    const total_labor = r2(svc.reduce((a, l) => a + faceAmount(l, inp), 0))
    const labor_hours = r2(svc.reduce((a, l) => a + (l.category === 7 ? l.labor_hours : l.quantity_effective), 0))
    // The face shows a quantity only where it means one thing: tech-nights, tech-travel-days, or a single-line category.
    const quantity = c.kind === 'lodging' || c.kind === 'trip' || ls.length === 1 ? r2(ls.reduce((a, l) => a + l.quantity_effective, 0)) : 0
    const unit_cost = c.kind === 'labor' ? null : ls.length === 1 ? ls[0].sell_unit : null
    const labor_rate = c.kind === 'labor' ? (labor_hours > 0 ? r2(total_labor / labor_hours) : inp.labor_rate) : svc.length === 1 && labor_hours > 0 ? r2(total_labor / labor_hours) : null
    rows.push({ n: c.n, name: c.name, quantity, unit_cost, material, labor_hours, labor_rate, total_labor, total: r2(material + total_labor) })
    subtotal_material = r2(subtotal_material + material)
    subtotal_labor = r2(subtotal_labor + total_labor)
  }
  return { rows, subtotal_material, subtotal_labor, total: r2(subtotal_material + subtotal_labor) }
}

export type FaceLineRow = {
  no: string; desc: string; header?: boolean; flag?: string | null
  qty: number | null; unit: number | null; material: number; hours: number | null; rate: number | null; labor: number; total: number
}

/**
 * The itemised face — one row per line, in the columns the RP quote template uses, with a
 * bold header row in front of each category (the workbook's "NOV Fiberglass material",
 * "Electrical material" rows). Rows are numbered straight through, headers included.
 */
export function faceLineRows(lines: Rev19Line[], section: 'basic' | 'additional', inp: Rev19Inputs): FaceLineRow[] {
  const out: FaceLineRow[] = []
  const cats = REV19_CATEGORIES.filter(c => lines.some(l => l.section === section && l.category === c.n))
  let no = 0
  for (const c of cats) {
    const ls = lines.filter(l => l.section === section && l.category === c.n)
    if (cats.length > 1 || ls.length > 1) out.push({ no: String(++no), desc: c.name, header: true, qty: null, unit: null, material: 0, hours: null, rate: null, labor: 0, total: 0 })
    for (const l of ls) {
      const amount = faceAmount(l, inp)
      const catMk = l.category === 11 ? 1 + inp.sub_markup_pct : 1
      const label = l.category === 7 ? [l.day_label, l.crew === 'service' ? 'SERVICE TECH' : null, l.description].filter(Boolean).join(' — ') || 'LABOR'
        : l.category === 8 ? ['MOBILIZATION', l.day_label, l.description].filter(Boolean).join(' — ')
        : [l.part_number && !(l.description ?? '').toUpperCase().startsWith(l.part_number.toUpperCase()) ? l.part_number : null, l.description].filter(Boolean).join(' - ')
      if (l.fixed) { out.push({ no: String(++no), desc: label, flag: l.price_flag, qty: l.quantity_effective || null, unit: l.unit_cost != null ? l.fixed.sell_unit : null, material: l.fixed.material_total, hours: l.fixed.labor_hours || null, rate: l.fixed.labor_rate, labor: l.fixed.total_labor, total: r2(l.fixed.material_total + l.fixed.total_labor) }); continue }
      if (isServiceLine(l)) {
        const hours = l.category === 7 ? l.labor_hours : l.quantity_effective
        out.push({ no: String(++no), desc: label, flag: l.price_flag, qty: null, unit: null, material: 0, hours: hours || null, rate: hours ? r2(amount / hours) : r4(l.sell_unit * catMk), labor: amount, total: amount })
      } else {
        out.push({ no: String(++no), desc: label, flag: l.price_flag, qty: l.quantity_effective || null, unit: r4(l.sell_unit * catMk), material: amount, hours: null, rate: null, labor: 0, total: amount })
      }
    }
  }
  return out
}

export function computeRev19(items: Rev19LineInput[], inp: Rev19Inputs): { lines: Rev19Line[]; totals: Rev19Totals } {
  const lines = items.map(l => computeRev19Line(l, inp))
  const basic = face(lines, 'basic', inp)
  const additional = face(lines, 'additional', inp)
  const category_totals: Record<number, number> = {}
  for (const c of REV19_CATEGORIES) {
    const t = r2((basic.rows.find(r => r.n === c.n)?.total ?? 0) + (additional.rows.find(r => r.n === c.n)?.total ?? 0))
    if (t) category_totals[c.n] = t
  }
  const sumCats = (cats: readonly number[]) => r2(cats.reduce((a, c) => a + (category_totals[c] ?? 0), 0))
  const taxable_material_total = sumCats(TAXABLE_CATS)
  const concrete_equipment_total = sumCats(CONCRETE_EQUIP_CATS)
  const labor_mobilization_total = sumCats(LABOR_MOB_CATS)
  const subRaw = r2(lines.filter(l => l.category === 11).reduce((a, l) => a + l.material_total, 0))
  const sub_markup_amount = r2(subRaw * inp.sub_markup_pct)
  const grand_total = r2(basic.total + additional.total)
  const contingency_amount = r2(grand_total * n(inp.contingency_pct) + n(inp.contingency_flat))
  const profit_overhead_amount = r2((grand_total + contingency_amount) * n(inp.profit_overhead_pct))
  const tax_amount = r2((basic.subtotal_material + additional.subtotal_material) * n(inp.sales_tax_pct))
  const final_total = r2(grand_total + contingency_amount + profit_overhead_amount + tax_amount)
  return {
    lines,
    totals: {
      basic, additional, category_totals, taxable_material_total, concrete_equipment_total, labor_mobilization_total, sub_markup_amount,
      grand_total, contingency_amount, profit_overhead_amount, tax_amount, final_total,
      basic_subtotal_material: basic.subtotal_material, basic_subtotal_labor: basic.subtotal_labor, basic_total: basic.total,
      additional_subtotal_material: additional.subtotal_material, additional_subtotal_labor: additional.subtotal_labor, additional_total: additional.total,
    },
  }
}

/** Old lines (pre-categories) mapped by item_type so historical invoices still roll up. */
export function categoryFromItemType(t: string | null | undefined): number {
  switch (t) { case 'labor': return 7; case 'trip': return 8; case 'equipment': return 9; case 'disposables': return 10; case 'sub': case 'service': return 11; case 'permit': return 12; case 'lodging': return 6; default: return 4 }
}

/** Reasonable per-line defaults when a category is chosen in the builder. */
export function defaultLineFor(category: number, crew: 'construction' | 'service' = 'construction'): Partial<Rev19LineInput> {
  switch (categoryMeta(category).kind) {
    case 'labor':   return { men: crew === 'service' ? 1 : 4, hrs_each: crew === 'service' ? 2 : 10, crew }
    case 'trip':    return { unit_cost: REV19_DEFAULTS.mobilization_rate, travel_days: 2, techs: 4, crew }
    case 'lodging': return { unit_cost: REV19_DEFAULTS.lodging_combined, quantity: 1 }
    default:        return { quantity: 1, markup_applies: false }
  }
}

export const PRICE_FLAG_LABEL: Record<string, string> = { ok: '', estimate: 'ESTIMATE — verify', price_needed: 'PRICE NEEDED', held_high: 'HELD HIGH', verify: 'VERIFY (price > 6 months)', hours_needed: 'HOURS NEEDED' }
