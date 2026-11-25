import { describe, it, expect } from 'vitest'
import { buildJobCosts, classifyPurchase, refTokens, subjectAmount, type InboxDocRow, type ExpenseRow, type BuildInput } from '@/lib/job-costs'

const doc = (o: Partial<InboxDocRow> & { id: string }): InboxDocRow => ({
  con_job_id: 'job', inbox: 'constructionreceipts', kind: 'vendor_invoice', vendor: null, reference: null, subject: null,
  document_date: null, received_at: '2026-11-24T15:00:00Z', status: 'new', extracted: null, ...o,
})
const exp = (o: Partial<ExpenseRow> & { id: string }): ExpenseRow => ({
  con_job_id: 'job', expense_date: '2026-11-19', amount: 0, description: null, vendor: null, category_custom: null,
  payment_method_code: null, receipt_url: null, source_document_id: null, ...o,
})
const base: BuildInput = { expenses: [], docs: [], manualMaterials: [], tickets: [], dailyTechs: [], manualLabor: [] }

describe('reading the paperwork', () => {
  it('takes the amount and the wording out of a receipt subject', () => {
    expect(subjectAmount('1,638.37 ICN for SU-8001 product line fittings')).toEqual({ amount: 1638.37, rest: 'SU-8001 product line fittings', isReply: false })
    expect(subjectAmount('Re: 239.80 HDP 32223 conduit').isReply).toBe(true)
    expect(subjectAmount('-201.75 TEC 31 80lb bags of sakrete').amount).toBe(-201.75)
    expect(subjectAmount('SU 8001 ICON PACKING SLIP').amount).toBeNull()
    expect(subjectAmount('28960 SOURCE PACKING SLIP').amount).toBeNull()
    expect(subjectAmount('175 TEC SU-14765').amount).toBe(175)
    expect(subjectAmount('265-11 TEC UNISTRUT NUTS')).toMatchObject({ amount: 265.11, rest: 'UNISTRUT NUTS' })
  })
  it('finds the order number however the slip writes it', () => {
    expect(refTokens('SU-12080 / S.O. 54298')).toEqual(['12080', '54298'])
    expect(refTokens('54298B')).toEqual(['54298B'])
    expect(refTokens('Sump Survey')).toEqual([])
  })
  it('tells material from the other costs of a job', () => {
    expect(classifyPurchase('SU-8001 hotel Holiday Inn Express').label).toBe('Lodging')
    expect(classifyPurchase('33244 electrical permit J&J Electric').label).toBe('Permits & inspections')
    expect(classifyPurchase('32311 Electrical LCE').label).toBe('Subcontractor')
    expect(classifyPurchase('SU-9901 pump out').label).toBe('Disposal & pump-out')
    expect(classifyPurchase('UNISTRUT NUTS WASHER ALL THREAD TRASH BAGS The Home Depot').group).toBe('material')
    expect(classifyPurchase('40043 fuel ties').group).toBe('material')
    expect(classifyPurchase('SU-8001 icon order Icon Containment Solutions').group).toBe('material')
  })
})

