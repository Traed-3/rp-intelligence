import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canWriteConstruction } from '@/lib/construction'

const BUCKET = 'construction-docs'

// Add a permit deliverable — a file (optional) plus its metadata — to a site.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile || !canWriteConstruction(profile)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const formData = await request.formData()
  const siteId = (formData.get('site_id') as string)?.trim() || null
  const type = (formData.get('type') as string)?.trim() || null
  const openItems = (formData.get('open_items') as string)?.trim() || null
  const whereItLives = (formData.get('where_it_lives') as string)?.trim() || null
  const file = formData.get('file') as File | null

  if (!type && !file) return NextResponse.json({ error: 'Add a type or a file.' }, { status: 400 })

  let storagePath: string | null = null
  let filename: string | null = null
  if (file && file.size > 0) {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)
    storagePath = `${profile.company_id}/permits/${siteId ?? 'general'}/${Date.now()}-${safe || 'file'}`
    filename = file.name
    const buffer = Buffer.from(await file.arrayBuffer())
    const { error: upErr } = await admin.storage.from(BUCKET)
      .upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  const { error: insErr } = await admin.from('con_permit_deliverables').insert({
    company_id: profile.company_id,
    site_id: siteId,
    type,
    filename,
    storage_path: storagePath,
    where_it_lives: whereItLives ?? (storagePath ? 'Uploaded to RP Intelligence' : null),
    open_items: openItems,
  })
  if (insErr) {
    if (storagePath) await admin.storage.from(BUCKET).remove([storagePath])
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  // Mirror into the job's Documents tab too — every other job document already
  // lives there, and a permit's job link is what makes it a "project" file.
  if (storagePath && filename && siteId) {
    const { data: project } = await admin.from('con_permit_projects')
      .select('job_id').eq('site_id', siteId).eq('company_id', profile.company_id).not('job_id', 'is', null).limit(1).maybeSingle()
    if (project?.job_id) {
      await admin.from('con_documents').insert({
        company_id: profile.company_id, job_id: project.job_id,
        file_name: filename, storage_path: storagePath, doc_type: 'permit', category: 'permits',
        uploaded_by: profile.id,
      })
    }
  }

  return NextResponse.json({ ok: true })
}
