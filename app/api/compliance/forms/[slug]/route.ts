import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { complianceCaller } from '@/lib/compliance-guard'
import { HR_BUCKET } from '@/lib/compliance'
import { FORMS_PREFIX, NO_PRIOR_DOT_SLUG, formBySlug } from '@/lib/compliance-forms'
import { renderNoPriorDotNote, type NoteDriver } from '@/lib/compliance-note-pdf'

/**
 * Blank RP DOT forms for anyone with DQF & Certs access.
 *   /api/compliance/forms/<slug>              opens the PDF in the browser
 *   /api/compliance/forms/<slug>?download=1   saves it
 *   /api/compliance/forms/no-prior-dot-note?employee=<id>   the note filled in for one driver
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const me = await complianceCaller()
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const form = formBySlug(slug)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const download = request.nextUrl.searchParams.get('download') === '1'
  const admin = createAdminClient()

  if (slug === NO_PRIOR_DOT_SLUG) {
    const employeeId = request.nextUrl.searchParams.get('employee')
    let driver: NoteDriver | null = null
    let filename = form.filename
    if (employeeId) {
      const { data: e } = await admin.from('hr_employees')
        .select('full_name, hire_date, license_number, license_state, no_prior_dot_employer, no_prior_dot_noted_at, no_prior_dot_noted_by')
        .eq('id', employeeId).eq('company_id', me.company_id).maybeSingle()
      if (!e) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      driver = {
        full_name: e.full_name, hire_date: e.hire_date, license_number: e.license_number, license_state: e.license_state,
        noted_at: e.no_prior_dot_employer ? e.no_prior_dot_noted_at : null, noted_by: e.no_prior_dot_employer ? e.no_prior_dot_noted_by : null,
      }
      filename = `${String(e.full_name).replace(/[^\w .,'-]+/g, '').trim()} - No Previous DOT Employer Note.pdf`
    }
    const pdf = await renderNoPriorDotNote(driver)
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename.replace(/"/g, '')}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  }

  const { data, error } = await admin.storage.from(HR_BUCKET)
    .createSignedUrl(`${FORMS_PREFIX}${form.slug}.pdf`, 60 * 5, download ? { download: form.filename } : undefined)
  if (error || !data) return NextResponse.json({ error: 'This form has not been loaded yet.' }, { status: 404 })
  return NextResponse.redirect(data.signedUrl)
}
