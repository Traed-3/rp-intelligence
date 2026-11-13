'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canEditFieldSurveys } from '@/lib/field-surveys'
import { canReadConstruction } from '@/lib/construction'
import { type Mark, type PretripKind, type PretripRow, pretripItems, missingForFinish, remarkItems, itemShort, kindLabel, fmtDate, pretripFileName } from '@/lib/pretrip'
import { loadPretrip, renderPretripPdf } from '@/lib/pretrip-pdf'
import { sendDocumentEmail } from '@/lib/email'

const TABLE = 'pretrip_inspections'
const str = (v: FormDataEntryValue | null) => { const s = (v as string | null)?.trim(); return s || null }
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const isKind = (v: unknown): v is PretripKind => v === 'vehicle' || v === 'trailer'
const isMark = (v: unknown): v is Mark => v === 'ok' || v === 'remark' || v === 'na'

/** Signed-in person with Forms access. Techs only touch inspections they started; the construction office roles see all. */
async function me(id?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const admin = createAdminClient()
  const { data: p } = await admin.from('profiles').select('id, company_id, role, full_name, email').eq('id', user.id).single()
  if (!p || !canEditFieldSurveys(p)) throw new Error('No access to Forms')
  let row: PretripRow | null = null
  if (id) {
    row = await loadPretrip(admin, id, p.company_id)
    if (!row) throw new Error('Inspection not found')
    if (!canReadConstruction(p) && row.created_by !== p.id) throw new Error('That inspection belongs to someone else')
  }
  return { admin, p, row }
}
const touch = (id?: string) => { revalidatePath('/forms/pre-trip'); if (id) revalidatePath(`/forms/pre-trip/${id}`) }

/** The asset whose unit number matches what was typed (so the inspection shows up against the truck or trailer). */
async function assetFor(admin: ReturnType<typeof createAdminClient>, companyId: string, unit: string | null): Promise<string | null> {
  if (!unit) return null
  const { data } = await admin.from('assets').select('id').eq('company_id', companyId).ilike('unit_number', unit.replace(/[%_\\]/g, '\\$&')).limit(1)
  return data?.[0]?.id ?? null
}

