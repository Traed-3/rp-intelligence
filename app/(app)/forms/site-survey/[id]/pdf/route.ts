import { NextRequest, NextResponse } from 'next/server'
import { surveyFileName } from '@/lib/site-survey'
import { renderSiteSurveyPdf } from '@/lib/site-survey-pdf'
import { surveyForRequest } from '../../guard'

export const runtime = 'nodejs'
export const maxDuration = 120

/** GET /forms/site-survey/[id]/pdf — the survey as a PDF, drawn from the saved row. ?download=1 saves it instead of opening it. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const got = await surveyForRequest(id)
  if (got.refuse) return got.refuse
  const pdf = await renderSiteSurveyPdf(got.admin, got.row)
  const disposition = request.nextUrl.searchParams.get('download') ? 'attachment' : 'inline'
  return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${disposition}; filename="${surveyFileName(got.row).replace(/"/g, '')}"`, 'Cache-Control': 'no-store' } })
}
