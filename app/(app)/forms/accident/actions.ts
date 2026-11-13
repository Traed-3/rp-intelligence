'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canEditFieldSurveys } from '@/lib/field-surveys'
import { canReadConstruction } from '@/lib/construction'
import { type AccidentRow, type AccidentPhoto, type AccidentValue, ACCIDENT_FIELDS, ACCIDENT_NOTIFY, MAX_PHOTOS, isShown, missingForFinish, accidentFlags, accidentFileName, fmtDate } from '@/lib/accident'
import { ACCIDENT_BUCKET, loadAccident, renderAccidentPdf } from '@/lib/accident-pdf'
import { sendDocumentEmail } from '@/lib/email'

const TABLE = 'accident_reports'
const str = (v: FormDataEntryValue | null) => { const s = (v as string | null)?.trim(); return s || null }
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

/** Signed-in person with Forms access. Techs only touch reports they started; the construction office roles see all. */
async function me(id?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const admin = createAdminClient()
  const { data: p } = await admin.from('profiles').select('id, company_id, role, full_name, email').eq('id', user.id).single()
  if (!p || !canEditFieldSurveys(p)) throw new Error('No access to Forms')
  let row: AccidentRow | null = null
  if (id) {
    row = await loadAccident(admin, id, p.company_id)
    if (!row) throw new Error('Report not found')
    if (!canReadConstruction(p) && row.created_by !== p.id) throw new Error('That report belongs to someone else')
  }
  return { admin, p, row }
}
const touch = (id?: string) => { revalidatePath('/forms/accident'); if (id) revalidatePath(`/forms/accident/${id}`) }

/** The asset whose unit number matches what was typed (so the report shows up against the truck). */
async function assetFor(admin: ReturnType<typeof createAdminClient>, companyId: string, unit: string | null): Promise<string | null> {
  if (!unit) return null
  const { data } = await admin.from('assets').select('id').eq('company_id', companyId).ilike('unit_number', unit.replace(/[%_\\]/g, '\\$&')).limit(1)
  return data?.[0]?.id ?? null
}

/** Draws the PDF and emails it. Records who it went to on the report. `updated` marks a re-send after a reopen. */
async function sendReport(admin: ReturnType<typeof createAdminClient>, r: AccidentRow, to: string[], replyTo: string | null, updated = false): Promise<{ ok: true } | { ok: false; error: string }> {
  const pdf = await renderAccidentPdf(admin, r)
  const flags = accidentFlags(r)
  const subject = `Accident Report${updated ? ' (updated)' : ''} - ${[r.unit_number, r.employee_name, fmtDate(r.accident_date)].filter(Boolean).join(' - ')}`
  const body = [
    `Attached is the ${updated ? 'updated ' : ''}accident report for ${r.unit_number ? `truck ${r.unit_number}` : 'a work vehicle'}, ${fmtDate(r.accident_date)}, filed by ${r.employee_name ?? 'the driver'}.`,
    ...(r.location ? ['', `Location: ${r.location}`] : []),
    ...(r.reported_to ? [`Reported to: ${r.reported_to}`] : []),
    ...(flags.length ? ['', `Involves: ${flags.join(', ')}.`] : []),
    '', `Open it in RP Intelligence: https://rpintelligence.app/forms/accident/${r.id}`,
  ].join('\n')
  const sent = await sendDocumentEmail({ to, subject, body, attachment: { filename: accidentFileName(r), content: pdf }, replyTo })
  if (!sent.ok) return { ok: false, error: sent.error }
  await admin.from(TABLE).update({ emailed_to: to.join(', '), emailed_at: new Date().toISOString() }).eq('id', r.id).eq('company_id', r.company_id)
  return { ok: true }
}