/** New inspection. The number carries over from this person's last one of the same kind (same truck most days). */
export async function createInspection(formData: FormData): Promise<void> {
  const { admin, p } = await me()
  const kind: PretripKind = isKind(formData.get('kind')) ? (formData.get('kind') as PretripKind) : 'vehicle'
  let unit = str(formData.get('unit_number'))
  let equipment: string | null = null
  if (!unit) {
    const { data: last } = await admin.from(TABLE).select('unit_number, equipment').eq('company_id', p.company_id).eq('created_by', p.id).eq('kind', kind).order('created_at', { ascending: false }).limit(1).maybeSingle()
    unit = last?.unit_number ?? null
    if (kind === 'trailer') equipment = last?.equipment ?? null
  }
  const { data, error } = await admin.from(TABLE).insert({
    company_id: p.company_id, kind, unit_number: unit, equipment, asset_id: await assetFor(admin, p.company_id, unit),
    inspection_date: today(), checked_by: p.full_name, created_by: p.id,
  }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Could not start the inspection')
  touch()
  redirect(`/forms/pre-trip/${data.id}`)
}

export type SubmitResult = { ok: boolean; saved?: boolean; missing?: string[]; error?: string }

/** Save the whole sheet. The Finish button posts the same form with intent=finish: it saves, then checks nothing is left blank. */
export async function submitInspection(id: string, _prev: SubmitResult | null, formData: FormData): Promise<SubmitResult> {
  try {
    const { admin, p, row } = await me(id)
    if (row!.status !== 'draft') return { ok: false, error: 'This inspection is finished. Reopen it to make changes.' }
    const results: Record<string, Mark> = {}
    for (const it of pretripItems(row!.kind)) { const v = formData.get(`r_${it.key}`); if (isMark(v)) results[it.key] = v }
    const unit = str(formData.get('unit_number'))
    const patch = {
      unit_number: unit, asset_id: await assetFor(admin, p.company_id, unit),
      equipment: row!.kind === 'trailer' ? str(formData.get('equipment')) : null,
      inspection_date: str(formData.get('inspection_date')) ?? row!.inspection_date,
      checked_by: str(formData.get('checked_by')), remarks: str(formData.get('remarks')), results,
      updated_at: new Date().toISOString(),
    }
    const { error } = await admin.from(TABLE).update(patch).eq('id', id).eq('company_id', p.company_id)
    if (error) return { ok: false, error: error.message }
    if (formData.get('intent') === 'finish') {
      const missing = missingForFinish({ ...row!, ...patch })
      if (missing.length) { touch(id); return { ok: false, saved: true, missing } }
      const { error: e2 } = await admin.from(TABLE).update({ status: 'complete', completed_at: new Date().toISOString() }).eq('id', id).eq('company_id', p.company_id)
      if (e2) return { ok: false, error: e2.message }
    }
    touch(id)
    return { ok: true, saved: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** The driver signs on the phone screen; the PNG (data URL) prints beside "Checked by". */
export async function saveSignature(id: string, dataUrl: string | null): Promise<void> {
  const { admin, p, row } = await me(id)
  if (row!.status !== 'draft') throw new Error('This inspection is finished. Reopen it to make changes.')
  if (dataUrl && (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 400_000)) throw new Error('Signature image is not valid')
  await admin.from(TABLE).update({ signature: dataUrl, signed_at: dataUrl ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', id).eq('company_id', p.company_id)
  touch(id)
}

export type EmailResult = { ok: boolean; sentTo?: string[]; error?: string }

/** Email the PDF to the addresses typed in the box. Nothing is sent unless someone types an address and presses the button. */
export async function emailInspection(id: string, _prev: EmailResult | null, formData: FormData): Promise<EmailResult> {
  try {
    const { admin, p, row } = await me(id)
    const r = row!
    const to = (str(formData.get('send_to')) ?? '').split(/[\s,;]+/).map(x => x.trim()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 10)
    if (!to.length) return { ok: false, error: 'Type at least one email address' }
    const pdf = await renderPretripPdf(r)
    const flagged = remarkItems(r)
    const subject = `Pre-Trip Inspection - ${kindLabel(r.kind)} ${r.unit_number ?? ''} - ${fmtDate(r.inspection_date)}${flagged.length ? ' - NEEDS ATTENTION' : ''}`.replace(/\s+/g, ' ')
    const body = [
      `Attached is the pre-trip inspection for ${kindLabel(r.kind).toLowerCase()} ${r.unit_number ?? ''}, checked ${fmtDate(r.inspection_date)} by ${r.checked_by ?? 'the driver'}.`,
      '',
      flagged.length ? `Needs attention: ${flagged.map(itemShort).join(', ')}.` : 'Every line is OK or N/A.',
      ...(r.remarks ? ['', `Remarks: ${r.remarks}`] : []),
    ].join('\n')
    const sent = await sendDocumentEmail({ to, subject, body, attachment: { filename: pretripFileName(r), content: pdf }, replyTo: p.email })
    if (!sent.ok) return { ok: false, error: sent.error }
    await admin.from(TABLE).update({ emailed_to: to.join(', '), emailed_at: new Date().toISOString() }).eq('id', id).eq('company_id', p.company_id)
    touch(id)
    return { ok: true, sentTo: to }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function reopenInspection(id: string): Promise<void> {
  const { admin, p } = await me(id)
  await admin.from(TABLE).update({ status: 'draft', completed_at: null, updated_at: new Date().toISOString() }).eq('id', id).eq('company_id', p.company_id)
  touch(id)
}

/** Only an unfinished inspection can be thrown away. */
export async function deleteInspection(id: string): Promise<void> {
  const { admin, p, row } = await me(id)
  if (row!.status !== 'draft') throw new Error('Reopen a finished inspection before deleting it')
  await admin.from(TABLE).delete().eq('id', id).eq('company_id', p.company_id)
  touch()
  redirect('/forms/pre-trip')
}
