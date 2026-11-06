// Card audit: turns the receipts crews email in (constructionreceipts@ etc.) into a
// statement-ready list for one company card and one month.
//
// Crews already code every receipt in the subject line:
//   "<amount> <CARD> <job or asset #> <what it was for>"   e.g. "648.77 TEC 26941 rebar, studs"
// with plenty of real-world variation ("8.47-TEC-A1 car charger", "271.99-TEC, 42 80LB…",
// "105 TEC DOT physical", "Re: 757.11 TEC SU-14765 concrete"). Claude also reads the attached
// receipt (billing_inbox_documents.extracted: total, vendor, reference, document_date), which
// lets us cross-check the subject against the paper.

export const CARD_AUDIT_ROLES: readonly string[] = ['owner', 'manager', 'office', 'accounting']
export const canAuditCards = (role: string | null | undefined) => CARD_AUDIT_ROLES.includes(role ?? '')

export type CardDoc = {
  id: string
  received_at: string
  sender: string | null
  sender_email: string | null
  subject: string | null
  vendor: string | null
  reference: string | null
  document_date: string | null
  extracted: { total?: number | null; vendor?: string | null; reference?: string | null; document_date?: string | null } | null
  card_matched_at: string | null
}

export type ParsedSubject = {
  isReply: boolean
  amount: number | null
  code: string | null
  job: string | null
  description: string
}

export type Flag =
  | 'duplicate'
  | 'amount_mismatch'
  | 'no_amount'
  | 'refund'
  | 'no_job'
  | 'policy'

export const FLAG_LABEL: Record<Flag, string> = {
  duplicate: 'Possible duplicate',
  amount_mismatch: "Subject ≠ receipt total",
  no_amount: 'No amount in subject',
  refund: 'Refund / credit',
  no_job: 'No job or asset #',
  policy: 'Policy review',
}

export type AuditRow = {
  id: string
  date: string            // the charge date used for the month (receipt date, else the day it was emailed)
  who: string
  amount: number | null   // amount typed in the subject
  receiptTotal: number | null // total Claude read off the receipt
  vendor: string
  reference: string | null
  job: string | null
  description: string
  matched: boolean
  flags: Flag[]
  duplicateOf: string[]   // ids of the other rows it looks like
}

const REPLY = /^\s*(?:(?:re|fwd?|fw)\s*:\s*)+/i
const AMOUNT = /^\s*(-?)\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/
// Job / asset numbers seen in RPS subjects: SU-14765, 40013, 41333, IP-1234, and unit numbers like A1, O15, Q17, TT20, NN14, H8.
const JOB = /\b(?:[A-Z]{2}-?\d{3,6}|\d{5}|[A-Z]{1,2}\d{1,3})\b/
const POLICY = /\b(traffic|ticket|fine|citation|parking|toll violation|alcohol|beer|personal)\b/i

/** Pulls amount, card code, job # and description out of a receipt subject line. */
export function parseCardSubject(subject: string | null | undefined, codes: readonly string[]): ParsedSubject {
  const raw = (subject ?? '').trim()
  const isReply = REPLY.test(raw)
  let rest = raw.replace(REPLY, '')

  let amount: number | null = null
  const m = rest.match(AMOUNT)
  if (m) {
    amount = Number(`${m[1]}${m[2].replace(/,/g, '')}.${m[3] ?? '0'}`)
    rest = rest.slice(m[0].length)
  }

  let code: string | null = null
  const codeRe = new RegExp(`^[\\s,\\-–]*(${codes.map(escapeRe).join('|')})\\b[\\s,\\-–]*`, 'i')
  const c = codes.length ? rest.match(codeRe) : null
  if (c) {
    code = c[1].toUpperCase()
    rest = rest.slice(c[0].length)
  }
  rest = rest.replace(/^for\s+/i, '').trim()

  const j = rest.match(JOB)
  return { isReply, amount, code, job: j ? j[0] : null, description: rest }
}

/** Does this subject mention the given card code anywhere (used to pre-filter in SQL-free code paths)? */
export const mentionsCard = (subject: string | null | undefined, code: string) =>
  new RegExp(`(^|[^A-Za-z])${escapeRe(code)}([^A-Za-z]|$)`, 'i').test(subject ?? '')

