'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canEditFieldSurveys, isSurveyOnly } from '@/lib/field-surveys'
import { roleMayVisit } from '@/lib/role-access'
import { canReadConstruction } from '@/lib/construction'
import { type SiteSurveyRow, type SurveyPhoto, type SitePlan, type PlanElement, blankData, cleanData, cleanPlan, planFromSurvey, newId, surveyTitle, surveyCounts, fmtDate, surveyFileName, sectionByKey, SITE_SURVEY_PATH, siteHits, type SiteHit } from '@/lib/site-survey'
import { SITE_SURVEY_BUCKET, loadSiteSurvey, renderSiteSurveyPdf } from '@/lib/site-survey-pdf'
import { AERIAL_SPANS, geocode, parseLatLng, fetchAerial, boardToLatLng, scanAerial } from '@/lib/site-survey-aerial'
import { sendDocumentEmail } from '@/lib/email'

const TABLE = 'site_surveys'
const MAX_PHOTOS = 250
const str = (v: FormDataEntryValue | null) => { const s = (v as string | null)?.trim(); return s || null }
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const now = () => new Date().toISOString()
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Signed-in person with Forms access. Techs only touch surveys they started; the construction office roles see all. */
async function me(id?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const admin = createAdminClient()
  const { data: p } = await admin.from('profiles').select('id, company_id, role, full_name, email').eq('id', user.id).single()
  // Checked here as well as in proxy.ts: an action must not depend on which page it was posted from.
  if (!p || !canEditFieldSurveys(p) || isSurveyOnly(p.role) || !roleMayVisit(p.role, SITE_SURVEY_PATH)) throw new Error('No access to Forms')
  let row: SiteSurveyRow | null = null
  if (id) {
    row = await loadSiteSurvey(admin, id, p.company_id)
    if (!row) throw new Error('Survey not found')
    if (!canReadConstruction(p) && row.created_by !== p.id) throw new Error('That survey belongs to someone else')
  }
  return { admin, p, row }
}
const touch = (id?: string) => { revalidatePath('/forms/site-survey'); if (id) revalidatePath(`/forms/site-survey/${id}`) }
const draftOnly = (row: SiteSurveyRow) => { if (row.status !== 'draft') throw new Error('This survey is finished. Reopen it to make changes.') }

const SITE_COLS = 'site_number, store_brand, address, city, state, zip, customer_id'

/**
 * Find sites in Construction's site list by store number, street, city or brand. The form calls it as the tech types:
 * the list under the box is this, and a number that matches a site exactly fills in the brand and address.
 */
