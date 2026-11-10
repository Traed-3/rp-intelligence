import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUseFieldSurveys, surveyOwnOnly } from '@/lib/field-surveys'
import { loadTestBundle, renderTestPdf, testPdfFileName } from '@/lib/containment-test-pdf'

export const runtime = 'nodejs'
export const maxDuration = 60

/** GET /api/construction/surveys/tests/[id]/pdf — the state-form PDF. Live from the rows, or ?saved=1 for the copy filed at Finish. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile || !canUseFieldSurveys(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const bundle = await loadTestBundle(admin, id, profile.company_id)
  if (!bundle) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (surveyOwnOnly(profile.role) && bundle.test.created_by !== profile.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const name = testPdfFileName(bundle.test)
  let pdf: Buffer | null = null
  if (request.nextUrl.searchParams.get('saved') && bundle.test.pdf_path) {
    const { data } = await admin.storage.from('construction-docs').download(bundle.test.pdf_path)
    if (data) pdf = Buffer.from(await data.arrayBuffer())
  }
  pdf ??= await renderTestPdf(bundle)
  return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name.replace(/"/g, '')}"`, 'Cache-Control': 'no-store' } })
}
