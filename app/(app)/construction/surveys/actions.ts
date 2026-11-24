'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canEditFieldSurveys, surveyOwnOnly } from '@/lib/field-surveys'
import { type SurveyEntry, type Worksheet, type LidMeasure, type SumpType, surveyTitle, composeSumpLabel, SURVEY_TYPES, SUMP_TYPES } from '@/lib/survey'
import { renderSurveyPdf, loadSurveyBundle } from '@/lib/survey-pdf'
import { buildSurveyEmail } from '@/lib/order-email'

const BUCKET = 'construction-docs'
const str = (v: FormDataEntryValue | null) => { const s = (v as string | null)?.trim(); return s || null }

/** Signed-in survey user. Pass the survey id on every action that touches an existing survey: the locked-down
 *  field_surveyor role may only change surveys it created. */
async function me(surveyId?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const admin = createAdminClient()
  const { data: p } = await admin.from('profiles').select('id, company_id, role, full_name, phone, email').eq('id', user.id).single()
  if (!p || !canEditFieldSurveys(p)) throw new Error('No field survey access')
  if (surveyId && surveyOwnOnly(p.role)) {
    const { data: own } = await admin.from('con_surveys').select('created_by').eq('id', surveyId).eq('company_id', p.company_id).maybeSingle()
    if (!own || own.created_by !== p.id) throw new Error('That survey belongs to someone else')
  }
  return { admin, p }
}
const touch = (id: string) => { revalidatePath('/construction/surveys'); revalidatePath(`/construction/surveys/${id}`); revalidatePath('/mobile/survey') }

/** New survey: site + job picked (or typed), tech defaults from the signed-in profile. Lands on the editor. */
export async function createSurvey(formData: FormData): Promise<void> {
  const { admin, p } = await me()
  const jobId = str(formData.get('job_id'))
  let site = str(formData.get('site_number')), siteName = str(formData.get('site_name')), address = str(formData.get('address'))
  if (jobId) {
    const { data: j } = await admin.from('con_jobs').select('site_number, gas_brand, con_sites(address)').eq('id', jobId).maybeSingle()
    if (j) { site = site ?? j.site_number; siteName = siteName ?? (j.gas_brand as string | null); address = address ?? ((j.con_sites as unknown as { address: string | null } | null)?.address ?? null) }
  }
  const surveyType = str(formData.get('survey_type')) ?? 'icon_fittings'
  const chosen = SURVEY_TYPES.find(t => t.value === surveyType)
  if (!chosen || !chosen.ready) throw new Error(`${chosen?.label ?? surveyType} is not ready yet`)
  const { data, error } = await admin.from('con_surveys').insert({
    company_id: p.company_id, job_id: jobId, survey_type: surveyType, site_number: site, site_name: siteName, address,
    survey_date: str(formData.get('survey_date')) ?? new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
    tech_name: str(formData.get('tech_name')) ?? p.full_name, tech_phone: str(formData.get('tech_phone')) ?? p.phone, tech_email: str(formData.get('tech_email')) ?? p.email,
    created_by: p.id,
  }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'could not create survey')
  const st = (str(formData.get('sump_type')) ?? 'udc') as SumpType, sn = str(formData.get('sump_number'))
  await admin.from('con_survey_sumps').insert({ company_id: p.company_id, survey_id: data.id, sort_order: 1, sump_type: st, sump_number: sn, sump_label: composeSumpLabel(st, sn), location: SUMP_TYPES.find(t => t.value === st)?.location ?? null, entries: [{ kind: 'P', n: 1, fitting: null, bolts: null, pipe: null, od: null, notes: null }] })
  touch(data.id)
  redirect(`/construction/surveys/${data.id}`)
}

export async function saveSurveyHeader(id: string, formData: FormData): Promise<void> {
  const { admin, p } = await me(id)
  const patch = { site_number: str(formData.get('site_number')), site_name: str(formData.get('site_name')), address: str(formData.get('address')), survey_date: str(formData.get('survey_date')), tech_name: str(formData.get('tech_name')), tech_phone: str(formData.get('tech_phone')), tech_email: str(formData.get('tech_email')), notes: str(formData.get('notes')), job_id: str(formData.get('job_id')), updated_at: new Date().toISOString() }
  const { error } = await admin.from('con_surveys').update(patch).eq('id', id).eq('company_id', p.company_id)
  if (error) throw new Error(error.message)
  touch(id)
}

