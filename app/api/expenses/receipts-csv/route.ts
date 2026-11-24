import { NextRequest, NextResponse } from 'next/server'
import { toCsv } from '@/lib/csv'
import { loadReceiptReport, parseFilters, receiptReportViewer } from '@/lib/receipt-report'

/** The Receipts by payment type report as a spreadsheet, with the same filters as the page. */
export async function GET(request: NextRequest) {
  const viewer = await receiptReportViewer()
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!viewer.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const f = parseFilters(Object.fromEntries(new URL(request.url).searchParams))
  const { groups, nameOf } = await loadReceiptReport(viewer.company_id, f)

  const rows: unknown[][] = [
    ['Payment type', 'Payment name', 'Date', 'Sent by', 'Email', 'Amount', 'Vendor', 'What it was', 'Charged to', 'Card last 4', 'On bill', 'Receipt link'],
    ...groups.flatMap(g => g.rows.map(r => [
      r.code, nameOf(r.code), r.date, r.who, r.email ?? '', r.amount.toFixed(2), r.vendor, r.description, r.chargedTo,
      r.cardLast4 ?? '', r.checked ? 'Yes' : '', r.receiptUrl ?? '',
    ])),
  ]
  const name = `receipts_${(f.pay || 'all').toLowerCase().replace(/[^a-z0-9]/g, '')}_${f.from}_${f.to}.csv`
  return new NextResponse(toCsv(rows), {
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${name}"` },
  })
}
