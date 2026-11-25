import { describe, expect, it } from 'vitest'
import { turnInProblems, todayEastern, TECH_STATUSES, completionLabel, canWriteServiceTickets } from '../../lib/service-tickets'

const ok = { work_performed: 'Replaced PUL sensor, tested.', store_number: '41617' }

describe('turning in a field ticket', () => {
  it('goes through when everything is there', () => {
    expect(turnInProblems(ok, 1, 'complete', null)).toEqual([])
    expect(turnInProblems(ok, 2, 'rtn', 'Waiting on part')).toEqual([])
  })
  it('needs an answer, and a reason for a return trip', () => {
    expect(turnInProblems(ok, 1, null, null)).toHaveLength(1)
    expect(turnInProblems(ok, 1, 'invoiced', null)).toHaveLength(1)
    expect(turnInProblems(ok, 1, 'rtn', '  ')).toHaveLength(1)
  })
  it('needs the store, the work performed and hours', () => {
    expect(turnInProblems({ work_performed: ' ', store_number: null }, 0, 'complete', null)).toHaveLength(3)
  })
  it('a tech can never pick the office statuses', () => {
    for (const s of ['complete', 'signed', 'invoiced', 'void']) expect(TECH_STATUSES).not.toContain(s)
  })
  it('uses the Eastern date late in the evening', () => {
    expect(todayEastern(new Date('2026-11-26T02:30:00Z'))).toBe('2026-11-25')
  })
  it('names the two answers', () => {
    expect(completionLabel('rtn')).toBe('Return trip needed')
    expect(completionLabel('nope')).toBeNull()
  })
  it('is the service department\'s: construction crews and mechanics do not write service tickets', () => {
    expect(canWriteServiceTickets('service_tech')).toBe(true)
    expect(canWriteServiceTickets('manager')).toBe(true)
    for (const r of ['construction_tech', 'mechanic', 'shop_employee', 'viewer', null]) expect(canWriteServiceTickets(r)).toBe(false)
  })
})
