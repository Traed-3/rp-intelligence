import { describe, it, expect } from 'vitest'
import { permitBucket, PERMIT_STATUS_VALUES } from '@/lib/permits'
import { computeAlerts, type PermitGraph, type EnrichedPermit } from '@/lib/permits-data'

describe('permitBucket', () => {
  it('puts every status in exactly one dashboard pile', () => {
    const got = Object.fromEntries(PERMIT_STATUS_VALUES.map(s => [s, permitBucket(s)]))
    expect(got).toEqual({
      'Not Started': 'waiting',
      'Submitted to Hash': 'waiting',
      'Hash Submitted Confirmed': 'waiting',
      'In Progress': 'waiting',
      'Permit In-Hand': 'inspection',
      'Inspection Scheduled': 'inspection',
      'Complete': 'complete',
      'On Hold': 'waiting',
      'Rejected': 'waiting',
    })
  })
})

describe('computeAlerts', () => {
  const mk = (id: string, status: string, state: string, pulled_by = 'Hash Construction'): EnrichedPermit => ({
    id, project_id: 'p', permit_key: null, permit_type: 'Electrical', pulled_by,
    requirement_status: 'Required', status, notes: null, date_submitted_to_hash: null, updated_at: null,
    site: { id: 's', site_number: id, name: null, state, brand: null, jurisdiction_id: null },
    jurisdiction: null,
    project: { id: 'p', site_id: 's', project_type: 'x', scheduled_work_date: '2020-01-01', permit_due_date: '2019-12-04', ready_to_work: false },
    dueDate: '2019-12-04', daysUntilDue: -100,
  })

  it('never raises an alert for a completed permit', () => {
    const enriched = [mk('done-md', 'Complete', 'MD'), mk('open-md', 'In Progress', 'MD')]
    const graph = { permits: enriched, projects: [], sites: [], jurisdictions: [],
      licenses: [{ contractor_name: 'Hash Construction', state: 'VA', expiration_date: '2099-01-01' }],
      enrich: (p: EnrichedPermit) => p, enriched } as unknown as PermitGraph
    const flagged = computeAlerts(graph, { now: new Date('2026-11-24') }).flatMap(a => a.permits.map(p => p.id))
    expect(flagged).not.toContain('done-md')
    expect(flagged).toContain('open-md')
  })
})
