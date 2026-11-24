import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canWriteConstruction, CON_DOC_CATEGORY_VALUES, classifyDocument } from '@/lib/construction'

const BUCKET = 'construction-docs'

// Upload a construction document (permit, signed quote, close-out photo, …)
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
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const jobId = (formData.get('job_id') as string)?.trim() || null
  const quoteId = (formData.get('quote_id') as string)?.trim() || null
  const invoiceId = (formData.get('invoice_id') as string)?.trim() || null

  // Category is the primary filing dimension. Fall back to a best-guess from
  // the filename when the uploader didn't pick one.
  const guess = classifyDocument(file.name)
  const rawCategory = (formData.get('category') as string)?.trim() || ''
  const category = CON_DOC_CATEGORY_VALUES.includes(rawCategory) ? rawCategory : guess.category
  const docType = (formData.get('doc_type') as string)?.trim() || guess.docType

  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)
  const path = `${profile.company_id}/${jobId ?? quoteId ?? invoiceId ?? 'general'}/${Date.now()}-${safe || `file.${ext}`}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const fileHash = createHash('sha256').update(buffer).digest('hex')
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { error: insErr } = await admin.from('con_documents').insert({
    company_id: profile.company_id,
    job_id: jobId,
    quote_id: quoteId,
    invoice_id: invoiceId,
    file_name: file.name,
    original_filename: file.name,
    storage_path: path,
    category,
    doc_type: docType,
    file_hash: fileHash,
    review_status: 'filed',
    uploaded_by: profile.id,
  })
  if (insErr) {
    // best-effort cleanup so we don't orphan the upload
    await admin.storage.from(BUCKET).remove([path])
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
