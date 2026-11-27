import { describe, expect, it } from 'vitest'
import { AUTO_OUT_HOURS, buildFix, guardAction, isDay, nyDay, nyParts, nyRange, nyToUtc, parseClockReminder, payWeekOf, splitOvertime } from '@/lib/time-clock'

describe('Eastern time', () => {
  it('puts an evening clock-out on the right day', () => {
    expect(nyDay('2026-11-24T01:30:00Z')).toBe('2026-11-23')          // 8:30 PM EST on the 23rd
    expect(nyParts('2026-11-24T01:30:00Z')).toMatchObject({ day: '2026-11-23', hhmm: '20:30', dow: 1 })
  })
  it('turns wall-clock time into the moment, winter and summer', () => {
    expect(nyToUtc('2026-11-23', '07:00')!.toISOString()).toBe('2026-11-23T12:00:00.000Z')   // EST = UTC-5
    expect(nyToUtc('2026-07-15', '07:00')!.toISOString()).toBe('2026-07-15T11:00:00.000Z')   // EDT = UTC-4
    expect(nyToUtc('2026-11-01', '12:00')!.toISOString()).toBe('2026-11-01T17:00:00.000Z')   // the day the clocks go back
    expect(nyToUtc('2026-03-08', '12:00')!.toISOString()).toBe('2026-03-08T16:00:00.000Z')   // the day they go forward
  })
  it('refuses junk', () => {
    expect(nyToUtc('2026-02-30', '07:00')).toBeNull()
    expect(nyToUtc('2026-11-23', '25:00')).toBeNull()
    expect(isDay('2026-13-01')).toBe(false)
  })
  it('bounds a range of Eastern days', () => {
    expect(nyRange('2026-11-19', '2026-11-25')).toEqual({ from: '2026-11-19T05:00:00.000Z', before: '2026-11-26T05:00:00.000Z' })
  })
})

describe('pay week (Thursday through Wednesday)', () => {
  it('finds the week', () => {
    expect(payWeekOf('2026-11-18')).toEqual({ start: '2026-11-12', end: '2026-11-18' })   // Wednesday = last day
    expect(payWeekOf('2026-11-19')).toEqual({ start: '2026-11-19', end: '2026-11-25' })   // Thursday = first day
    expect(payWeekOf('2026-11-22')).toEqual({ start: '2026-11-19', end: '2026-11-25' })   // Sunday
  })
  it('counts overtime per pay week, not across them', () => {
    // Jesse Franks, truck log week of 11/12: 11.5 + 0 + 0 + 13 + 13 = 37.5, then 13.5 + 9 + 12.25 + 10.5 + 5.75 = 51
    const r = splitOvertime({ '2026-11-12': 690, '2026-11-17': 780, '2026-11-18': 780, '2026-11-19': 810, '2026-11-20': 540, '2026-11-23': 735, '2026-11-24': 630, '2026-11-25': 345 })
    expect(r.weeks.map(w => [w.start, w.minutes, w.overtime])).toEqual([['2026-11-12', 2250, 0], ['2026-11-19', 3060, 660]])
    expect(r).toMatchObject({ regular: 2250 + 2400, overtime: 660 })
  })
})

