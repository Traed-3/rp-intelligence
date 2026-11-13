import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canUseFieldSurveys } from '@/lib/field-surveys'
import { canReadConstruction } from '@/lib/construction'
import { ACCIDENT_BUCKET, loadAccident } from '@/lib/accident-pdf'

/** GET /forms/accident/[id]/photo/[n] — short-lived signed URL for the n-th photo on the report (same access rule as the report). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile || !canUseFieldSurveys(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const row = await loadAccident(admin, id, profile.company_id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canReadConstruction(profile) && row.created_by !== profile.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const photo = /^\d{1,2}$/.test(n) ? (row.photos ?? [])[Number(n)] : undefined
  if (!photo) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data, error } = await admin.storage.from(ACCIDENT_BUCKET).createSignedUrl(photo.path, 60 * 10)
  if (error || !data) return NextResponse.json({ error: 'Could not sign URL' }, { status: 500 })
  return NextResponse.redirect(data.signedUrl)
}