/**
 * Two receipts that probably describe the same charge.
 * Called for every pair of non-reply rows on the same card in the same month.
 */
export function isLikelyDuplicate(a: AuditRow, b: AuditRow): boolean {
  // Only the same person submitting the same amount to the cent is worth a look.
  if (a.who !== b.who || a.amount == null || a.amount === 0 || cents(a.amount) !== cents(b.amount)) return false
  // Same paper reference (folio, invoice #) on both → the same receipt sent twice.
  const ref = (r: string | null) => (r ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase()
  if (ref(a.reference) && ref(a.reference) === ref(b.reference)) return true
  // Same amount within a day → review it (two hotel nights coded 40013/40014, three disposal loads, a resend).
  if (daysApart(a.date, b.date) <= 1) return true
  // Same wording weeks apart → a resend (648.77 Home Depot on 10/5 and 10/28). Different wording
  // ("JBS for API", "RS API", "AER API" at $75 each) is a real repeat purchase, not a duplicate.
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return words(a.description) === words(b.description) && daysApart(a.date, b.date) <= 45
}

const cents = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100))
export const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000

/** Builds the audit rows for one card, dropping reply threads ("Re: …") which are not new charges. */
export function buildAuditRows(docs: CardDoc[], code: string, codes: readonly string[]): AuditRow[] {
  const rows: AuditRow[] = []
  for (const d of docs) {
    const p = parseCardSubject(d.subject, codes)
    if (p.isReply) continue
    if (p.code !== code.toUpperCase() && !mentionsCard(d.subject, code)) continue
    const ex = d.extracted ?? {}
    const receiptTotal = typeof ex.total === 'number' ? ex.total : null
    const flags: Flag[] = []
    if (p.amount == null) flags.push('no_amount')
    else if (p.amount < 0) flags.push('refund')
    if (p.amount != null && receiptTotal != null && Math.abs(cents(p.amount)! - cents(receiptTotal)!) > 1 && Math.abs(p.amount) !== receiptTotal) flags.push('amount_mismatch')
    if (!p.job) flags.push('no_job')
    if (POLICY.test(p.description)) flags.push('policy')
    rows.push({
      id: d.id,
      date: (ex.document_date ?? d.document_date ?? d.received_at).slice(0, 10),
      who: d.sender || d.sender_email || 'Unknown',
      amount: p.amount,
      receiptTotal,
      vendor: (ex.vendor ?? d.vendor ?? '').replace(/&amp;/g, '&'),
      reference: ex.reference ?? d.reference,
      job: p.job,
      description: p.description,
      matched: !!d.card_matched_at,
      flags,
      duplicateOf: [],
    })
  }
  for (let i = 0; i < rows.length; i++) {
    for (let k = i + 1; k < rows.length; k++) {
      if (!isLikelyDuplicate(rows[i], rows[k])) continue
      rows[i].duplicateOf.push(rows[k].id)
      rows[k].duplicateOf.push(rows[i].id)
    }
  }
  for (const r of rows) if (r.duplicateOf.length) r.flags.unshift('duplicate')
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.who.localeCompare(b.who))
}

export type PersonTotal = { who: string; count: number; total: number; flagged: number; matched: number }

export function totalsByPerson(rows: AuditRow[]): PersonTotal[] {
  const map = new Map<string, PersonTotal>()
  for (const r of rows) {
    const t = map.get(r.who) ?? { who: r.who, count: 0, total: 0, flagged: 0, matched: 0 }
    t.count++
    t.total += r.amount ?? r.receiptTotal ?? 0
    if (r.flags.some(f => f !== 'no_job')) t.flagged++
    if (r.matched) t.matched++
    map.set(r.who, t)
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}

/** "2026-10" → { start: '2026-10-01', end: '2026-11-01', label: 'October 2026' } */
export function monthRange(ym: string | undefined, today = new Date()) {
  const fallback = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const [y, m] = (/^\d{4}-\d{2}$/.test(ym ?? '') ? ym! : fallback).split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const end = new Date(Date.UTC(y, m, 1))
  const prev = new Date(Date.UTC(y, m - 2, 1))
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const ymOf = (d: Date) => iso(d).slice(0, 7)
  return {
    ym: ymOf(start), start: iso(start), end: iso(end), prev: ymOf(prev), next: ymOf(end),
    label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  }
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