export async function addSump(surveyId: string, formData: FormData): Promise<void> {
  const { admin, p } = await me(surveyId)
  const { count } = await admin.from('con_survey_sumps').select('id', { count: 'exact', head: true }).eq('survey_id', surveyId)
  const st = (str(formData.get('sump_type')) ?? 'udc') as SumpType, sn = str(formData.get('sump_number'))
  const { error } = await admin.from('con_survey_sumps').insert({ company_id: p.company_id, survey_id: surveyId, sort_order: (count ?? 0) + 1, sump_type: st, sump_number: sn, sump_label: composeSumpLabel(st, sn), location: SUMP_TYPES.find(t => t.value === st)?.location ?? null, entries: [{ kind: 'P', n: 1, fitting: null, bolts: null, pipe: null, od: null, notes: null }] })
  if (error) throw new Error(error.message)
  touch(surveyId)
}

/** The whole sump card posts at once: type boxes, leak, worksheets, every entry row, lid measurements, damage text. */
export async function saveSump(surveyId: string, sumpId: string, formData: FormData): Promise<void> {
  const { admin, p } = await me(surveyId)
  let entries: SurveyEntry[] = []
  try { entries = JSON.parse((formData.get('entries') as string) || '[]') } catch { entries = [] }
  entries = entries.filter(e => e && ['P', 'V', 'C'].includes(e.kind)).map(e => ({ kind: e.kind, n: Number(e.n) || 1, fitting: e.fitting || null, bolts: e.bolts ? Number(e.bolts) : null, pipe: e.pipe || null, od: e.od || null, notes: e.notes || null }))
  const worksheets = formData.getAll('worksheets').map(String).filter(w => ['fittings', 'lid', 'damage'].includes(w)) as Worksheet[]
  const lid: LidMeasure = { a: str(formData.get('lid_a')) ?? undefined, b: str(formData.get('lid_b')) ?? undefined, c: str(formData.get('lid_c')) ?? undefined, d: str(formData.get('lid_d')) ?? undefined, e: str(formData.get('lid_e')) ?? undefined }
  const leak = str(formData.get('active_leak'))
  const st = (str(formData.get('sump_type')) ?? null) as SumpType | null, sn = str(formData.get('sump_number'))
  const { error } = await admin.from('con_survey_sumps').update({
    sump_type: st, sump_number: sn, sump_label: composeSumpLabel(st, sn), location: str(formData.get('location')), material: str(formData.get('material')), profile: str(formData.get('profile')),
    active_leak: leak === 'yes' ? true : leak === 'no' ? false : null, worksheets: worksheets.length ? worksheets : ['fittings'], entries,
    lid: Object.values(lid).some(Boolean) ? lid : null, damage: str(formData.get('damage')), notes: str(formData.get('notes')), updated_at: new Date().toISOString(),
  }).eq('id', sumpId).eq('survey_id', surveyId).eq('company_id', p.company_id)
  if (error) throw new Error(error.message)
  await admin.from('con_surveys').update({ updated_at: new Date().toISOString() }).eq('id', surveyId)
  touch(surveyId)
}

export async function deleteSump(surveyId: string, sumpId: string): Promise<void> {
  const { admin, p } = await me(surveyId)
  await admin.from('con_survey_sumps').delete().eq('id', sumpId).eq('survey_id', surveyId).eq('company_id', p.company_id)
  touch(surveyId)
}

/** Photos straight from the phone camera (input capture=environment) or the roll; several at once; tied to the sump and optionally one entry. */
export async function addSurveyPhotos(surveyId: string, sumpId: string | null, formData: FormData): Promise<void> {
  const { admin, p } = await me(surveyId)
  const files = formData.getAll('photos').filter((f): f is File => typeof f === 'object' && !!f && (f as File).size > 0)
  if (!files.length) return
  const entryRef = str(formData.get('entry_ref'))
  const caption = str(formData.get('caption'))
  const { count } = await admin.from('con_survey_photos').select('id', { count: 'exact', head: true }).eq('survey_id', surveyId)
  let n = count ?? 0
  const sharp = (await import('sharp')).default
  for (const f of files) {
    const safe = (f.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60) || 'photo.jpg').replace(/\.(heic|heif|png|webp)$/i, '.jpg')
    const path = `${p.company_id}/surveys/${surveyId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`
    // Store a normalized JPEG (auto-rotated, EXIF dropped, long side 1920 px): a third of the bytes, and the PDF can always read it.
    let buf: Buffer = Buffer.from(await f.arrayBuffer()); let type = f.type || 'image/jpeg'
    try { buf = await sharp(buf).rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer(); type = 'image/jpeg' } catch { /* keep the original bytes */ }
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buf, { contentType: type, upsert: true })
    if (upErr) throw new Error(`upload ${f.name}: ${upErr.message}`)
    n++
    await admin.from('con_survey_photos').insert({ company_id: p.company_id, survey_id: surveyId, sump_id: sumpId, storage_path: path, file_name: f.name, caption, entry_ref: entryRef, sort_order: n, taken_at: f.lastModified ? new Date(f.lastModified).toISOString() : null })
  }
  touch(surveyId)
}

