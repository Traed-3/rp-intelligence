/**
 * What a Construction job has cost: materials ordered, other job expenses, and labor.
 *
 * Nobody types materials in by hand, so the job page used to show "No materials listed" and a $0 cost on
 * jobs with thousands of dollars of orders. Everything needed is already in the system:
 *
 *   expenses                 one row per receipt / vendor invoice charged to the job (con_job_id)
 *   billing_inbox_documents  the paper itself, read line by line (vendor invoices, packing slips, receipts),
 *                            tied to the job by con_job_id (migration job_purchase_links.sql)
 *   con_job_materials        materials typed in on the job (still counted)
 *   svc_work_order_documents the crew's field tickets for the job (on-site hours x crew size)
 *   con_daily_update_techs   hours per tech on a daily update
 *   con_job_labor            the manual labor log on the Cost Summary tab
 *
 * buildJobCosts() is pure (tests/job-costs.test.ts). loadJobCosts() / loadAllJobCosts() fetch the rows.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { safeReceiptUrl } from '@/lib/receipt-url'

type Admin = ReturnType<typeof createAdminClient>

// ───────────────────────────────────────────── rows as they come from the database

export type ExpenseRow = {
  id: string
  con_job_id: string | null
  expense_date: string | null
  amount: number | string | null
  description: string | null
  vendor: string | null
  category_custom: string | null
  payment_method_code: string | null
  receipt_url: string | null
  source_document_id: string | null
  expense_categories?: { name: string | null } | null
}

export type InboxLine = {
  qty?: number | null
  part_number?: string | null
  description?: string | null
  unit_cost?: number | null
  line_total?: number | null
  backordered?: boolean | null
}

export type InboxDocRow = {
  id: string
  con_job_id: string | null
  inbox: string
  kind: string | null
  vendor: string | null
  reference: string | null
  subject: string | null
  document_date: string | null
  received_at: string
  status: string | null
  extracted: {
    total?: number | null; vendor?: string | null; reference?: string | null; document_date?: string | null
    po_or_job?: string | null; freight?: number | null; tax?: number | null; lines?: InboxLine[] | null
  } | null
}

export type ManualMaterialRow = {
  id: string
  job_id: string
  description: string | null
  part_number: string | null
  quantity: number | string | null
  unit_cost: number | string | null
  status: string | null
  vendor: string | null
  ordered_date: string | null
}

export type TicketRow = {
  id: string
  con_job_id: string | null
  work_date: string | null
  received_at: string | null
  sender_email?: string | null
  technician: string | null
  helper: string | null
  onsite_hours: number | string | null
  crew_size: number | string | null
}

export type DailyTechRow = { job_id: string; work_date: string | null; tech_name: string | null; hours: number | string | null }
export type ManualLaborRow = { id: string; job_id: string; work_date: string | null; crew_member: string | null; hours: number | string | null; labor_rate: number | string | null; task_note: string | null }

// ───────────────────────────────────────────── what the page shows

export type PurchaseLine = { qty: number | null; partNumber: string | null; description: string; unitCost: number | null; lineTotal: number | null; backordered: boolean }

export type PurchaseGroup = 'material' | 'other'

export type Purchase = {
  key: string
  /** where it came from */
  source: 'vendor_invoice' | 'receipt' | 'packing_slip' | 'expense' | 'manual'
  group: PurchaseGroup
  /** "Materials", "Lodging", "Permits & inspections", "Subcontractor", "Disposal & pump-out", "Fuel", "Meals", "Rental", "Other" */
  label: string
  vendor: string | null
  reference: string | null
  date: string | null
  description: string
  /** dollars counted in the Cost Summary; null = no total on the paper (a packing slip with no invoice yet) */
  amount: number | null
  /** a packing slip came in for it */
  received: boolean
  lines: PurchaseLine[]
  expenseId: string | null
  documentId: string | null
  receiptUrl: string | null
  notes: string[]
  /** what it would go on the invoice for: cost plus the markup (parts +20%, everything else +15%) */
  billed: number | null
  markupPct: number
}

export type LaborDay = {
  date: string | null
  who: string
  manHours: number
  /** "Field ticket", "Daily update", "Labor log" */
  source: string
  rate: number | null
  cost: number
  manualId: string | null
  note: string | null
  /** people on site that day (a trip is billed per tech per day) */
  crew: number
}

/**
 * What the job would bill at time and material, the way Starsky builds an invoice (Trae, 11/25/26: the Cost
 * Summary is a sneak peek at the invoice). Labor = man-hours x the customer's rate; one trip per tech per day;
 * one disposables line for the job; manufacturer parts at cost +20%, everything else at cost +15%.
 */
export type InvoicePreview = {
  laborRate: number | null
  tripRate: number | null
  labor: number
  tripCount: number
  trips: number
  disposables: number
  materialsCost: number
  materials: number
  otherCost: number
  other: number
  total: number
}