export async function findSites(q: string): Promise<SiteHit[]> {
  try {
    const { admin, p } = await me()
    // Letters, digits, spaces, dash, dot, #, & only: the text goes into a filter string.
    const text = String(q ?? '').replace(/[^A-Za-z0-9 .#&'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (text.length < 2) return []
    const like = `%${text.replace(/[%_]/g, '')}%`
    const base = () => admin.from('con_sites').select(SITE_COLS).eq('company_id', p.company_id)
    const [byNumber, byPlace] = await Promise.all([
      base().ilike('site_number', like).limit(30),
      /^[\d-]+$/.test(text) && text.length < 4 ? Promise.resolve({ data: [] }) : base().or(`address.ilike.${JSON.stringify(like)},city.ilike.${JSON.stringify(like)},store_brand.ilike.${JSON.stringify(like)}`).limit(30),
    ])
    return siteHits([...(byNumber.data ?? []), ...(byPlace.data ?? [])], text).slice(0, 10)
  } catch { return [] }
}

/** New survey. A site number that is in Construction fills in the brand and address. */
export async function createSurvey(formData: FormData): Promise<void> {
  const { admin, p } = await me()
  const site = str(formData.get('site_number'))
  let siteName: string | null = null, address: string | null = null
  if (site) {
    const { data } = await admin.from('con_sites').select(SITE_COLS).eq('company_id', p.company_id).ilike('site_number', site.replace(/[%_\\]/g, '\\$&')).limit(5)
    const hit = siteHits(data ?? [], site)[0]
    if (hit) { siteName = hit.site_name; address = hit.address }
  }
  const { data, error } = await admin.from(TABLE).insert({
    company_id: p.company_id, site_number: site, site_name: siteName, address, survey_date: today(), tech_name: p.full_name,
    survey_company: 'Rappahannock Petroleum LLC', data: blankData(), created_by: p.id,
  }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Could not start the survey')
  touch()
  redirect(`/forms/site-survey/${data.id}`)
}

export type SaveResult = { ok: boolean; error?: string; savedAt?: string }

/** Save the whole survey: the header boxes and every section. The form calls this on its own a few seconds after typing stops. */
export async function saveSurvey(id: string, header: Record<string, string>, data: unknown): Promise<SaveResult> {
  try {
    const { admin, p, row } = await me(id)
    draftOnly(row!)
    const h = (k: string, n = 300) => (typeof header?.[k] === 'string' && header[k].trim() ? header[k].trim().slice(0, n) : null)
    const date = h('survey_date')
    const { error } = await admin.from(TABLE).update({
      site_number: h('site_number', 40), site_name: h('site_name', 120), address: h('address'), tech_name: h('tech_name', 120), survey_company: h('survey_company', 120),
      survey_date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : row!.survey_date, data: cleanData(data), updated_at: now(),
    }).eq('id', id).eq('company_id', p.company_id)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/forms/site-survey')
    return { ok: true, savedAt: now() }
  } catch (e) { return { ok: false, error: msg(e) } }
}

export type PhotoResult = { error?: string; photos?: SurveyPhoto[] }

/** Photos from the camera or the roll, filed under the section (or the one tank / sump / dispenser) they were taken for. */
export async function addPhotos(id: string, formData: FormData): Promise<PhotoResult> {
  try {
    const { admin, p, row } = await me(id)
    draftOnly(row!)
    const ref = str(formData.get('ref')) ?? 'general'
    if (ref !== 'plan' && !sectionByKey(ref.split(':')[0])) return { error: 'Unknown section' }
    const caption = str(formData.get('caption'))?.slice(0, 160) ?? null
    const files = formData.getAll('photos').filter((f): f is File => typeof f === 'object' && !!f && (f as File).size > 0)
    const photos: SurveyPhoto[] = [...(row!.photos ?? [])]
    if (photos.length + files.length > MAX_PHOTOS) return { error: `A survey holds up to ${MAX_PHOTOS} photos` }
    const sharp = (await import('sharp')).default
    for (const f of files) {
      if (f.size > 15_000_000) return { error: `${f.name} is too large` }
      let buf: Buffer
      try { buf = await sharp(Buffer.from(await f.arrayBuffer())).rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer() }
      catch { return { error: `${f.name} is not a photo this form can read` } }
      const path = `${p.company_id}/site-surveys/${id}/${Date.now()}-${newId()}.jpg`
      const { error } = await admin.storage.from(SITE_SURVEY_BUCKET).upload(path, buf, { contentType: 'image/jpeg' })
      if (error) return { error: `Upload failed: ${error.message}` }
      photos.push({ id: newId(), path, ref, caption, name: f.name.slice(0, 80) })
    }
    const { error } = await admin.from(TABLE).update({ photos, updated_at: now() }).eq('id', id).eq('company_id', p.company_id)
    if (error) return { error: error.message }
    touch(id)
    return { photos }
  } catch (e) { return { error: msg(e) } }
}

export async function updatePhoto(id: string, photoId: string, caption: string): Promise<PhotoResult> {
  try {
    const { admin, p, row } = await me(id)
    draftOnly(row!)
    const photos = (row!.photos ?? []).map(ph => (ph.id === photoId ? { ...ph, caption: caption.trim().slice(0, 160) || null } : ph))
    await admin.from(TABLE).update({ photos, updated_at: now() }).eq('id', id).eq('company_id', p.company_id)
    return { photos }
  } catch (e) { return { error: msg(e) } }
}

export async function removePhoto(id: string, photoId: string): Promise<PhotoResult> {
  try {
    const { admin, p, row } = await me(id)
    draftOnly(row!)
    const gone = (row!.photos ?? []).find(ph => ph.id === photoId)
    if (!gone) return { photos: row!.photos ?? [] }
    const photos = (row!.photos ?? []).filter(ph => ph.id !== photoId)
    await admin.storage.from(SITE_SURVEY_BUCKET).remove([gone.path])
    await admin.from(TABLE).update({ photos, updated_at: now() }).eq('id', id).eq('company_id', p.company_id)
    touch(id)
    return { photos }
  } catch (e) { return { error: msg(e) } }
}

// ── Site plan ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type PlanResult = { ok: boolean; error?: string; plan?: SitePlan; message?: string }

async function writePlan(admin: ReturnType<typeof createAdminClient>, companyId: string, id: string, plan: SitePlan) {
  const { error } = await admin.from(TABLE).update({ plan, updated_at: now() }).eq('id', id).eq('company_id', companyId)
  if (error) throw new Error(error.message)
}

/** Save what is drawn. The aerial picture behind it is kept as the server last set it. */
export async function savePlan(id: string, raw: unknown): Promise<PlanResult> {
  try {
    const { admin, p, row } = await me(id)
    draftOnly(row!)
    const plan = cleanPlan(raw, row!.plan)
    await writePlan(admin, p.company_id, id, plan)
    return { ok: true, plan }
  } catch (e) { return { ok: false, error: msg(e) } }
}

/**
 * Put the picture from above behind the drawing. First call finds the site from the address (or from coordinates pasted
 * in). Later calls re-aim it: `center` is a spot tapped on the current picture, `span` is how much ground to show.
 * Shapes already drawn stay on the same ground when the picture moves.
 */
export async function loadAerial(id: string, opts: { where?: string; center?: [number, number]; span?: number }): Promise<PlanResult> {
  try {
    const { admin, p, row } = await me(id)
    draftOnly(row!)
    const old = row!.plan?.aerial ?? null
    const span = AERIAL_SPANS.includes(opts.span ?? 0) ? opts.span! : old?.span_m ?? 180
    let at = old ? { lat: old.lat, lng: old.lng } : null
    if (opts.where?.trim()) {
      at = parseLatLng(opts.where) ?? await geocode(opts.where)
      if (!at) return { ok: false, error: 'Could not find that address. Check it, or paste the coordinates from a maps app (38.9072, -77.0369).' }
    } else if (old && opts.center) {
      at = boardToLatLng(at!, old.span_m, opts.center[0], opts.center[1])
    } else if (!at) {
      const addr = row!.address
      if (!addr) return { ok: false, error: 'Type the site address first.' }
      at = await geocode(addr)
      if (!at) return { ok: false, error: 'Could not find the site address. Paste the coordinates from a maps app instead (38.9072, -77.0369).' }
    }
    const jpeg = await fetchAerial(at, span)
    const path = `${p.company_id}/site-surveys/${id}/aerial-${Date.now()}.jpg`
    const { error } = await admin.storage.from(SITE_SURVEY_BUCKET).upload(path, jpeg, { contentType: 'image/jpeg' })
    if (error) return { ok: false, error: `Could not store the picture: ${error.message}` }
    if (old?.path) await admin.storage.from(SITE_SURVEY_BUCKET).remove([old.path])

    // Keep every shape over the same piece of ground: shift by how far the picture moved, scale by the zoom change.
    let elements: PlanElement[] = row!.plan?.elements ?? []
    if (old && elements.length) {
      const k = old.span_m / span
      const mPerDegLat = 111_320, mPerDegLng = 111_320 * Math.cos((at.lat * Math.PI) / 180)
      const dx = ((old.lng - at.lng) * mPerDegLng / span) * 1000, dy = (-(old.lat - at.lat) * mPerDegLat / span) * 1000
      const mv = (x: number, y: number): [number, number] => [(x - 500) * k + 500 + dx, (y - 500) * k + 500 + dy]
      elements = elements.map(e => {
        if (e.kind === 'line') return { ...e, pts: e.pts.map(pt => mv(pt[0], pt[1])) }
        const [x, y] = mv(e.x, e.y)
        return { ...e, x, y, w: e.w * k, h: e.h * k }
      })
    }
    const plan: SitePlan = { ...cleanPlan({ elements, note: row!.plan?.note }, row!.plan), aerial: { path, lat: at.lat, lng: at.lng, span_m: span, source: 'Esri World Imagery', fetched_at: now() } }
    await writePlan(admin, p.company_id, id, plan)
    return { ok: true, plan }
  } catch (e) { return { ok: false, error: msg(e) } }
}

export async function removeAerial(id: string): Promise<PlanResult> {
  try {
    const { admin, p, row } = await me(id)
    draftOnly(row!)
    const old = row!.plan?.aerial
    if (old?.path) await admin.storage.from(SITE_SURVEY_BUCKET).remove([old.path])
    const plan: SitePlan = { ...cleanPlan(row!.plan ?? {}, row!.plan), aerial: null }
    await writePlan(admin, p.company_id, id, plan)
    return { ok: true, plan }
  } catch (e) { return { ok: false, error: msg(e) } }
}

/** Read the aerial picture and draw the site from it: store, canopy, dispensers, tank pad, with the survey's tanks and dispenser numbers. */
export async function scanPlan(id: string): Promise<PlanResult> {
  try {
    const { admin, p, row } = await me(id)
    draftOnly(row!)
    const a = row!.plan?.aerial
    if (!a) return { ok: false, error: 'Get the picture from above first.' }
    const { data: file } = await admin.storage.from(SITE_SURVEY_BUCKET).download(a.path)
    if (!file) return { ok: false, error: 'The aerial picture is missing. Get it again.' }
    const scan = await scanAerial(Buffer.from(await file.arrayBuffer()), a.span_m, row!.data)
    // Lines and notes the tech drew by hand stay; the shapes are redrawn from the picture.
    const kept = (row!.plan?.elements ?? []).filter(e => e.kind === 'line' || e.type === 'label')
    const plan: SitePlan = { ...cleanPlan({ elements: [...scan.elements, ...kept], note: scan.note }, row!.plan), scanned_at: now() }
    await writePlan(admin, p.company_id, id, plan)
    return { ok: true, plan, message: `Found: ${scan.summary}.${scan.note ? ` ${scan.note}` : ''} Drag anything that is off.` }
  } catch (e) { return { ok: false, error: msg(e) } }
}

/** No picture: lay the plan out from the survey's own tank and dispenser list. */
export async function drawFromSurvey(id: string): Promise<PlanResult> {
  try {
    const { admin, p, row } = await me(id)
    draftOnly(row!)
    const kept = (row!.plan?.elements ?? []).filter(e => e.kind === 'line' || e.type === 'label')
    const plan = cleanPlan({ elements: [...planFromSurvey(row!.data), ...kept], note: row!.plan?.note }, row!.plan)
    await writePlan(admin, p.company_id, id, plan)
    return { ok: true, plan, message: 'Drawn from the tanks and dispensers on the survey. Drag everything to where it really is.' }
  } catch (e) { return { ok: false, error: msg(e) } }
}

// ── Finish, email, reopen, delete ────────────────────────────────────────────────────────────────────────────────────

export type FinishResult = { ok: boolean; error?: string; missing?: string[] }

export async function finishSurvey(id: string): Promise<FinishResult> {
  try {
    const { admin, p, row } = await me(id)
    const r = row!
    const missing: string[] = []
    if (!r.site_number) missing.push('Site number')
    if (!r.address) missing.push('Site address')
    if (!r.tech_name) missing.push('Surveyed by')
    if (!surveyCounts(r.data) && !(r.photos ?? []).length) missing.push('At least one tank, sump, bucket or dispenser, or a photo')
    if (missing.length) return { ok: false, missing }
    const { error } = await admin.from(TABLE).update({ status: 'complete', completed_at: now(), updated_at: now() }).eq('id', id).eq('company_id', p.company_id)
    if (error) return { ok: false, error: error.message }
    touch(id)
    return { ok: true }
  } catch (e) { return { ok: false, error: msg(e) } }
}

export async function reopenSurvey(id: string): Promise<void> {
  const { admin, p } = await me(id)
  await admin.from(TABLE).update({ status: 'draft', completed_at: null, updated_at: now() }).eq('id', id).eq('company_id', p.company_id)
  touch(id)
}

export type EmailResult = { ok: boolean; sentTo?: string[]; error?: string }

/** Email the PDF to the addresses typed in the box. Nothing is sent unless someone types an address and presses the button. */
export async function emailSurvey(id: string, _prev: EmailResult | null, formData: FormData): Promise<EmailResult> {
  try {
    const { admin, p, row } = await me(id)
    const r = row!
    const to = (str(formData.get('send_to')) ?? '').split(/[\s,;]+/).map(x => x.trim()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 10)
    if (!to.length) return { ok: false, error: 'Type at least one email address' }
    const pdf = await renderSiteSurveyPdf(admin, r)
    const counts = surveyCounts(r.data)
    const body = [`Attached is the site survey for ${surveyTitle(r)}, done ${fmtDate(r.survey_date)} by ${r.tech_name ?? 'the crew'}.`, ...(r.address ? ['', r.address] : []), ...(counts ? ['', `On the survey: ${counts}.`] : [])].join('\n')
    const sent = await sendDocumentEmail({ to, subject: `${r.site_number ?? ''} Site Survey - ${fmtDate(r.survey_date)}`.trim(), body, attachment: { filename: surveyFileName(r), content: pdf }, replyTo: p.email })
    if (!sent.ok) return { ok: false, error: sent.error }
    await admin.from(TABLE).update({ emailed_to: to.join(', '), emailed_at: now() }).eq('id', id).eq('company_id', p.company_id)
    touch(id)
    return { ok: true, sentTo: to }
  } catch (e) { return { ok: false, error: msg(e) } }
}

/** Only an unfinished survey can be thrown away; its photos and aerial picture go with it. */
export async function deleteSurvey(id: string): Promise<void> {
  const { admin, p, row } = await me(id)
  draftOnly(row!)
  const paths = [...(row!.photos ?? []).map(ph => ph.path), ...(row!.plan?.aerial?.path ? [row!.plan.aerial.path] : [])]
  if (paths.length) await admin.storage.from(SITE_SURVEY_BUCKET).remove(paths)
  await admin.from(TABLE).delete().eq('id', id).eq('company_id', p.company_id)
  touch()
  redirect('/forms/site-survey')
}
