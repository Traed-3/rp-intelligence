import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUseFieldSurveys } from '@/lib/field-surveys'
import { canReadConstruction } from '@/lib/construction'
import { pretripFileName } from '@/lib/pretrip'
import { loadPretrip, renderPretripPdf } from '@/lib/pretrip-pdf'

export const runtime = 'nodejs'
export const maxDuration = 60

/** GET /forms/pre-trip/[id]/pdf — the inspection sheet as a PDF, drawn from the saved row. ?download=1 saves it instead of opening it. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile || !canUseFieldSurveys(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const row = await loadPretrip(admin, id, profile.company_id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canReadConstruction(profile) && row.created_by !== profile.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const pdf = await renderPretripPdf(row)
  const disposition = request.nextUrl.searchParams.get('download') ? 'attachment' : 'inline'
  return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${disposition}; filename="${pretripFileName(row).replace(/"/g, '')}"`, 'Cache-Control': 'no-store' } })
}