export async function updatePhoto(surveyId: string, photoId: string, formData: FormData): Promise<void> {
  const { admin, p } = await me(surveyId)
  await admin.from('con_survey_photos').update({ caption: str(formData.get('caption')), entry_ref: str(formData.get('entry_ref')) }).eq('id', photoId).eq('survey_id', surveyId).eq('company_id', p.company_id)
  touch(surveyId)
}

export async function deletePhoto(surveyId: string, photoId: string): Promise<void> {
  const { admin, p } = await me(surveyId)
  const { data } = await admin.from('con_survey_photos').select('storage_path').eq('id', photoId).eq('company_id', p.company_id).maybeSingle()
  if (data?.storage_path) await admin.storage.from(BUCKET).remove([data.storage_path])
  await admin.from('con_survey_photos').delete().eq('id', photoId).eq('survey_id', surveyId)
  touch(surveyId)
}

/**
 * Finish: render the ICON-style PDF (worksheet per sump + photo pages), file it on the job under Documents, mark the
 * survey complete, and put the "send to ICON" email on the plate as a drafted order-email task with the PDF attached.
 */
export async function completeSurvey(id: string): Promise<void> {
  const { admin, p } = await me(id)
  const bundle = await loadSurveyBundle(admin, id, p.company_id)
  if (!bundle) throw new Error('survey not found')
  const pdf = await renderSurveyPdf(bundle)
  const title = surveyTitle(bundle.survey)
  const fileName = `${(bundle.survey.site_number ?? 'survey').replace(/[^A-Za-z0-9-]+/g, '')} Sump Survey ${bundle.survey.survey_date}.pdf`
  const path = `${p.company_id}/surveys/${id}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (upErr) throw new Error(upErr.message)
  const { data: doc } = await admin.from('con_documents').insert({
    company_id: p.company_id, job_id: bundle.survey.job_id, file_name: fileName, original_filename: fileName, storage_path: path,
    category: 'photos', doc_type: 'icon_survey', review_status: 'filed', uploaded_by: p.id, imported_by: 'field_survey', imported_at: new Date().toISOString(),
  }).select('id').single()
  await admin.from('con_surveys').update({ status: 'complete', pdf_document_id: doc?.id ?? null, updated_at: new Date().toISOString() }).eq('id', id)
  // The email to ICON, in Trae's voice, ready on the plate. The app never sends mail.
  const draft = buildSurveyEmail({ site: bundle.survey.site_number ?? title, siteName: bundle.survey.site_name, address: bundle.survey.address, sumps: bundle.sumps.map(s => s.sump_label), request: 'quote' })
  const { data: owner } = await admin.from('profiles').select('id').eq('company_id', p.company_id).eq('email', 'dodson3.trae@gmail.com').maybeSingle()
  await admin.from('con_tasks').upsert({
    company_id: p.company_id, owner_id: owner?.id ?? p.id, kind: 'order', site_number: bundle.survey.site_number, job_id: bundle.survey.job_id, priority: 2, status: 'open',
    title: `Send ${title} sump survey to ICON for part numbers`, detail: `Survey ${bundle.survey.survey_date} by ${bundle.survey.tech_name ?? 'tech'}: ${bundle.sumps.map(s => s.sump_label).join(', ')}. PDF is on the job under Documents.`,
    source: 'signal', source_key: `survey|${id}`, action: { type: 'order_email', vendor: 'icon_support', draft, draft_status: 'drafted', drafted_at: new Date().toISOString(), attachments: [{ bucket: BUCKET, path, name: fileName }], survey_id: id },
  }, { onConflict: 'company_id,owner_id,source_key' })
  touch(id); revalidatePath('/my')
  if (bundle.survey.job_id) revalidatePath(`/construction/jobs/${bundle.survey.job_id}`)
}

export async function reopenSurvey(id: string): Promise<void> {
  const { admin, p } = await me(id)
  await admin.from('con_surveys').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', id).eq('company_id', p.company_id)
  touch(id)
}

export async function deleteSurvey(id: string): Promise<void> {
  const { admin, p } = await me(id)
  const { data: photos } = await admin.from('con_survey_photos').select('storage_path').eq('survey_id', id).eq('company_id', p.company_id)
  if (photos?.length) await admin.storage.from(BUCKET).remove(photos.map(x => x.storage_path))
  await admin.from('con_surveys').delete().eq('id', id).eq('company_id', p.company_id)
  revalidatePath('/construction/surveys'); revalidatePath('/mobile/survey')
  redirect('/construction/surveys')
}
