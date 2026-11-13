// Receipts by payment type (Expenses → Receipts by payment type).
//
// Each month the card statements and the vendor account bills (Home Depot, Noland, ICON …) come in
// and every charge has to be found among the receipts crews turned in. This report lists the
// receipts for one payment type (TEC, HDP, NOL …) and date range — who sent it, how much, when,
// what it was for, and the receipt itself — so they can be ticked off against the bill.
// Tech cards (TEC) are one code shared by many cards, so everything is also split by person.
//
// Reads the `expenses` table: hand-entered receipts plus every receipt emailed to Construction
// Receipts (lib/receipt-expense-import.ts).

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { noAccountingOrHr } from '@/lib/role-access'

/** Who may tick receipts off against a bill. Everyone else who can open Expenses can still read the report. */
export const RECEIPT_CHECK_ROLES: readonly string[] = ['owner', 'manager', 'office_staff', 'construction_manager', 'construction_admin']
export const canCheckReceipts = (role: string | null | undefined) => RECEIPT_CHECK_ROLES.includes(role ?? '')

/** `pay` value for receipts that came in without a payment code. */
export const NO_CODE = 'NONE'

export type Show = 'all' | 'open' | 'checked'
export type ReceiptFilters = {
  from: string   // YYYY-MM-DD, inclusive
  to: string     // YYYY-MM-DD, inclusive
  pay: string    // '' = every payment type, NO_CODE = receipts with no code, else the code (TEC, HDP …)
  who: string    // '' = everyone, else a person key (email, or name when there is no email)
  show: Show
  q: string
}

export type ReceiptRow = {
  id: string
  date: string
  amount: number
  code: string          // '' when the receipt has no payment code
  who: string           // display name
  whoKey: string
  email: string | null
  vendor: string
  description: string
  chargedTo: string
  cardLast4: string | null
  receiptUrl: string | null
  receiptIsImage: boolean
  checked: boolean
  checkedAt: string | null
}

export type PersonTotal = { whoKey: string; who: string; email: string | null; count: number; total: number; checked: number }
export type CodeTotal = { code: string; name: string; count: number; total: number; checked: number; checkedTotal: number; people: PersonTotal[] }
export type ReceiptGroup = { code: string; name: string; person: PersonTotal; rows: ReceiptRow[] }

const ISO = /^\d{4}-\d{2}-\d{2}$/
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** "2026-10" → first and last day of that month. */
export function monthBounds(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return {
    from: iso(new Date(Date.UTC(y, m - 1, 1))),
    to: iso(new Date(Date.UTC(y, m, 0))),
    label: new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  }
}

/** This month and the months before it, newest first, for the quick picks. */
export function recentMonths(count: number, today = new Date()) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(today.getFullYear(), today.getMonth() - i, 1))
    const ym = iso(d).slice(0, 7)
    return { ym, ...monthBounds(ym) }
  })
}

type Params = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

/** Reads the filters from the address bar. `month=2026-10` is a shortcut for that month's from/to. */
export function parseFilters(sp: Params, today = new Date()): ReceiptFilters {
  const month = one(sp.month)
  const base = /^\d{4}-\d{2}$/.test(month) ? monthBounds(month) : recentMonths(1, today)[0]
  let from = ISO.test(one(sp.from)) ? one(sp.from) : base.from
  let to = ISO.test(one(sp.to)) ? one(sp.to) : base.to
  if (from > to) [from, to] = [to, from]
  const pay = one(sp.pay).trim().toUpperCase()
  const show = one(sp.show)
  return {
    from, to,
    pay: /^[A-Z&]{1,8}$/.test(pay) ? pay : '',
    who: one(sp.who).trim().toLowerCase().slice(0, 120),
    show: show === 'open' || show === 'checked' ? show : 'all',
    q: one(sp.q).trim().slice(0, 80),
  }
}

/** Address for the report with these filters (pass a path for the CSV route). */
export function receiptsHref(f: ReceiptFilters, over: Partial<ReceiptFilters> = {}, path = '/expenses/receipts') {
  const n = { ...f, ...over }
  const q = new URLSearchParams({ from: n.from, to: n.to })
  if (n.pay) q.set('pay', n.pay)
  if (n.who) q.set('who', n.who)
  if (n.show !== 'all') q.set('show', n.show)
  if (n.q) q.set('q', n.q)
  return `${path}?${q}`
}

/** "2026-10-07" → "10/7/26" without the timezone shifting the day. */
export function shortDate(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return `${m}/${day}/${String(y).slice(2)}`
}
export function rangeLabel(f: Pick<ReceiptFilters, 'from' | 'to'>) {
  const m = monthBounds(f.from.slice(0, 7))
  return m.from === f.from && m.to === f.to ? m.label : `${shortDate(f.from)} – ${shortDate(f.to)}`
}
export const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/** Who is asking? `null` when signed out; `allowed` false for roles that never see accounting. */
export async function receiptReportViewer() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await createAdminClient().from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile) return null
  return { ...profile, allowed: !noAccountingOrHr(profile.role), canCheck: canCheckReceipts(profile.role) }
}

type Raw = {
  id: string; expense_date: string; amount: number | string; vendor: string | null; description: string | null
  expense_type: string | null; store_number: string | null; project_number: string | null; category_custom: string | null
  payment_method_code: string | null; card_last4: string | null; receipt_url: string | null
  submitter_name: string | null; submitter_email: string | null; statement_checked_at: string | null
  assets: { unit_number: string | null } | null
  profiles: { full_name: string | null; email: string | null } | null
}

