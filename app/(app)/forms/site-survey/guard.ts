import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUseFieldSurveys, isSurveyOnly } from '@/lib/field-surveys'
import { roleMayVisit } from '@/lib/role-access'
import { SITE_SURVEY_PATH } from '@/lib/site-survey'
import { canReadConstruction } from '@/lib/construction'
import { loadSiteSurvey } from '@/lib/site-survey-pdf'

/** Shared by the PDF, photo and aerial routes: the survey when the signed-in person may see it, else the refusal to send. */
export async function surveyForRequest(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { refuse: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile || !canUseFieldSurveys(profile) || isSurveyOnly(profile.role) || !roleMayVisit(profile.role, SITE_SURVEY_PATH)) return { refuse: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const row = await loadSiteSurvey(admin, id, profile.company_id)
  if (!row) return { refuse: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  if (!canReadConstruction(profile) && row.created_by !== profile.id) return { refuse: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { admin, row }
}