/** Starsky's rates on finished invoices (same table as ~/rps-jobs/jobctl.py RATES). */
export const INVOICE_RATES: Record<string, { labor: number; trip: number }> = {
  '7-Eleven': { labor: 78, trip: 102.5 },
  Sunoco: { labor: 80, trip: 120 },
  Global: { labor: 82.5, trip: 82.5 },
  Wawa: { labor: 78, trip: 102.5 },
  Independent: { labor: 95, trip: 110 },
}
export const PART_MARKUP = 0.2
export const OTHER_MARKUP = 0.15

/** Vendors that sell manufacturer-numbered parts (billed at cost +20%); hardware, fittings and supplies are +15%. */
const PARTS_VENDOR = /\b(icon|source|sna|spatco|habhegger|opw|veeder|franklin|fe petro|gilbarco|wayne|dover|emco|fibrelite|universal valve|morrison|husky|red jacket|omntec|pmp|guardian|national petroleum|jf petroleum|petroleum equipment)\b/i

/** One disposables line per job, sized by the job: $17.50 small, $35 bigger, $75 big multi-day. */
export function disposablesFor(manHours: number, days: number): number {
  if (manHours <= 0) return 0
  if (manHours <= 12) return 17.5
  if (manHours <= 60 && days <= 3) return 35
  return 75
}

export type JobCosts = {
  purchases: Purchase[]
  materials: Purchase[]
  others: Purchase[]
  materialCost: number
  otherCost: number
  otherByLabel: { label: string; amount: number; count: number }[]
  /** packing slips with no invoice or receipt yet: ordered, cost not known */
  unpricedOrders: number
  labor: LaborDay[]
  laborHours: number
  laborCost: number
  /** the hourly figure labor was worked out at, and where it came from */
  laborRate: number | null
  laborRateSource: 'company' | 'billing' | 'none'
  totalCost: number
  invoice: InvoicePreview
}

// ───────────────────────────────────────────── small helpers

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v)) || 0
const numOrNull = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const cents = (v: number) => Math.round(v * 100)
const round2 = (v: number) => Math.round(v * 100) / 100
const clean = (s: string | null | undefined) => (s ?? '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()

const REPLY = /^\s*(?:(?:re|fwd?|fw)\s*:\s*)+/i
const AMOUNT = /^\s*(-?)\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2})[oO]?)?\s*(-)?(?=[\s,\-–]|$)/
const CODE = /^[\s,\-–]*([A-Za-z][A-Za-z&]{1,5})(?=[\s,\-–.]|$)[\s,\-–]*/

/** "1,638.37 ICN for SU-8001 product line fittings" → { amount: 1638.37, rest: "SU-8001 product line fittings" } */
export function subjectAmount(subject: string | null | undefined): { amount: number | null; rest: string; isReply: boolean } {
  const raw = clean(subject)
  const isReply = REPLY.test(raw)
  let rest = raw.replace(REPLY, '')
  const m = rest.match(AMOUNT)
  if (!m) return { amount: null, rest, isReply }
  const after = rest.slice(m[0].length)
  const c = after.match(CODE)
  const hasCode = !!c && /^[A-Z&]{2,6}$/.test(c[1])
  // "28960 SOURCE PACKING SLIP" starts with a store number, not $28,960: a whole number only counts as money
  // when it is short and a payment code follows it ("175 TEC SU-14765"), or it is written "265-11".
  const cents2 = m[3] == null ? after.match(/^-(\d{2})(?=\s)/) : null
  if (m[3] == null && !m[2].includes(',') && !cents2 && !(hasCode && m[2].length <= 4)) return { amount: null, rest, isReply }
  const n = Number(`${m[2].replace(/,/g, '')}.${m[3] ?? cents2?.[1] ?? '0'}`)
  rest = cents2 ? after.slice(cents2[0].length) : after
  const c2 = rest.match(CODE)
  if (c2 && /^[A-Z&]{2,6}$/.test(c2[1])) rest = rest.slice(c2[0].length)
  return { amount: m[1] === '-' || m[4] === '-' ? -n : n, rest: rest.replace(/^for\s+/i, '').trim(), isReply }
}

/** Order / invoice numbers on a reference: "SU-12080 / S.O. 54298" → ["54298"] (site numbers and POs left out by the caller). */
export function refTokens(reference: string | null | undefined): string[] {
  const out = new Set<string>()
  for (const m of clean(reference).toUpperCase().matchAll(/(?<![A-Z0-9])(\d{4,}[A-Z]?)(?![A-Z0-9])/g)) out.add(m[1])
  return [...out]
}

const vendorKey = (v: string | null | undefined) => (clean(v).toLowerCase().match(/[a-z0-9]+/g) ?? []).slice(0, 1).join('')

