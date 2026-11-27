/**
 * Time clock rules shared by the clock, the manager's fix screen, the payroll report and the background guard.
 * Everything here is pure (no database), so it is covered by tests/time-clock.test.ts.
 *
 * The company runs on Eastern time and the server runs on UTC, so every "what day is this" and "what time is this"
 * goes through the helpers below. Do NOT use toLocaleDateString / toLocaleTimeString / setHours on the server
 * without the time zone: a 7 PM clock-out would land on the next day.
 */

export const TIME_ZONE = 'America/New_York'

/** Who may fix, add, approve and delete time. construction_manager is here because the crews answer to him. */
export const TIME_MANAGER_ROLES: readonly string[] = ['owner', 'manager', 'shop_manager', 'construction_manager']
export const isTimeManager = (role: string | null | undefined) => TIME_MANAGER_ROLES.includes(role ?? '')
/** Who may open the payroll report (unchanged). */
export const PAYROLL_ROLES: readonly string[] = ['owner', 'manager', 'shop_manager']

/** Still clocked in after this many hours: "did you forget?" reminder, repeated every REMIND_EVERY_HOURS. */
export const REMIND_AFTER_HOURS = 12
export const REMIND_EVERY_HOURS = 2
/** Still clocked in after this many hours: clocked out by the system, hours held at 0 until a manager fixes it. */
export const AUTO_OUT_HOURS = 18
/** A person's own "remind me at 7 PM" reminder repeats this often until they clock out. */
export const PERSONAL_REPEAT_MINUTES = 60
/** The pay week ends on Wednesday (the crews' "EOW" line), so it starts on Thursday. 0 = Sunday. */
export const PAY_WEEK_START_DOW = 4
export const OVERTIME_AFTER_MINUTES = 40 * 60

// ── Eastern-time helpers ──────────────────────────────────────────────────────

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const asDate = (v: string | Date) => (v instanceof Date ? v : new Date(v))

/** The Eastern calendar day of a moment, as YYYY-MM-DD. */
export function nyDay(v: string | Date): string { return dayFmt.format(asDate(v)) }

