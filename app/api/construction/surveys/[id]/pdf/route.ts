import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUseFieldSurveys, surveyOwnOnly } from '@/lib/field-surveys'
import { loadSurveyBundle, renderSurveyPdf } from '@/lib/survey-pdf'
import { surveyTitle } from '@/lib/survey'

export const runtime = 'nodejs'
export const maxDuration = 60

/** GET /api/construction/surveys/[id]/pdf — the ICON-style survey package, rendered live from the current rows. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile || !canUseFieldSurveys(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (surveyOwnOnly(profile.role)) {
    const { data: own } = await admin.from('con_surveys').select('created_by').eq('id', id).eq('company_id', profile.company_id).maybeSingle()
    if (!own || own.created_by !== profile.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const bundle = await loadSurveyBundle(admin, id, profile.company_id)
  if (!bundle) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const pdf = await renderSurveyPdf(bundle)
  return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${surveyTitle(bundle.survey).replace(/[^A-Za-z0-9 ·-]+/g, '')} sump survey ${bundle.survey.survey_date}.pdf"` } })
}
