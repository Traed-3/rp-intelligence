// ── Shared calendar date helpers (local-time, no timezone shift) ──
// One source of truth for the date math the schedule and calendar views share.
// Everything here treats dates as local calendar days, so a `YYYY-MM-DD`
// round-trips without ever crossing a timezone boundary.

/** `YYYY-MM-DD` for a Date, in local terms (no UTC shift). */
export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Parse a `YYYY-MM-DD` string to a local Date at midnight. */
export function parseISO(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** The Monday on or before `d` (weeks start Monday), at local midnight. */
export function mondayOnOrBefore(d: Date): Date {
  const x = new Date(d)
  const day = x.getDay() // 0 Sun … 6 Sat
  x.setDate(x.getDate() + ((day === 0 ? -6 : 1) - day))
  x.setHours(0, 0, 0, 0)
  return x
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

/**
 * The 42 days (6 weeks, Monday-first) that make up a month grid containing `anchor`.
 * Returns Date objects; use `iso()` to key them.
 */
export function monthGridDays(anchor: Date): Date[] {
  const gridStart = mondayOnOrBefore(startOfMonth(anchor))
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