/** New report: today's date and the signed-in person's name are filled in to start. */
export async function createReport(): Promise<void> {
  const { admin, p } = await me()
  const { data, error } = await admin.from(TABLE).insert({ company_id: p.company_id, accident_date: today(), employee_name: p.full_name, created_by: p.id }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Could not start the report')
  touch()
  redirect(`/forms/accident/${data.id}`)
}

export type SubmitResult = { ok: boolean; saved?: boolean; missing?: string[]; error?: string }

/** Save the whole report. The Submit button posts the same form with intent=finish: it saves, then checks nothing required is blank. */
export async function submitReport(id: string, _prev: SubmitResult | null, formData: FormData): Promise<SubmitResult> {
  try {
    const { admin, p, row } = await me(id)
    if (row!.status !== 'draft') return { ok: false, error: 'This report is submitted. Reopen it to make changes.' }
    const patch: Record<string, AccidentValue> = {}
    for (const f of ACCIDENT_FIELDS) {
      const raw = formData.get(f.key)
      if (f.type === 'yesno') patch[f.key] = raw === 'yes' ? true : raw === 'no' ? false : null
      else if (f.type === 'date') { const v = str(raw); patch[f.key] = v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null }
      else patch[f.key] = str(raw)?.slice(0, 6000) ?? null
    }
    // A follow-up answer only counts while its Yes is still Yes (switching to No clears what was typed under it).
    for (const f of ACCIDENT_FIELDS) if (!isShown(f, patch)) patch[f.key] = null
    if (!patch.accident_date) patch.accident_date = row!.accident_date ?? today()
    const full = { ...patch, asset_id: await assetFor(admin, p.company_id, patch.unit_number as string | null), updated_at: new Date().toISOString() }
    const { error } = await admin.from(TABLE).update(full).eq('id', id).eq('company_id', p.company_id)
    if (error) return { ok: false, error: error.message }
    if (formData.get('intent') === 'finish') {
      const missing = missingForFinish(patch)
      if (!row!.signature) missing.push('Employee signature (sign below, then press Submit again)')
      if (missing.length) { touch(id); return { ok: false, saved: true, missing } }
      const { error: e2 } = await admin.from(TABLE).update({ status: 'complete', completed_at: new Date().toISOString() }).eq('id', id).eq('company_id', p.company_id)
      if (e2) return { ok: false, error: e2.message }
      // Submitted: the office gets the PDF straight away. A failed email never blocks the report; the submitted
      // screen shows that it did not go (emailed_at stays empty) with a button to send it again.
      await admin.from(TABLE).update({ emailed_to: null, emailed_at: null }).eq('id', id).eq('company_id', p.company_id)
      const fresh = await loadAccident(admin, id, p.company_id)
      if (fresh) await sendReport(admin, fresh, [...ACCIDENT_NOTIFY], p.email, !!row!.emailed_at).catch(() => null)
    }
    touch(id)
    return { ok: true, saved: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Photos from the phone camera or the roll. The browser shrinks them first; here they become plain JPEGs with the location data stripped. */
export async function addPhotos(id: string, formData: FormData): Promise<{ error?: string }> {
  try {
    const { admin, p, row } = await me(id)
    if (row!.status !== 'draft') return { error: 'This report is submitted. Reopen it to add photos.' }
    const files = formData.getAll('photos').filter((f): f is File => typeof f === 'object' && !!f && (f as File).size > 0)
    const photos: AccidentPhoto[] = [...(row!.photos ?? [])]
    if (photos.length + files.length > MAX_PHOTOS) return { error: `A report holds up to ${MAX_PHOTOS} photos` }
    const sharp = (await import('sharp')).default
    for (const f of files) {
      if (f.size > 12_000_000) return { error: `${f.name} is too large` }
      let buf: Buffer
      try { buf = await sharp(Buffer.from(await f.arrayBuffer())).rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer() }
      catch { return { error: `${f.name} is not a photo this form can read` } }
      const path = `${p.company_id}/accident-reports/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
      const { error } = await admin.storage.from(ACCIDENT_BUCKET).upload(path, buf, { contentType: 'image/jpeg' })
      if (error) return { error: `Upload failed: ${error.message}` }
      photos.push({ path, name: f.name.slice(0, 80) })
    }
    const { error } = await admin.from(TABLE).update({ photos, updated_at: new Date().toISOString() }).eq('id', id).eq('company_id', p.company_id)
    if (error) return { error: error.message }
    touch(id)
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export async function deletePhoto(id: string, path: string): Promise<void> {
  const { admin, p, row } = await me(id)
  if (row!.status !== 'draft') throw new Error('This report is submitted. Reopen it to make changes.')
  const photos = (row!.photos ?? []).filter(ph => ph.path !== path)
  if (photos.length === (row!.photos ?? []).length) return
  await admin.storage.from(ACCIDENT_BUCKET).remove([path])
  await admin.from(TABLE).update({ photos, updated_at: new Date().toISOString() }).eq('id', id).eq('company_id', p.company_id)
  touch(id)
}

/** The employee signs on the phone screen; the PNG (data URL) prints on the signature line. */
export async function saveSignature(id: string, dataUrl: string | null): Promise<void> {
  const { admin, p, row } = await me(id)
  if (row!.status !== 'draft') throw new Error('This report is submitted. Reopen it to make changes.')
  if (dataUrl && (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 400_000)) throw new Error('Signature image is not valid')
  await admin.from(TABLE).update({ signature: dataUrl, signed_at: dataUrl ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', id).eq('company_id', p.company_id)
  touch(id)
}

export type EmailResult = { ok: boolean; sentTo?: string[]; error?: string }

/** Email the PDF to the addresses in the box (pre-filled with the office list), e.g. to send it again or to the insurance agent. */
export async function emailReport(id: string, _prev: EmailResult | null, formData: FormData): Promise<EmailResult> {
  try {
    const { admin, p, row } = await me(id)
    const r = row!
    const to = (str(formData.get('send_to')) ?? '').split(/[\s,;]+/).map(x => x.trim()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 10)
    if (!to.length) return { ok: false, error: 'Type at least one email address' }
    const sent = await sendReport(admin, r, to, p.email)
    if (!sent.ok) return { ok: false, error: sent.error }
    touch(id)
    return { ok: true, sentTo: to }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** A submitted report is a record: only the construction office roles can reopen one (a tech asks them to). */
export async function reopenReport(id: string): Promise<void> {
  const { admin, p } = await me(id)
  if (!canReadConstruction(p)) throw new Error('Ask the office to reopen a submitted report')
  await admin.from(TABLE).update({ status: 'draft', completed_at: null, updated_at: new Date().toISOString() }).eq('id', id).eq('company_id', p.company_id)
  touch(id)
}

/** Only a report that was never submitted can be thrown away. */
export async function deleteReport(id: string): Promise<void> {
  const { admin, p, row } = await me(id)
  if (row!.status !== 'draft') throw new Error('Reopen a submitted report before deleting it')
  const paths = (row!.photos ?? []).map(ph => ph.path)
  if (paths.length) await admin.storage.from(ACCIDENT_BUCKET).remove(paths)
  await admin.from(TABLE).delete().eq('id', id).eq('company_id', p.company_id)
  touch()
  redirect('/forms/accident')
}
