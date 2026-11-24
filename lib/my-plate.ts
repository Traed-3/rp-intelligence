/**
 * My Plate — one person's follow-up list, ordered so the top row is the next thing to do.
 *
 * Ordering rule (Trae, 9/30/26 "knock it out in the correct order"):
 *   1. Overdue, most overdue first.        2. Due today.        3. Hot (priority 1) with no date.
 *   4. Due within 3 days.                  5. Everything else by priority, then oldest first.
 * Items waiting on someone else sit in their own list, longest wait first, so a nudge is one glance away.
 * Pure functions only: the page loads rows, this file decides the order.
 */

export type TaskKind = 'quote' | 'price' | 'order' | 'bid' | 'survey' | 'followup' | 'admin'
export type TaskStatus = 'open' | 'waiting' | 'done' | 'dropped'

export type TaskRow = {
  id: string
  title: string
  detail: string | null
  kind: TaskKind
  site_number: string | null
  job_id: string | null
  quote_id: string | null
  priority: number
  due_date: string | null
  status: TaskStatus
  action: Record<string, unknown> | null
  answer: string | null
  waiting_on: string | null
  waiting_since: string | null
  snoozed_until: string | null
  source: string
  source_key: string | null
  created_at: string
  done_at: string | null
  owner_id?: string
  /** Whose plate the row was on before someone clicked it over (null = it was put here directly). */
  handed_from?: string | null
  handed_at?: string | null
  /** The owner's own "where I am with it" note. Only a person writes it. */
  my_note?: string | null
  my_note_at?: string | null
}

/**
 * Plate partners (Trae 11/12/26): Trae and Starsky both work out of econstruction, so the routines sometimes put
 * Starsky's work on Trae's plate. A partner shows in the "Assign to:" dropdown on every card and can see, close or
 * take back what is on the other plate. Keyed by login email.
 */
export const PLATE_PARTNERS: Record<string, string> = {
  'finance.trae@proton.me': 'sdodson.rp@gmail.com',
  'dodson3.trae@gmail.com': 'sdodson.rp@gmail.com',
  'sdodson.rp@gmail.com': 'finance.trae@proton.me',
}
export const firstName = (full: string | null | undefined) => (full ?? '').trim().split(/[\s-]+/)[0] || 'Partner'

export const KIND_LABEL: Record<TaskKind, string> = {
  quote: 'Quote', price: 'Price needed', order: 'Order', bid: 'Bid', survey: 'Survey', followup: 'Follow-up', admin: 'Admin',
}

export const KIND_CLASS: Record<TaskKind, string> = {
  quote: 'bg-blue-50 text-blue-700 border-blue-200',
  price: 'bg-amber-50 text-amber-800 border-amber-200',
  order: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  bid: 'bg-purple-50 text-purple-700 border-purple-200',
  survey: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  followup: 'bg-gray-50 text-gray-700 border-gray-200',
  admin: 'bg-gray-50 text-gray-500 border-gray-200',
}

/** Whole days from a to b (ISO dates); positive when b is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

/** Days overdue (positive) or days until due (negative); null when there is no date. */
export function dueDelta(t: TaskRow, today: string): number | null {
  return t.due_date ? daysBetween(t.due_date, today) : null
}

/** The "correct order" comparator for open work. */
export function compareOpen(a: TaskRow, b: TaskRow, today: string): number {
  const tier = (t: TaskRow) => {
    const d = dueDelta(t, today)
    if (d !== null && d > 0) return 0            // overdue
    if (d === 0) return 1                         // due today
    if (t.priority === 1 && d === null) return 2  // hot, no date
    if (d !== null && d >= -3) return 3           // due within 3 days
    return 4
  }
  const ta = tier(a), tb = tier(b)
  if (ta !== tb) return ta - tb
  const da = dueDelta(a, today), db = dueDelta(b, today)
  if (ta === 0 && da !== db) return (db ?? 0) - (da ?? 0)          // most overdue first
  if (a.due_date !== b.due_date) {
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return a.due_date.localeCompare(b.due_date)
  }
  if (a.priority !== b.priority) return a.priority - b.priority
  return a.created_at.localeCompare(b.created_at)                   // oldest first
}

export type Plate = { now: TaskRow[]; next: TaskRow[]; waiting: TaskRow[]; snoozed: TaskRow[]; doneToday: TaskRow[] }

export function buildPlate(tasks: TaskRow[], today: string): Plate {
  const out: Plate = { now: [], next: [], waiting: [], snoozed: [], doneToday: [] }
  for (const t of tasks) {
    if (t.status === 'done') { if (t.done_at && t.done_at.slice(0, 10) === today) out.doneToday.push(t); continue }
    if (t.status === 'dropped') continue
    if (t.status === 'waiting') { out.waiting.push(t); continue }
    if (t.snoozed_until && t.snoozed_until > today) { out.snoozed.push(t); continue }
    const d = dueDelta(t, today)
    const isNow = (d !== null && d >= 0) || t.priority === 1 || (d !== null && d >= -3)
    ;(isNow ? out.now : out.next).push(t)
  }
  out.now.sort((a, b) => compareOpen(a, b, today))
  out.next.sort((a, b) => compareOpen(a, b, today))
  out.waiting.sort((a, b) => (a.waiting_since ?? a.created_at).localeCompare(b.waiting_since ?? b.created_at))
  out.snoozed.sort((a, b) => (a.snoozed_until ?? '').localeCompare(b.snoozed_until ?? ''))
  out.doneToday.sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''))
  return out
}