/** The Eastern wall clock of a moment. */
export function nyParts(v: string | Date): { day: string; hour: number; minute: number; dow: number; hhmm: string } {
  const p = Object.fromEntries(partsFmt.formatToParts(asDate(v)).map(x => [x.type, x.value]))
  const hour = Number(p.hour) % 24, minute = Number(p.minute)
  return { day: `${p.year}-${p.month}-${p.day}`, hour, minute, dow: DOW.indexOf(p.weekday), hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` }
}

/** "7:05 AM" in Eastern time. */
export function nyTime(v: string | Date): string {
  return asDate(v).toLocaleTimeString('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' })
}

/** "Mon, Nov 23" in Eastern time. */
export function nyDateLabel(v: string | Date, opts: { year?: boolean } = {}): string {
  return asDate(v).toLocaleDateString('en-US', { timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric', ...(opts.year ? { year: 'numeric' } : {}) })
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** A real calendar day typed as YYYY-MM-DD. */
export function isDay(s: unknown): s is string {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false
  const d = new Date(s + 'T12:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Add days to a YYYY-MM-DD day. */
export function addDaysTo(day: string, n: number): string {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Day of week of a YYYY-MM-DD day (0 = Sunday). */
export const dowOf = (day: string) => new Date(day + 'T12:00:00Z').getUTCDay()

/**
 * An Eastern wall-clock day + time as a UTC moment, right across daylight-saving changes.
 * Returns null for anything that is not a real day and HH:MM.
 */
export function nyToUtc(day: string, hhmm: string): Date | null {
  if (!isDay(day)) return null
  const m = HHMM_RE.exec(hhmm ?? '')
  if (!m) return null
  const want = `${day} ${m[1].padStart(2, '0')}:${m[2]}`
  // Start from the same numbers read as UTC, then correct by what Eastern says that moment is. Two passes settle it.
  let guess = new Date(`${day}T${m[1].padStart(2, '0')}:${m[2]}:00Z`).getTime()
  for (let i = 0; i < 3; i++) {
    const p = nyParts(new Date(guess))
    const got = new Date(`${p.day}T${p.hhmm}:00Z`).getTime()
    const aim = new Date(`${want.replace(' ', 'T')}:00Z`).getTime()
    if (got === aim) break
    guess += aim - got
  }
  return new Date(guess)
}

/** UTC moments that bound an Eastern day range (both days included): [start, end). */
export function nyRange(firstDay: string, lastDay: string): { from: string; before: string } {
  return { from: nyToUtc(firstDay, '00:00')!.toISOString(), before: nyToUtc(addDaysTo(lastDay, 1), '00:00')!.toISOString() }
}

// ── Pay weeks and overtime ────────────────────────────────────────────────────

/** The pay week (Thursday through Wednesday) a day falls in. */
export function payWeekOf(day: string): { start: string; end: string } {
  const back = (dowOf(day) - PAY_WEEK_START_DOW + 7) % 7
  const start = addDaysTo(day, -back)
  return { start, end: addDaysTo(start, 6) }
}

/** Regular and overtime minutes for each pay week touched by these days. Overtime = past 40 hours in a pay week. */
export function splitOvertime(minutesByDay: Record<string, number>): { regular: number; overtime: number; weeks: { start: string; end: string; minutes: number; overtime: number }[] } {
  const byWeek = new Map<string, number>()
  for (const [day, mins] of Object.entries(minutesByDay)) {
    if (!isDay(day) || !(mins > 0)) continue
    const w = payWeekOf(day).start
    byWeek.set(w, (byWeek.get(w) ?? 0) + mins)
  }
  let regular = 0, overtime = 0
  const weeks = [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([start, minutes]) => {
    const ot = Math.max(0, minutes - OVERTIME_AFTER_MINUTES)
    regular += minutes - ot; overtime += ot
    return { start, end: addDaysTo(start, 6), minutes, overtime: ot }
  })
  return { regular, overtime, weeks }
}

/** Hours between a moment and now. */
export const hoursSince = (v: string | Date) => (Date.now() - asDate(v).getTime()) / 3600000

export const hoursText = (mins: number | null | undefined) => ((mins ?? 0) / 60).toFixed(2)

// ── A manager's fix ───────────────────────────────────────────────────────────

export type FixInput = { day: string; in: string; out: string; breakMinutes?: number | string | null; outNextDay?: boolean }
export type FixResult =
  | { ok: true; clockIn: string; clockOut: string; breakMinutes: number; totalMinutes: number }
  | { ok: false; error: string }

/**
 * Turn what was typed on the fix form (a day, clock-in, clock-out, unpaid break) into the stored values.
 * A clock-out earlier than the clock-in means "past midnight" (a 16-hour day ending at 12:30 AM).
 */
export function buildFix(input: FixInput, now: Date = new Date()): FixResult {
  const start = nyToUtc(input.day, input.in)
  if (!start) return { ok: false, error: 'Enter the day and the clock-in time.' }
  let end = nyToUtc(input.day, input.out)
  if (!end) return { ok: false, error: 'Enter the clock-out time.' }
  if (input.outNextDay || end.getTime() <= start.getTime()) end = nyToUtc(addDaysTo(input.day, 1), input.out)!
  const span = Math.round((end.getTime() - start.getTime()) / 60000)
  if (span <= 0) return { ok: false, error: 'The clock-out has to be after the clock-in.' }
  if (span > 24 * 60) return { ok: false, error: 'That is more than 24 hours. Enter it as two days.' }
  if (start.getTime() > now.getTime() + 5 * 60000) return { ok: false, error: 'The clock-in is in the future.' }
  if (end.getTime() > now.getTime() + 5 * 60000) return { ok: false, error: 'The clock-out is in the future.' }
  const raw = input.breakMinutes
  const brk = raw === null || raw === undefined || raw === '' ? 0 : Number(raw)
  if (!Number.isFinite(brk) || brk < 0 || !Number.isInteger(brk)) return { ok: false, error: 'The unpaid break is a whole number of minutes.' }
  if (brk >= span) return { ok: false, error: 'The break is as long as the shift.' }
  return { ok: true, clockIn: start.toISOString(), clockOut: end.toISOString(), breakMinutes: brk, totalMinutes: span - brk }
}

// ── A person's own clock-out reminder ─────────────────────────────────────────

export type ClockReminder = { time: string; days: number[] }
export const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5]

/** Read profiles.ui_prefs.clock_reminder; anything odd is dropped. */
export function parseClockReminder(raw: unknown): ClockReminder | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const m = HHMM_RE.exec(typeof o.time === 'string' ? o.time : '')
  if (!m) return null
  const days = Array.isArray(o.days) ? [...new Set(o.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : []
  if (!days.length) return null
  return { time: `${m[1].padStart(2, '0')}:${m[2]}`, days }
}

// ── The guard's decision for one open entry ───────────────────────────────────

export type OpenEntry = { clock_in: string; reminded_at: string | null; remind_count: number | null }
export type GuardAction =
  | { kind: 'none' }
  | { kind: 'auto_out'; hours: number }
  | { kind: 'remind'; why: 'personal' | 'long'; hours: number }

/**
 * What to do about someone who is still clocked in.
 *   1. 18 hours in: clock them out (hours held until a manager fixes it).
 *   2. Their own reminder time has passed today (on one of their days): remind, then every hour.
 *   3. 12 hours in: remind, then every 2 hours.
 */
export function guardAction(entry: OpenEntry, reminder: ClockReminder | null, now: Date = new Date()): GuardAction {
  const inAt = new Date(entry.clock_in).getTime()
  const mins = Math.floor((now.getTime() - inAt) / 60000)
  if (!(mins >= 0)) return { kind: 'none' }
  const hours = Math.floor(mins / 60)
  if (mins >= AUTO_OUT_HOURS * 60) return { kind: 'auto_out', hours }

  const last = entry.reminded_at ? new Date(entry.reminded_at).getTime() : null
  const sinceLast = last === null ? Infinity : (now.getTime() - last) / 60000

  if (reminder) {
    const n = nyParts(now)
    if (reminder.days.includes(n.dow) && n.hhmm >= reminder.time) {
      const due = nyToUtc(n.day, reminder.time)!.getTime()
      // Clocked in after the reminder time (a late call-out): give them the long-shift rule instead.
      if (inAt < due) {
        const remindedSinceDue = last !== null && last >= due
        if (!remindedSinceDue || sinceLast >= PERSONAL_REPEAT_MINUTES) return { kind: 'remind', why: 'personal', hours }
        return { kind: 'none' }
      }
    }
  }
  if (mins >= REMIND_AFTER_HOURS * 60 && sinceLast >= REMIND_EVERY_HOURS * 60) return { kind: 'remind', why: 'long', hours }
  return { kind: 'none' }
}