describe('a manager fix', () => {
  const now = new Date('2026-11-27T18:00:00Z')
  it('builds the stored values', () => {
    expect(buildFix({ day: '2026-11-23', in: '07:00', out: '17:30', breakMinutes: '30' }, now)).toEqual({
      ok: true, clockIn: '2026-11-23T12:00:00.000Z', clockOut: '2026-11-23T22:30:00.000Z', breakMinutes: 30, totalMinutes: 600,
    })
  })
  it('reads an earlier clock-out as past midnight', () => {
    const r = buildFix({ day: '2026-11-19', in: '08:30', out: '00:30' }, now)       // the 16-hour day in the truck log
    expect(r).toMatchObject({ ok: true, clockOut: '2026-11-20T05:30:00.000Z', totalMinutes: 960 })
  })
  it('turns down a break as long as the shift, the future, and blanks', () => {
    expect(buildFix({ day: '2026-11-23', in: '07:00', out: '08:00', breakMinutes: 60 }, now).ok).toBe(false)
    expect(buildFix({ day: '2026-11-28', in: '07:00', out: '15:00' }, now).ok).toBe(false)
    expect(buildFix({ day: '2026-11-23', in: '', out: '15:00' }, now).ok).toBe(false)
    expect(buildFix({ day: '2026-11-23', in: '07:00', out: '15:00', breakMinutes: '-5' }, now).ok).toBe(false)
  })
})

describe('the forgotten clock-out guard', () => {
  const seven = parseClockReminder({ time: '19:00', days: [1, 2, 3, 4, 5] })
  const entry = (clock_in: string, reminded_at: string | null = null) => ({ clock_in, reminded_at, remind_count: 0 })
  it('reads the setting and drops junk', () => {
    expect(seven).toEqual({ time: '19:00', days: [1, 2, 3, 4, 5] })
    expect(parseClockReminder({ time: '7pm', days: [1] })).toBeNull()
    expect(parseClockReminder({ time: '19:00', days: [] })).toBeNull()
  })
  it('stays quiet before 7 PM and reminds at 7 PM on a weekday', () => {
    const inAt = '2026-11-23T13:03:00Z'                                                     // Monday 8:03 AM
    expect(guardAction(entry(inAt), seven, new Date('2026-11-23T23:50:00Z')).kind).toBe('none')          // 6:50 PM
    expect(guardAction(entry(inAt), seven, new Date('2026-11-24T00:00:00Z'))).toMatchObject({ kind: 'remind', why: 'personal' })   // 7:00 PM
  })
  it('repeats every hour, not every run', () => {
    const inAt = '2026-11-23T13:03:00Z'
    expect(guardAction(entry(inAt, '2026-11-24T00:00:00Z'), seven, new Date('2026-11-24T00:10:00Z')).kind).toBe('none')
    expect(guardAction(entry(inAt, '2026-11-24T00:00:00Z'), seven, new Date('2026-11-24T01:00:00Z')).kind).toBe('remind')
  })
  it('skips the personal reminder on a Saturday', () => {
    expect(guardAction(entry('2026-11-21T13:00:00Z'), seven, new Date('2026-11-22T00:30:00Z')).kind).toBe('none')    // Sat 7:30 PM, 11.5 h in
  })
  it('reminds anyone at 12 hours, then every 2', () => {
    const inAt = '2026-11-23T12:00:00Z'
    expect(guardAction(entry(inAt), null, new Date('2026-11-23T23:59:00Z')).kind).toBe('none')
    expect(guardAction(entry(inAt), null, new Date('2026-11-24T00:00:00Z'))).toMatchObject({ kind: 'remind', why: 'long', hours: 12 })
    expect(guardAction(entry(inAt, '2026-11-24T00:00:00Z'), null, new Date('2026-11-24T01:00:00Z')).kind).toBe('none')
    expect(guardAction(entry(inAt, '2026-11-24T00:00:00Z'), null, new Date('2026-11-24T02:00:00Z')).kind).toBe('remind')
  })
  it('clocks out at 18 hours whatever else is true', () => {
    expect(guardAction(entry('2026-11-23T12:00:00Z', '2026-11-24T05:00:00Z'), seven, new Date('2026-11-24T06:00:00Z'))).toEqual({ kind: 'auto_out', hours: AUTO_OUT_HOURS })
  })
  it('a night call-out that starts after 7 PM is not nagged at once', () => {
    expect(guardAction(entry('2026-11-24T01:00:00Z'), seven, new Date('2026-11-24T01:10:00Z')).kind).toBe('none')    // in at 8 PM
  })
})