const OTHER_RULES: { label: string; re: RegExp }[] = [
  { label: 'Lodging', re: /\b(hotel|motel|lodging|inn|suites?|marriott|hilton|hampton|holiday inn|comfort|la quinta|best western|super 8|days inn|residence|courtyard|fairfield|airbnb)\b/i },
  { label: 'Permits & inspections', re: /\b(permit|permits|inspection|zoning|plan review|fire marshal)\b/i },
  { label: 'Subcontractor', re: /\b(electrical|electric(?:ian)?|subcontract(?:or)?|sub work|saw ?cut(?:ting)?|paving|vac(?:uum)? truck|crane|traffic control)\b/i },
  { label: 'Disposal & pump-out', re: /\b(pump ?out|drum pick ?up|drum disposal|disposal|dumpster|trash|landfill|roll ?off|haul(?:ing)?)\b/i },
  { label: 'Fuel', re: /\b(fuel|diesel|gasoline|def)\b/i },
  { label: 'Meals', re: /\b(meal|meals|lunch|dinner|breakfast|per diem|food)\b/i },
  { label: 'Rental', re: /\b(rental|rent|rented|sunbelt|united rentals|herc)\b/i },
  { label: 'Tolls & parking', re: /\b(toll|tolls|parking|ez ?pass)\b/i },
]

/** Is this a purchase of material, or another cost of doing the job (hotel, permit, electrician, pump-out)? */
export function classifyPurchase(text: string, hasMaterialLines = false): { group: PurchaseGroup; label: string } {
  const t = clean(text)
  for (const r of OTHER_RULES) {
    // "trash bags" on a hardware receipt is material; a vendor's part lines win over a stray word.
    if (r.re.test(t)) {
      if (r.label === 'Disposal & pump-out' && /\btrash bags?\b/i.test(t) && !/\b(pump ?out|drum|dumpster|landfill|roll ?off)\b/i.test(t)) continue
      if (r.label === 'Fuel' && /\bfuel (ties|hose|filter|nozzle|line)\b/i.test(t)) continue
      if (hasMaterialLines && (r.label === 'Fuel' || r.label === 'Rental' || r.label === 'Meals')) continue
      return { group: 'other', label: r.label }
    }
  }
  return { group: 'material', label: 'Materials' }
}

function linesOf(doc: InboxDocRow | undefined): PurchaseLine[] {
  const raw = doc?.extracted?.lines
  if (!Array.isArray(raw)) return []
  return raw
    .map((l) => ({
      qty: numOrNull(l?.qty),
      partNumber: clean(l?.part_number) || null,
      description: clean(l?.description),
      unitCost: numOrNull(l?.unit_cost),
      lineTotal: numOrNull(l?.line_total),
      backordered: !!l?.backordered,
    }))
    .filter((l) => l.description || l.partNumber)
}

const docDate = (d: InboxDocRow): string => {
  const emailed = new Date(new Date(d.received_at).getTime() - 5 * 3_600_000).toISOString().slice(0, 10)
  const read = d.extracted?.document_date ?? d.document_date
  if (read && /^\d{4}-\d{2}-\d{2}/.test(read)) {
    const diff = (Date.parse(emailed) - Date.parse(read.slice(0, 10))) / 86_400_000
    if (diff >= -2 && diff <= 120) return read.slice(0, 10)
  }
  return emailed
}

const PURCHASE_KINDS = new Set(['vendor_invoice', 'receipt', 'packing_slip'])

export type BuildInput = {
  expenses: ExpenseRow[]
  docs: InboxDocRow[]
  manualMaterials: ManualMaterialRow[]
  tickets: TicketRow[]
  dailyTechs: DailyTechRow[]
  manualLabor: ManualLaborRow[]
  /** numbers that are the job's own site / PO, never an order number */
  ignoreRefs?: string[]
  companyLaborRate?: number | null
  billingLaborRate?: number | null
  /** what a trip bills at per tech per day for this customer */
  tripRate?: number | null
}