function toRow(e: Raw): ReceiptRow {
  const email = (e.submitter_email || e.profiles?.email || '').toLowerCase() || null
  const who = e.submitter_name || e.profiles?.full_name || email || 'Unknown'
  const url = e.receipt_url || null
  return {
    id: e.id,
    date: e.expense_date,
    amount: Number(e.amount),
    code: (e.payment_method_code ?? '').toUpperCase(),
    who,
    whoKey: email ?? who.toLowerCase(),
    email,
    vendor: e.vendor ?? '',
    description: e.description ?? '',
    chargedTo: e.expense_type === 'asset' ? (e.assets?.unit_number ?? 'Truck')
      : e.expense_type === 'project' ? (e.project_number ?? e.store_number ?? 'Project')
      : e.expense_type === 'store' ? (e.store_number ?? 'Store')
      : (e.category_custom ?? 'General'),
    cardLast4: e.card_last4,
    receiptUrl: url,
    receiptIsImage: !!url && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(url),
    checked: !!e.statement_checked_at,
    checkedAt: e.statement_checked_at,
  }
}

function personTotals(rows: ReceiptRow[]): PersonTotal[] {
  const map = new Map<string, PersonTotal>()
  for (const r of rows) {
    const p = map.get(r.whoKey) ?? { whoKey: r.whoKey, who: r.who, email: r.email, count: 0, total: 0, checked: 0 }
    p.count++; p.total += r.amount; if (r.checked) p.checked++
    map.set(r.whoKey, p)
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}

/**
 * Everything the report shows for one date range:
 *   - `codes`:  spend by payment type for the whole range (each with its people), ignoring the other filters
 *   - `rows`:   the receipts that match every filter
 *   - `groups`: those receipts grouped payment type → person, with subtotals
 */
export async function loadReceiptReport(companyId: string, f: ReceiptFilters) {
  const admin = createAdminClient()
  const raw: Raw[] = []
  // PostgREST hands back at most 1,000 rows a request, so page through long ranges.
  for (let page = 0; page < 20; page++) {
    const { data, error } = await admin.from('expenses')
      .select('id, expense_date, amount, vendor, description, expense_type, store_number, project_number, category_custom, payment_method_code, card_last4, receipt_url, submitter_name, submitter_email, statement_checked_at, assets(unit_number), profiles!expenses_submitted_by_fkey(full_name, email)')
      .eq('company_id', companyId)
      .gte('expense_date', f.from).lte('expense_date', f.to)
      .order('expense_date').order('created_at').order('id')
      .range(page * 1000, page * 1000 + 999)
    if (error) throw new Error(error.message)
    raw.push(...((data ?? []) as unknown as Raw[]))
    if ((data ?? []).length < 1000) break
  }
  const { data: methods } = await admin.from('payment_methods').select('code, name').eq('company_id', companyId)
  const names = new Map((methods ?? []).map(m => [String(m.code).toUpperCase(), m.name as string]))
  const nameOf = (code: string) => (code ? names.get(code) ?? 'Not in Settings → Payment methods' : 'No payment code on the receipt')

  const all = raw.map(toRow)

  const byCode = new Map<string, ReceiptRow[]>()
  for (const r of all) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r])
  const codes: CodeTotal[] = [...byCode.entries()].map(([code, rs]) => ({
    code, name: nameOf(code),
    count: rs.length,
    total: rs.reduce((s, r) => s + r.amount, 0),
    checked: rs.filter(r => r.checked).length,
    checkedTotal: rs.filter(r => r.checked).reduce((s, r) => s + r.amount, 0),
    people: personTotals(rs),
  })).sort((a, b) => b.total - a.total)

  const inPay = all.filter(r => !f.pay || (f.pay === NO_CODE ? !r.code : r.code === f.pay))
  /** People to offer in the Person dropdown: everyone with a receipt on the chosen payment type. */
  const people = personTotals(inPay).sort((a, b) => a.who.localeCompare(b.who))
  const needle = f.q.toLowerCase()
  const rows = inPay.filter(r =>
    (!f.who || r.whoKey === f.who) &&
    (f.show === 'all' || (f.show === 'checked') === r.checked) &&
    (!needle || `${r.vendor} ${r.description} ${r.chargedTo} ${r.who} ${r.amount.toFixed(2)}`.toLowerCase().includes(needle)))

  const groupMap = new Map<string, ReceiptRow[]>()
  for (const r of rows) {
    const k = `${r.code}|${r.whoKey}`
    groupMap.set(k, [...(groupMap.get(k) ?? []), r])
  }
  const groups: ReceiptGroup[] = [...groupMap.values()]
    .map(rs => ({ code: rs[0].code, name: nameOf(rs[0].code), person: personTotals(rs)[0], rows: rs }))
    .sort((a, b) => (a.code || '~').localeCompare(b.code || '~') || a.person.who.localeCompare(b.person.who))

  return {
    codes, people, rows, groups, nameOf,
    grandTotal: all.reduce((s, r) => s + r.amount, 0),
    grandCount: all.length,
    total: rows.reduce((s, r) => s + r.amount, 0),
    checkedTotal: rows.filter(r => r.checked).reduce((s, r) => s + r.amount, 0),
    checkedCount: rows.filter(r => r.checked).length,
  }
}