/** Business days since a date (Mon–Fri), for the "nudge" hint on waiting items. */
export function businessDaysSince(iso: string, today: string): number {
  let n = 0
  const d = new Date(iso + 'T12:00:00Z'), end = new Date(today + 'T12:00:00Z')
  while (d < end) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++ }
  return n
}

/** Things the data already knows you owe, shown beside the list; one click turns one into a task. */
export type Signal = { key: string; kind: TaskKind; title: string; detail?: string; site_number?: string | null; href?: string; action?: Record<string, unknown> }

export function buildSignals(input: {
  neededLines: { quote_number: string; quote_id: string; line_id?: string; site_number: string | null; description: string }[]
  bidsDue: { quote_number: string; quote_id: string; site_number: string | null; bid_due: string }[]
  staleOrders: { site_number: string | null; description: string; ordered_date: string | null; job_id: string }[]
  quotingNoQuote: { id: string; site_number: string; work_order_number: string | null; status_detail: string | null }[]
  unmatchedSlips: number
  existingKeys: Set<string>
}, today: string): Signal[] {
  const out: Signal[] = []
  for (const l of input.neededLines) out.push({ key: `needed|${l.quote_id}|${l.description}`, kind: 'price', site_number: l.site_number, title: `Price needed on ${l.quote_number}: ${l.description}`, href: `/billing/quotes/${l.quote_id}`, action: l.line_id ? { type: 'quote_line_price', quote_id: l.quote_id, line_id: l.line_id } : undefined })
  for (const b of input.bidsDue) {
    const d = daysBetween(today, b.bid_due)
    out.push({ key: `bid|${b.quote_id}`, kind: 'bid', site_number: b.site_number, title: `${b.quote_number} bid due ${b.bid_due}${d < 0 ? ` (${-d} days ago)` : d === 0 ? ' (today)' : ` (in ${d} days)`}`, href: `/billing/quotes/${b.quote_id}` })
  }
  for (const o of input.staleOrders) out.push({ key: `order|${o.job_id}|${o.description}`, kind: 'order', site_number: o.site_number, title: `${o.site_number ?? '?'}: ${o.description} ordered ${o.ordered_date ?? '?'}, nothing received`, href: `/construction/jobs/${o.job_id}` })
  for (const j of input.quotingNoQuote) out.push({ key: `quoting|${j.id}`, kind: 'quote', site_number: j.site_number, title: `${j.site_number}${j.work_order_number ? ` ${j.work_order_number}` : ''} is at quoting with no quote${j.status_detail ? ` · ${j.status_detail}` : ''}`, href: `/construction/jobs/${j.id}` })
  if (input.unmatchedSlips > 0) out.push({ key: 'slips|unmatched', kind: 'followup', title: `${input.unmatchedSlips} packing slip${input.unmatchedSlips === 1 ? '' : 's'} nobody has placed`, href: '/inventory/receive/queue' })
  return out.filter(s => !input.existingKeys.has(s.key))
}

// ── Yes / No questions (Trae 11/12/26: "anytime my plate asks a yes or no question I want a button") ──

const YN_AUX = /^(?:is|are|was|were|am|do|does|did|can|could|should|shall|will|would|has|have|had|may|must)(?:n['’]t)?\b/i
/** "Bill 2 men instead?" is short for "should I bill 2 men?": a bare verb the routines use when they ask for a go-ahead. */
const YN_VERB = /^(?:bill|add|send|order|close|mark|move|keep|drop|use|include|charge|invoice|file|schedule|remove|split|combine|want|need|ok|okay)\b/i
const YN_OPEN = /\b(?:which|what|who|whose|how)\b/i

/**
 * True when the text ends in one plain yes-or-no question.
 * Careful on purpose: an either/or ("this job or a separate one?"), a which/what/how question,
 * two questions in one row, or a question followed by more text all keep the typed answer box.
 */
export function readsAsYesNo(text: string | null | undefined): boolean {
  if (!text) return false
  let s = text
  for (let i = 0; i < 3; i++) s = s.replace(/\([^()]*\)/g, ' ')   // notes in brackets are not the question
  s = s.replace(/\s+/g, ' ').trim()
  if (!s.endsWith('?') || s.indexOf('?') !== s.length - 1) return false
  const clause = (s.slice(0, -1).split(/(?:[.!;:] | [-–—] )/).pop() ?? '').trim()
    .replace(/^(?:and|so|but|then|also)[, ]+/i, '').replace(/,? or not$/i, '')
  if (!clause || /\bor\b/i.test(clause) || YN_OPEN.test(clause)) return false
  return YN_AUX.test(clause) || YN_VERB.test(clause)
}

/**
 * Does this row get Yes / No buttons?
 * Whoever creates the row can say so outright with action.yes_no = true or false, and that always wins.
 * With no flag, the title is read (or the detail, when the title asks nothing).
 */
export function isYesNo(t: Pick<TaskRow, 'title' | 'detail' | 'action'>): boolean {
  const flag = (t.action as { yes_no?: unknown } | null)?.yes_no
  if (typeof flag === 'boolean') return flag
  return t.title.includes('?') ? readsAsYesNo(t.title) : readsAsYesNo(t.detail)
}