/** Everything a single job cost, from the rows that belong to it. */
export function buildJobCosts(input: BuildInput): JobCosts {
  const ignore = new Set((input.ignoreRefs ?? []).map((s) => s.replace(/\D/g, '')).filter(Boolean))
  const tokensOf = (ref: string | null | undefined) => refTokens(ref).filter((t) => !ignore.has(t.replace(/\D/g, '')))
  const docsById = new Map(input.docs.map((d) => [d.id, d]))
  type Draft = Omit<Purchase, 'billed' | 'markupPct'> & { tokens: string[]; vkey: string }
  const purchases: Draft[] = []

  // 1. Money charged to the job (receipts and vendor invoices already in Expenses).
  const docsWithExpense = new Set<string>()
  for (const e of input.expenses) {
    const doc = e.source_document_id ? docsById.get(e.source_document_id) : undefined
    if (doc) docsWithExpense.add(doc.id)
    const lines = linesOf(doc)
    const vendor = clean(e.vendor ?? doc?.extracted?.vendor ?? doc?.vendor) || null
    // "265-11 TEC UNISTRUT NUTS" was once filed with "-11 TEC " left on the front of the wording.
    const description = clean(e.description).replace(/^-\d{2}\s+[A-Z&]{2,6}\s+/, '') || subjectAmount(doc?.subject).rest || 'Purchase'
    const reference = clean(doc?.extracted?.reference ?? doc?.reference) || null
    const cat = clean(e.expense_categories?.name ?? e.category_custom)
    const cls = classifyPurchase(`${description} ${vendor ?? ''} ${cat}`, lines.some((l) => l.partNumber))
    purchases.push({
      key: `e:${e.id}`,
      source: doc?.kind === 'vendor_invoice' ? 'vendor_invoice' : doc ? 'receipt' : 'expense',
      ...cls,
      vendor, reference,
      date: e.expense_date ?? (doc ? docDate(doc) : null),
      description,
      amount: num(e.amount),
      received: false,
      lines,
      expenseId: e.id,
      documentId: doc?.id ?? null,
      // only a link to our own receipts storage is ever put in a page
      receiptUrl: safeReceiptUrl(e.receipt_url),
      notes: [],
      tokens: tokensOf(reference),
      vkey: vendorKey(vendor),
    })
  }

  // 2. Paperwork tied to the job that never became an expense (older months, packing slips).
  const handKeyed = input.expenses.filter((e) => !e.source_document_id)
  const slips: Draft[] = []
  for (const d of input.docs) {
    if (docsWithExpense.has(d.id) || !PURCHASE_KINDS.has(d.kind ?? '') || d.status === 'dismissed') continue
    const subj = subjectAmount(d.subject)
    const lines = linesOf(d)
    const vendor = clean(d.extracted?.vendor ?? d.vendor) || null
    const reference = clean(d.extracted?.reference ?? d.reference) || null
    const date = docDate(d)
    const total = numOrNull(d.extracted?.total)
    const isSlip = d.kind === 'packing_slip'
    // A packing slip carries a charge only when the crew wrote one in the subject ("284.15 NOL …" on an account order).
    const amount = isSlip ? (subj.amount && subj.amount !== 0 ? subj.amount : null) : (subj.amount ?? total)
    const description = subj.rest && !/^(re|fwd?)\b/i.test(subj.rest) ? subj.rest : lines[0]?.description || clean(d.subject) || 'Purchase'
    const row = {
      key: `d:${d.id}`,
      source: (isSlip ? 'packing_slip' : d.kind === 'vendor_invoice' ? 'vendor_invoice' : 'receipt') as Purchase['source'],
      ...classifyPurchase(`${description} ${vendor ?? ''}`, lines.some((l) => l.partNumber)),
      vendor, reference, date, description,
      amount: amount && amount !== 0 ? amount : null,
      received: isSlip,
      lines,
      expenseId: null,
      documentId: d.id,
      receiptUrl: null,
      notes: [] as string[],
      tokens: tokensOf(reference),
      vkey: vendorKey(vendor),
    }
    if (row.amount == null) { slips.push(row); continue }
    // Already keyed in by hand as an expense on this job: same money within a few days.
    if (handKeyed.some((e) => cents(num(e.amount)) === cents(row.amount!) && e.expense_date && Math.abs(Date.parse(e.expense_date) - Date.parse(date)) <= 4 * 86_400_000)) continue
    purchases.push(row)
  }

  // 3. The same paper sent in twice is one purchase.
  const sameOrder = (a: { tokens: string[]; vkey: string }, b: { tokens: string[]; vkey: string }) =>
    a.tokens.length > 0 && a.tokens.some((t) => b.tokens.includes(t)) && (!a.vkey || !b.vkey || a.vkey === b.vkey)
  const kept: typeof purchases = []
  for (const p of purchases.sort((a, b) => Number(!!b.expenseId) - Number(!!a.expenseId))) {
    const twin = kept.find((k) => k.amount != null && p.amount != null && Math.abs(k.amount - p.amount) <= 1
      // the same order / receipt number; or, when neither paper shows a number, the same vendor, day and wording.
      // (Three hotel rooms on one night are three receipts with three numbers: all three count.)
      && (sameOrder(k, p) || (!k.tokens.length && !p.tokens.length && k.vkey === p.vkey && k.date === p.date && k.description.toLowerCase() === p.description.toLowerCase())))
    if (twin) {
      if (!twin.notes.includes('Sent in twice, counted once')) twin.notes.push('Sent in twice, counted once')
      if (!twin.lines.length && p.lines.length) twin.lines = p.lines
      continue
    }
    kept.push(p)
  }

  // 4. Packing slips: mark the invoice they belong to as received; a slip with no invoice yet is an order with no cost.
  const openSlips: typeof slips = []
  for (const s of slips) {
    const match = kept.find((k) => sameOrder(k, s))
    if (match) {
      match.received = true
      if (!match.lines.length && s.lines.length) match.lines = s.lines
      continue
    }
    const same = openSlips.find((o) => sameOrder(o, s) || (!s.tokens.length && o.vkey === s.vkey && o.date === s.date))
    if (same) { if (s.lines.length > same.lines.length) same.lines = s.lines; continue }
    s.group = 'material'; s.label = 'Materials'
    s.notes.push('Packing slip only: no invoice or receipt with a total yet')
    openSlips.push(s)
  }

  // 5. Materials typed in on the job.
  const manual: typeof purchases = input.manualMaterials.map((m) => {
    const qty = numOrNull(m.quantity), unit = numOrNull(m.unit_cost)
    const counts = ['ordered', 'received', 'in_stock'].includes(m.status ?? '')
    const amount = counts && qty != null && unit != null ? round2(qty * unit) : null
    return {
      key: `m:${m.id}`, source: 'manual' as const, group: 'material' as const, label: 'Materials',
      vendor: clean(m.vendor) || null, reference: null, date: m.ordered_date, description: clean(m.description) || 'Material',
      amount, received: m.status === 'received' || m.status === 'in_stock',
      lines: [{ qty, partNumber: clean(m.part_number) || null, description: clean(m.description), unitCost: unit, lineTotal: amount, backordered: false }],
      expenseId: null, documentId: null, receiptUrl: null,
      notes: [counts ? 'Typed in on the job' : `Typed in on the job (${m.status ?? 'needed'}: not counted yet)`],
      tokens: [], vkey: vendorKey(m.vendor),
    }
  })

  const all: Purchase[] = [...kept, ...openSlips, ...manual]
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .map(({ tokens: _t, vkey: _v, ...p }) => {
      const pct = p.group === 'material' && PARTS_VENDOR.test(p.vendor ?? '') ? PART_MARKUP : OTHER_MARKUP
      return { ...p, markupPct: pct, billed: p.amount == null ? null : round2(p.amount * (1 + pct)) }
    })

  const materials = all.filter((p) => p.group === 'material')
  const others = all.filter((p) => p.group === 'other')
  const materialCost = round2(materials.reduce((a, p) => a + (p.amount ?? 0), 0))
  const otherCost = round2(others.reduce((a, p) => a + (p.amount ?? 0), 0))
  const byLabel = new Map<string, { label: string; amount: number; count: number }>()
  for (const p of others) {
    const cur = byLabel.get(p.label) ?? { label: p.label, amount: 0, count: 0 }
    cur.amount = round2(cur.amount + (p.amount ?? 0)); cur.count++
    byLabel.set(p.label, cur)
  }

  // ── Labor
  const companyRate = input.companyLaborRate && input.companyLaborRate > 0 ? input.companyLaborRate : null
  const billingRate = input.billingLaborRate && input.billingLaborRate > 0 ? input.billingLaborRate : null
  const rate = companyRate ?? billingRate
  const labor: LaborDay[] = []
  const ticketDays = new Set<string>()
  const seenTickets = new Set<string>()
  // The office forwards a tech's ticket on from the invoicing mailbox, so the same ticket is often on file twice,
  // with the names and crew size read a little differently each time. Same job, same day, same hours on site
  // = the same ticket; the tech's own email is the one that counts.
  const fromOffice = (t: TicketRow) => /^rpinvoicing@/i.test(t.sender_email ?? '')
  const tickets = [...input.tickets].sort((a, b) => Number(fromOffice(a)) - Number(fromOffice(b)) || (a.received_at ?? '').localeCompare(b.received_at ?? ''))
  for (const t of tickets) {
    const hours = num(t.onsite_hours)
    if (hours <= 0) continue
    const date = t.work_date ?? (t.received_at ? t.received_at.slice(0, 10) : null)
    const crew = Math.max(1, Math.round(num(t.crew_size)) || 1)
    const who = [clean(t.technician), clean(t.helper)].filter(Boolean).join(' + ') || 'Crew'
    const dup = `${date}|${hours}`
    if (seenTickets.has(dup)) continue
    seenTickets.add(dup)
    if (date) ticketDays.add(date)
    const manHours = round2(hours * crew)
    labor.push({ date, who: crew > 1 ? `${who} (crew of ${crew})` : who, manHours, source: 'Field ticket', rate, cost: round2(manHours * (rate ?? 0)), manualId: null, note: crew > 1 ? `${hours} hr on site x ${crew}` : null, crew })
  }
  for (const d of input.dailyTechs) {
    const hours = num(d.hours)
    if (hours <= 0 || (d.work_date && ticketDays.has(d.work_date))) continue
    labor.push({ date: d.work_date, who: clean(d.tech_name) || 'Crew', manHours: hours, source: 'Daily update', rate, cost: round2(hours * (rate ?? 0)), manualId: null, note: null, crew: 1 })
  }
  for (const l of input.manualLabor) {
    const hours = num(l.hours)
    const own = numOrNull(l.labor_rate)
    const r = own && own > 0 ? own : rate
    labor.push({ date: l.work_date, who: clean(l.crew_member) || '—', manHours: hours, source: 'Labor log', rate: r, cost: round2(hours * (r ?? 0)), manualId: l.id, note: clean(l.task_note) || null, crew: 0 })
  }
  labor.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  const laborHours = round2(labor.reduce((a, l) => a + l.manHours, 0))
  const laborCost = round2(labor.reduce((a, l) => a + l.cost, 0))

  // ── What it would bill for. Trips: one per tech per day (two tickets on one day are the same men, so the
  // bigger crew counts; daily-update techs are one each).
  const crewByDay = new Map<string, { ticket: number; techs: number }>()
  for (const l of labor) {
    if (!l.date || l.crew <= 0) continue
    const d = crewByDay.get(l.date) ?? { ticket: 0, techs: 0 }
    if (l.source === 'Field ticket') d.ticket = Math.max(d.ticket, l.crew); else d.techs += l.crew
    crewByDay.set(l.date, d)
  }
  const tripCount = [...crewByDay.values()].reduce((a, d) => a + Math.max(d.ticket, d.techs), 0)
  const tripRate = input.tripRate && input.tripRate > 0 ? input.tripRate : null
  const billRate = billingRate ?? rate
  const invLabor = round2(labor.reduce((a, l) => a + l.manHours * ((l.source === 'Labor log' ? l.rate : billRate) ?? 0), 0))
  const invTrips = round2(tripCount * (tripRate ?? 0))
  const invDisp = disposablesFor(laborHours, crewByDay.size)
  const invMaterials = round2(materials.reduce((a, p) => a + (p.billed ?? 0), 0))
  const invOther = round2(others.reduce((a, p) => a + (p.billed ?? 0), 0))
  const invoice: InvoicePreview = {
    laborRate: billRate, tripRate, labor: invLabor, tripCount, trips: invTrips, disposables: invDisp,
    materialsCost: materialCost, materials: invMaterials, otherCost, other: invOther,
    total: round2(invLabor + invTrips + invDisp + invMaterials + invOther),
  }

  return {
    invoice,
    purchases: all, materials, others, materialCost, otherCost,
    otherByLabel: [...byLabel.values()].sort((a, b) => b.amount - a.amount),
    unpricedOrders: openSlips.length,
    labor, laborHours, laborCost,
    laborRate: rate, laborRateSource: companyRate ? 'company' : billingRate ? 'billing' : 'none',
    totalCost: round2(materialCost + otherCost + laborCost),
  }
}

