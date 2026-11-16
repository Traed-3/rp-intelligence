import { NextRequest, NextResponse } from 'next/server'
import { SITE_SURVEY_BUCKET } from '@/lib/site-survey-pdf'
import { surveyForRequest } from '../../../guard'

/** GET /forms/site-survey/[id]/photo/[pid] — short-lived signed URL for one photo on the survey (same access rule as the survey). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params
  const got = await surveyForRequest(id)
  if (got.refuse) return got.refuse
  const photo = (got.row.photos ?? []).find(p => p.id === pid)
  if (!photo) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data, error } = await got.admin.storage.from(SITE_SURVEY_BUCKET).createSignedUrl(photo.path, 60 * 10)
  if (error || !data) return NextResponse.json({ error: 'Could not sign URL' }, { status: 500 })
  return NextResponse.redirect(data.signedUrl)
}
