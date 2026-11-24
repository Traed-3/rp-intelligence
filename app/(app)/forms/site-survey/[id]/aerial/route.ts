import { NextRequest, NextResponse } from 'next/server'
import { SITE_SURVEY_BUCKET } from '@/lib/site-survey-pdf'
import { surveyForRequest } from '../../guard'

/** GET /forms/site-survey/[id]/aerial — the aerial picture behind the site plan (signed redirect). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const got = await surveyForRequest(id)
  if (got.refuse) return got.refuse
  const path = got.row.plan?.aerial?.path
  if (!path) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data, error } = await got.admin.storage.from(SITE_SURVEY_BUCKET).createSignedUrl(path, 60 * 10)
  if (error || !data) return NextResponse.json({ error: 'Could not sign URL' }, { status: 500 })
  return NextResponse.redirect(data.signedUrl)
}