// ───────────────────────────────────────────── loading

const EXPENSE_COLS = 'id, con_job_id, expense_date, amount, description, vendor, category_custom, payment_method_code, receipt_url, source_document_id, expense_categories(name)'
const DOC_COLS = 'id, con_job_id, inbox, kind, vendor, reference, subject, document_date, received_at, status, extracted'
const TICKET_COLS = 'id, con_job_id, work_date, received_at, sender_email, technician, helper, onsite_hours, crew_size'

/** Reads every page of a query (Supabase hands back at most 1,000 rows at a time). */
export async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}

function rateCardName(brandOrCustomer: string | null | undefined): string {
  const b = (brandOrCustomer ?? '').toLowerCase()
  if (/7.?eleven|7.?11|\bsei\b/.test(b)) return '7-Eleven'
  if (/global/.test(b)) return 'Global'
  if (/sunoco|exxon/.test(b)) return 'Sunoco'
  if (/wawa/.test(b)) return 'Wawa'
  return 'Independent'
}

/** The customer's invoice rates: by the job's brand, else its customer, else the site number's shape. */
export function invoiceRatesFor(job: { gas_brand: string | null; customer: string | null; site_number: string | null }) {
  const name = rateCardName(job.gas_brand || job.customer || (/^SU/i.test(job.site_number ?? '') ? 'Sunoco' : /^\d{5}$/.test(job.site_number ?? '') ? '7-Eleven' : /wawa/i.test(job.site_number ?? '') ? 'Wawa' : ''))
  return INVOICE_RATES[name]
}

