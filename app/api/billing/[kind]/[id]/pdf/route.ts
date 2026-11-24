import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canReadBilling } from '@/lib/billing-guard'
import { renderBillingPdf, docFromRow } from '@/lib/billing-pdf'

export const runtime = 'nodejs'

/** GET /api/billing/quotes|invoices/[id]/pdf?view=face|breakdown|both */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params
  if (kind !== 'quotes' && kind !== 'invoices') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile || !canReadBilling(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const table = kind === 'quotes' ? 'con_quotes' : 'con_invoices'
  const lineTable = kind === 'quotes' ? 'con_quote_line_items' : 'con_invoice_line_items'
  const fk = kind === 'quotes' ? 'quote_id' : 'invoice_id'
  const { data: row } = await admin.from(table).select('*, con_customers(name, billing_address)').eq('id', id).eq('company_id', profile.company_id).single()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data: lines } = await admin.from(lineTable).select('*').eq(fk, id).order('sort_order').order('section').order('line_no')

  const view = (request.nextUrl.searchParams.get('view') as 'face' | 'breakdown' | 'both' | null) ?? 'both'
  const { doc, items } = docFromRow(kind === 'quotes' ? 'quote' : 'invoice', row as Record<string, unknown>, (row as { con_customers: { name: string; billing_address: string | null } | null }).con_customers, (lines ?? []) as Record<string, unknown>[])
  const detailParam = request.nextUrl.searchParams.get('detail')   // detail=1 lists every line on the face; detail=0 rolls up by category
  const pdf = await renderBillingPdf(doc, items, ['face', 'breakdown', 'both'].includes(view) ? view : 'both', detailParam == null ? {} : { detail: detailParam === '1' })
  return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${doc.number}${view === 'breakdown' ? '-breakdown' : ''}.pdf"` } })
}