describe('what a job cost', () => {
  it('counts an invoice once, with its lines, and marks it received when the packing slip is in', () => {
    const c = buildJobCosts({
      ...base,
      ignoreRefs: ['SU-8001', '24331'],
      expenses: [exp({ id: 'e1', amount: 1638.37, description: 'SU-8001 product line fittings', vendor: 'Icon Containment Solutions', source_document_id: 'd1' })],
      docs: [
        doc({ id: 'd1', reference: '54909', vendor: 'Icon Containment Solutions', subject: '1,638.37 ICN for SU-8001 product line fittings',
          extracted: { total: 1638.37, reference: '54909', lines: [{ qty: 6, part_number: 'IRF TCI-2.0', description: 'Icon SplitRepair Kit', unit_cost: 236.25, line_total: 1417.5 }] } }),
        doc({ id: 'd2', inbox: 'econstruction', kind: 'packing_slip', reference: 'S.O. 54909', vendor: 'Icon Containment Solutions', subject: 'SU 8001 ICON PACKING SLIP',
          extracted: { lines: [{ qty: 6, part_number: 'IRF TCI-2.0', description: 'Icon SplitRepair Kit' }] } }),
      ],
    })
    expect(c.materials).toHaveLength(1)
    expect(c.materialCost).toBe(1638.37)
    expect(c.materials[0].received).toBe(true)
    expect(c.materials[0].lines[0].partNumber).toBe('IRF TCI-2.0')
    expect(c.unpricedOrders).toBe(0)
  })

  it('shows a packing slip with no invoice as an order with no cost yet', () => {
    const c = buildJobCosts({ ...base, docs: [
      doc({ id: 'd1', kind: 'packing_slip', reference: '8544779', vendor: 'Source North America', subject: '28960 SOURCE PACKING SLIP', extracted: { lines: [{ qty: 1, description: 'Spill bucket' }] } }),
      doc({ id: 'd2', kind: 'packing_slip', reference: '8544779', vendor: 'Source North America', subject: 'Fwd: 28960 SOURCE PACKING SLIP', extracted: { lines: [{ qty: 1, description: 'Spill bucket' }] } }),
    ] })
    expect(c.materials).toHaveLength(1)
    expect(c.materials[0].amount).toBeNull()
    expect(c.unpricedOrders).toBe(1)
    expect(c.materialCost).toBe(0)
  })

  it('counts paperwork from before receipts were imported, and a receipt sent in twice only once', () => {
    const c = buildJobCosts({ ...base,
      expenses: [
        exp({ id: 'e1', amount: 265.0, description: 'UNISTRUT NUTS', vendor: 'The Home Depot', source_document_id: 'd1', expense_date: '2026-11-20' }),
        exp({ id: 'e2', amount: 265.11, description: 'UNISTRUT NUTS', vendor: 'The Home Depot', source_document_id: 'd2', expense_date: '2026-11-20' }),
      ],
      docs: [
        doc({ id: 'd1', kind: 'receipt', reference: '2501 00003 52922', vendor: 'The Home Depot', subject: '265-11 TEC UNISTRUT NUTS' }),
        doc({ id: 'd2', kind: 'receipt', reference: '2501 00003 52922', vendor: 'The Home Depot', subject: '265.11 TEC UNISTRUT NUTS' }),
        doc({ id: 'd3', kind: 'vendor_invoice', reference: '70491', vendor: 'Petroleum Management, Inc.', subject: '1,293.75 PMI for 32785 drum pickup', received_at: '2026-03-02T15:00:00Z', extracted: { total: 1293.75 } }),
      ] })
    expect(c.materials).toHaveLength(1)
    expect(c.materials[0].notes).toContain('Sent in twice, counted once')
    expect(c.others).toHaveLength(1)
    expect(c.otherCost).toBe(1293.75)
    expect(c.otherByLabel[0].label).toBe('Disposal & pump-out')
  })

  it('does not count paperwork again when the same charge was keyed in by hand', () => {
    const c = buildJobCosts({ ...base,
      expenses: [exp({ id: 'e1', amount: 540.48, description: 'materials', expense_date: '2026-11-22' })],
      docs: [doc({ id: 'd1', kind: 'receipt', subject: '540.48 TEC 32311 materials needed for job', received_at: '2026-11-23T15:00:00Z' })] })
    expect(c.materialCost).toBe(540.48)
    expect(c.purchases).toHaveLength(1)
  })

  it('counts typed-in material only once it is ordered', () => {
    const c = buildJobCosts({ ...base, manualMaterials: [
      { id: 'm1', job_id: 'job', description: 'Boot', part_number: 'B1', quantity: 2, unit_cost: 50, status: 'ordered', vendor: 'Icon', ordered_date: '2026-11-01' },
      { id: 'm2', job_id: 'job', description: 'Sump', part_number: null, quantity: 1, unit_cost: 900, status: 'needed', vendor: null, ordered_date: null },
    ] })
    expect(c.materialCost).toBe(100)
    expect(c.materials).toHaveLength(2)
  })

  it('adds up labor: ticket hours x crew, daily updates on other days, the labor log at its own rate', () => {
    const c = buildJobCosts({ ...base, companyLaborRate: null, billingLaborRate: 80,
      tickets: [
        { id: 't1', con_job_id: 'job', work_date: '2026-11-17', received_at: null, technician: 'EL', helper: null, onsite_hours: 8.5, crew_size: 4 },
        { id: 't2', con_job_id: 'job', work_date: '2026-11-17', received_at: null, sender_email: 'rpinvoicing@gmail.com', technician: 'Ernie L', helper: 'TW', onsite_hours: 8.5, crew_size: 2 },
      ],
      dailyTechs: [
        { job_id: 'job', work_date: '2026-11-17', tech_name: 'EL', hours: 8.5 },
        { job_id: 'job', work_date: '2026-11-18', tech_name: 'JC', hours: 6 },
      ],
      manualLabor: [{ id: 'l1', job_id: 'job', work_date: '2026-11-19', crew_member: 'TD', hours: 2, labor_rate: 50, task_note: null }],
    })
    expect(c.laborHours).toBe(34 + 6 + 2)
    expect(c.laborCost).toBe(34 * 80 + 6 * 80 + 2 * 50)
    expect(c.laborRateSource).toBe('billing')
    const own = buildJobCosts({ ...base, companyLaborRate: 45, billingLaborRate: 80, dailyTechs: [{ job_id: 'job', work_date: '2026-11-18', tech_name: 'JC', hours: 6 }] })
    expect(own.laborCost).toBe(270)
    expect(own.laborRateSource).toBe('company')
    expect(own.totalCost).toBe(270)
  })
})