export type JobForCosts = { id: string; site_number: string | null; po_number: string | null; gas_brand: string | null; customer: string | null }

/** Costs for one job (the job page). */
export async function loadJobCosts(admin: Admin, companyId: string, job: JobForCosts, labor?: ManualLaborRow[]): Promise<JobCosts & { billedLabor: number }> {
  const [expenses, docs, materials, tickets, daily, manualLabor, invoices, company] = await Promise.all([
    admin.from('expenses').select(EXPENSE_COLS).eq('company_id', companyId).eq('con_job_id', job.id).limit(2000),
    admin.from('billing_inbox_documents').select(DOC_COLS).eq('company_id', companyId).eq('con_job_id', job.id).limit(2000),
    admin.from('con_job_materials').select('id, job_id, description, part_number, quantity, unit_cost, status, vendor, ordered_date').eq('company_id', companyId).eq('job_id', job.id),
    admin.from('svc_work_order_documents').select(TICKET_COLS).eq('company_id', companyId).eq('con_job_id', job.id).is('duplicate_of', null).limit(2000),
    admin.from('con_daily_updates').select('work_date, con_daily_update_techs(tech_name, hours)').eq('company_id', companyId).eq('job_id', job.id),
    labor ? Promise.resolve({ data: labor }) : admin.from('con_job_labor').select('id, job_id, work_date, crew_member, hours, labor_rate, task_note').eq('company_id', companyId).eq('job_id', job.id),
    admin.from('con_invoices').select('id, labor_rate').eq('company_id', companyId).eq('job_id', job.id),
    admin.from('companies').select('labor_cost_rate').eq('id', companyId).maybeSingle(),
  ])

  let expenseRows = (expenses.data ?? []) as unknown as ExpenseRow[]
  let docRows = (docs.data ?? []) as unknown as InboxDocRow[]

  // Paperwork tied to this job whose expense is charged somewhere else: the expense decides (a person may have
  // moved it), so the paper is not counted here. An expense with no job at all is counted here with its paper.
  if (docRows.length) {
    const { data: theirs } = await admin.from('expenses').select(EXPENSE_COLS).eq('company_id', companyId).in('source_document_id', docRows.map((d) => d.id))
    const elsewhere = new Set<string>()
    for (const e of (theirs ?? []) as unknown as ExpenseRow[]) {
      if (e.con_job_id === job.id) continue
      if (e.con_job_id) elsewhere.add(e.source_document_id!)
      else expenseRows = [...expenseRows, e]
    }
    docRows = docRows.filter((d) => !elsewhere.has(d.id))
  }

  // The expenses' own paperwork may sit under another job id (or none); fetch it so the lines show.
  const have = new Set(docRows.map((d) => d.id))
  const missing = expenseRows.map((e) => e.source_document_id).filter((id): id is string => !!id && !have.has(id))
  const extraDocs = missing.length
    ? ((await admin.from('billing_inbox_documents').select(DOC_COLS).in('id', missing)).data ?? []) as unknown as InboxDocRow[]
    : []

  const invoiceIds = (invoices.data ?? []).map((i) => i.id)
  let billedLabor = 0
  if (invoiceIds.length) {
    const { data: li } = await admin.from('con_invoice_line_items').select('total_labor').in('invoice_id', invoiceIds)
    billedLabor = round2((li ?? []).reduce((a, l) => a + num(l.total_labor), 0))
  }
  const invoiceRate = (invoices.data ?? []).map((i) => num(i.labor_rate)).find((r) => r > 0) ?? null
  const rates = invoiceRatesFor(job)

  const dailyTechs: DailyTechRow[] = ((daily.data ?? []) as unknown as { work_date: string | null; con_daily_update_techs: { tech_name: string | null; hours: number | null }[] | null }[])
    .flatMap((u) => (u.con_daily_update_techs ?? []).map((t) => ({ job_id: job.id, work_date: u.work_date, tech_name: t.tech_name, hours: t.hours })))

  const costs = buildJobCosts({
    expenses: expenseRows,
    docs: [...docRows, ...extraDocs],
    manualMaterials: (materials.data ?? []) as unknown as ManualMaterialRow[],
    tickets: (tickets.data ?? []) as unknown as TicketRow[],
    dailyTechs,
    manualLabor: (manualLabor.data ?? []) as unknown as ManualLaborRow[],
    ignoreRefs: [job.site_number ?? '', job.po_number ?? ''],
    companyLaborRate: numOrNull((company.data as { labor_cost_rate?: number | null } | null)?.labor_cost_rate),
    billingLaborRate: invoiceRate ?? rates.labor,
    tripRate: rates.trip,
  })
  return { ...costs, billedLabor }
}

