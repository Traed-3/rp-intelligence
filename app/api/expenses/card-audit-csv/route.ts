import { NextRequest, NextResponse } from 'next/server'
import { cardAuditViewer, loadCardAudit } from '@/lib/card-audit-data'
import { FLAG_LABEL } from '@/lib/card-audit'

const cell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  // Quote everything and neutralise spreadsheet formulas (=, +, -, @) typed into subject lines.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}

export async function GET(request: NextRequest) {
  const viewer = await cardAuditViewer()
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!viewer.allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sp = new URL(request.url).searchParams
  const { range, rows, code } = await loadCardAudit(viewer.company_id, sp.get('card') ?? 'TEC', sp.get('month') ?? undefined)
  const lines = [
    ['Date', 'Submitted by', 'Amount (subject)', 'Receipt total', 'Vendor', 'Reference', 'Job / asset', 'What it was for', 'Flags', 'Matched to statement'],
    ...rows.map(r => [r.date, r.who, r.amount, r.receiptTotal, r.vendor, r.reference, r.job, r.description, r.flags.map(f => FLAG_LABEL[f]).join('; '), r.matched ? 'yes' : '']),
  ]
  const csv = lines.map(l => l.map(cell).join(',')).join('\r\n')
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="card-audit-${code}-${range.ym}.csv"`,
    },
  })
}