export type JobCostTotals = { materialCost: number; otherCost: number; laborHours: number; laborCost: number; totalCost: number; invoicePreview: number }

/** Cost totals for every job in the company (the Construction reports). Same rules as the job page. */
export async function loadAllJobCosts(admin: Admin, companyId: string, jobs: JobForCosts[]): Promise<Map<string, JobCostTotals>> {
  const [expenses, docs, materials, tickets, daily, manualLabor, invoices, company] = await Promise.all([
    allRows<ExpenseRow>((f, t) => admin.from('expenses').select(EXPENSE_COLS).eq('company_id', companyId).or('con_job_id.not.is.null,source_document_id.not.is.null').order('id').range(f, t)),
    allRows<InboxDocRow>((f, t) => admin.from('billing_inbox_documents').select(DOC_COLS).eq('company_id', companyId).in('kind', [...PURCHASE_KINDS]).order('id').range(f, t)),
    allRows<ManualMaterialRow>((f, t) => admin.from('con_job_materials').select('id, job_id, description, part_number, quantity, unit_cost, status, vendor, ordered_date').eq('company_id', companyId).order('id').range(f, t)),
    allRows<TicketRow>((f, t) => admin.from('svc_work_order_documents').select(TICKET_COLS).eq('company_id', companyId).not('con_job_id', 'is', null).is('duplicate_of', null).order('id').range(f, t)),
    allRows<{ job_id: string; work_date: string | null; con_daily_update_techs: { tech_name: string | null; hours: number | null }[] | null }>((f, t) => admin.from('con_daily_updates').select('job_id, work_date, con_daily_update_techs(tech_name, hours)').eq('company_id', companyId).order('id').range(f, t)),
    allRows<ManualLaborRow>((f, t) => admin.from('con_job_labor').select('id, job_id, work_date, crew_member, hours, labor_rate, task_note').eq('company_id', companyId).order('id').range(f, t)),
    allRows<{ job_id: string | null; labor_rate: number | null }>((f, t) => admin.from('con_invoices').select('job_id, labor_rate').eq('company_id', companyId).order('id').range(f, t)),
    admin.from('companies').select('labor_cost_rate').eq('id', companyId).maybeSingle(),
  ])

  const by = <T,>(rows: T[], key: (r: T) => string | null | undefined) => {
    const m = new Map<string, T[]>()
    for (const r of rows) { const k = key(r); if (!k) continue; (m.get(k) ?? m.set(k, []).get(k)!).push(r) }
    return m
  }
  const docsById = new Map(docs.map((d) => [d.id, d]))
  const expByDoc = new Map(expenses.filter((e) => e.source_document_id).map((e) => [e.source_document_id!, e]))
  const expByJob = by(expenses, (e) => e.con_job_id)
  const docByJob = by(docs, (d) => d.con_job_id)
  const matByJob = by(materials, (m) => m.job_id)
  const tixByJob = by(tickets, (t) => t.con_job_id)
  const dayByJob = by(daily, (d) => d.job_id)
  const labByJob = by(manualLabor, (l) => l.job_id)
  const invRate = new Map<string, number>()
  for (const i of invoices) if (i.job_id && num(i.labor_rate) > 0 && !invRate.has(i.job_id)) invRate.set(i.job_id, num(i.labor_rate))
  const companyRate = numOrNull((company.data as { labor_cost_rate?: number | null } | null)?.labor_cost_rate)

  const out = new Map<string, JobCostTotals>()
  for (const job of jobs) {
    let ex = expByJob.get(job.id) ?? []
    let own = docByJob.get(job.id) ?? []
    const tix = tixByJob.get(job.id) ?? []
    const mats = matByJob.get(job.id) ?? []
    const days = dayByJob.get(job.id) ?? []
    const lab = labByJob.get(job.id) ?? []
    if (!ex.length && !own.length && !tix.length && !mats.length && !days.length && !lab.length) continue
    // Same rule as the job page: the expense decides which job a piece of paper is charged to.
    const unassigned = own.map((d) => expByDoc.get(d.id)).filter((e): e is ExpenseRow => !!e && !e.con_job_id)
    if (unassigned.length) ex = [...ex, ...unassigned]
    own = own.filter((d) => { const e = expByDoc.get(d.id); return !e || !e.con_job_id || e.con_job_id === job.id })
    const ownIds = new Set(own.map((d) => d.id))
    const extra = ex.map((e) => (e.source_document_id && !ownIds.has(e.source_document_id) ? docsById.get(e.source_document_id) : undefined)).filter((d): d is InboxDocRow => !!d)
    const c = buildJobCosts({
      expenses: ex, docs: [...own, ...extra], manualMaterials: mats, tickets: tix,
      dailyTechs: days.flatMap((u) => (u.con_daily_update_techs ?? []).map((t) => ({ job_id: job.id, work_date: u.work_date, tech_name: t.tech_name, hours: t.hours }))),
      manualLabor: lab,
      ignoreRefs: [job.site_number ?? '', job.po_number ?? ''],
      companyLaborRate: companyRate,
      billingLaborRate: invRate.get(job.id) ?? invoiceRatesFor(job).labor,
      tripRate: invoiceRatesFor(job).trip,
    })
    out.set(job.id, { materialCost: c.materialCost, otherCost: c.otherCost, laborHours: c.laborHours, laborCost: c.laborCost, totalCost: c.totalCost, invoicePreview: c.invoice.total })
  }
  return out
}
