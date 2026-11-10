'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canEditFieldSurveys, surveyOwnOnly } from '@/lib/field-surveys'
import { type TestState, type ItemKind, detectState, isBucket, thresholdFor, computeChange, missingForFinish, nextDueFrom, testTitle, itemTitle, overallResult, stateInfo, ITEM_TEXT_FIELDS, HEADER_TEXT_FIELDS, ITEM_KINDS, DEFAULT_SEND_TO, type TestRow } from '@/lib/containment-test'
import { loadTestBundle, renderTestPdf, testPdfFileName } from '@/lib/containment-test-pdf'
import { sendDocumentEmail } from '@/lib/email'

const BUCKET = 'construction-docs'
const str = (v: FormDataEntryValue | null) => { const s = (v as string | null)?.trim(); return s || null }
const oneOf = <T extends string>(v: FormDataEntryValue | null, opts: readonly T[]): T | null => { const s = str(v); return s && (opts as readonly string[]).includes(s) ? (s as T) : null }
const bool = (v: FormDataEntryValue | null) => { const s = str(v); return s === 'yes' ? true : s === 'no' ? false : null }
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

/** Signed-in tester. Same access as Field Surveys; the locked-down field_surveyor role only touches tests it started. */
async function me(testId?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const admin = createAdminClient()
  const { data: p } = await admin.from('profiles').select('id, company_id, role, full_name, phone, email').eq('id', user.id).single()
  if (!p || !canEditFieldSurveys(p)) throw new Error('No field test access')
  if (testId) {
    const { data: own } = await admin.from('con_containment_tests').select('created_by, status').eq('id', testId).eq('company_id', p.company_id).maybeSingle()
    if (!own) throw new Error('Test not found')
    if (surveyOwnOnly(p.role) && own.created_by !== p.id) throw new Error('That test belongs to someone else')
  }
  return { admin, p }
}
const touch = (id?: string) => { revalidatePath('/construction/surveys/tests'); if (id) revalidatePath(`/construction/surveys/tests/${id}`) }
async function assertDraft(admin: ReturnType<typeof createAdminClient>, id: string) {
  const { data } = await admin.from('con_containment_tests').select('status').eq('id', id).single()
  if (data?.status !== 'draft') throw new Error('This test is finished. Reopen it to make changes.')
}

/** New test: pick the job (or type the site). The site's state picks the form; facility ID + owner carry over from the last test at that site. */
export async function createTest(formData: FormData): Promise<void> {
  const { admin, p } = await me()
  let jobId = str(formData.get('job_id'))
  let siteNumber = str(formData.get('site_number')), facilityName = str(formData.get('facility_name')), address = str(formData.get('address'))
  let city: string | null = null, zip: string | null = null, siteState: string | null = null, siteId: string | null = null
  if (jobId) {
    const { data: j } = await admin.from('con_jobs').select('site_id, site_number, gas_brand, facility_address, con_sites(id, address, city, state, zip, store_brand)').eq('id', jobId).eq('company_id', p.company_id).maybeSingle()
    if (j) {
      const site = j.con_sites as unknown as { id: string; address: string | null; city: string | null; state: string | null; zip: string | null; store_brand: string | null } | null
      siteId = site?.id ?? j.site_id ?? null
      siteNumber = siteNumber ?? j.site_number; facilityName = facilityName ?? site?.store_brand ?? j.gas_brand ?? null
      address = address ?? site?.address ?? j.facility_address ?? null
      city = site?.city ?? null; zip = site?.zip ?? null; siteState = site?.state ?? null
    } else jobId = null   // not this company's job
  } else if (siteNumber) {
    const { data: site } = await admin.from('con_sites').select('id, address, city, state, zip, store_brand').eq('company_id', p.company_id).ilike('site_number', siteNumber).maybeSingle()
    if (site) { siteId = site.id; address = address ?? site.address; city = site.city; zip = site.zip; siteState = site.state; facilityName = facilityName ?? site.store_brand }
  }
  const picked = oneOf(formData.get('state'), ['MD', 'VA', 'WV'] as const)
  const state: TestState | null = picked ?? detectState({ state: siteState, address: [address, city, siteState, zip].filter(Boolean).join(', '), zip })
  if (!state) throw new Error('Could not tell the state from the address. Pick Maryland, Virginia or West Virginia.')

  // Carry the facility ID, owner and contact from the last test at this site.
  let prior: Partial<TestRow> = {}
  if (siteNumber) {
    let q = admin.from('con_containment_tests').select('facility_id, county, owner_name, owner_address, owner_city, owner_state, owner_zip, owner_phone, facility_contact, contact_phone').eq('company_id', p.company_id).eq('site_number', siteNumber)
    if (surveyOwnOnly(p.role)) q = q.eq('created_by', p.id)   // the locked-down role only sees its own tests
    const { data } = await q.order('test_date', { ascending: false }).limit(1).maybeSingle()
    if (data) prior = data as Partial<TestRow>
  }
  const { data: lastMine } = await admin.from('con_containment_tests').select('tester_cert, tester_cert_type, test_equipment, equipment_precision').eq('company_id', p.company_id).eq('created_by', p.id).eq('state', state).order('created_at', { ascending: false }).limit(1).maybeSingle()

  const { data, error } = await admin.from('con_containment_tests').insert({
    company_id: p.company_id, job_id: jobId, site_id: siteId, state, site_number: siteNumber, facility_name: facilityName, address, city, zip,
    ...prior, test_date: str(formData.get('test_date')) ?? today(),
    tester_name: p.full_name, tester_phone: p.phone, tester_email: p.email,
    tester_cert: lastMine?.tester_cert ?? null, tester_cert_type: lastMine?.tester_cert_type ?? (state === 'MD' ? 'mde_tech' : null),
    test_equipment: lastMine?.test_equipment ?? null, equipment_precision: lastMine?.equipment_precision ?? null,
    method_by: 'industry', reason: 'routine', created_by: p.id,
  }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'could not start the test')
  const kind = oneOf(formData.get('kind'), ITEM_KINDS.map(k => k.value)) ?? 'udc'
  await insertItem(admin, p.company_id, data.id, state, kind, str(formData.get('label')), 1)
  touch(data.id)
  redirect(`/construction/surveys/tests/${data.id}`)
}

async function insertItem(admin: ReturnType<typeof createAdminClient>, companyId: string, testId: string, state: TestState, kind: ItemKind, label: string | null, sort: number) {
  const bucket = isBucket(kind)
  const { error } = await admin.from('con_containment_test_items').insert({
    company_id: companyId, test_id: testId, sort_order: sort, kind, label, method: 'hydrostatic',
    construction: 'sw', install_type: bucket ? 'direct' : null, material: bucket ? null : (kind === 'udc' ? 'plastic' : null),
    threshold: thresholdFor(state, kind, 'hydrostatic'), wait_minutes: bucket ? null : '15', sensor_restored: bucket ? null : 'yes', riser_cap: bucket ? 'na' : null, drain_valve: bucket ? 'no' : null,
  })
  if (error) throw new Error(error.message)
}

export async function saveTestHeader(id: string, formData: FormData): Promise<void> {
  const { admin, p } = await me(id)
  await assertDraft(admin, id)
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const f of HEADER_TEXT_FIELDS) if (formData.has(f)) patch[f] = str(formData.get(f))
  const st = oneOf(formData.get('state'), ['MD', 'VA', 'WV'] as const); if (st) patch.state = st
  const kind = oneOf(formData.get('sump_test_kind'), ['full', 'low_level'] as const); if (kind) patch.sump_test_kind = kind
  if (formData.has('job_id')) {
    const jobId = str(formData.get('job_id'))
    if (jobId) { const { data: j } = await admin.from('con_jobs').select('id').eq('id', jobId).eq('company_id', p.company_id).maybeSingle(); if (!j) throw new Error('Job not found') }
    patch.job_id = jobId
  }
  if (!patch.test_date) delete patch.test_date
  const { error } = await admin.from('con_containment_tests').update(patch).eq('id', id).eq('company_id', p.company_id)
  if (error) throw new Error(error.message)
  touch(id)
}

export async function addTestItem(testId: string, formData: FormData): Promise<void> {
  const { admin, p } = await me(testId)
  await assertDraft(admin, testId)
  const { data: t } = await admin.from('con_containment_tests').select('state').eq('id', testId).single()
  const { count } = await admin.from('con_containment_test_items').select('id', { count: 'exact', head: true }).eq('test_id', testId)
  const kind = oneOf(formData.get('kind'), ITEM_KINDS.map(k => k.value)) ?? 'udc'
  await insertItem(admin, p.company_id, testId, (t?.state ?? 'VA') as TestState, kind, str(formData.get('label')), (count ?? 0) + 1)
  touch(testId)
}

/** One bucket/sump card posts at once. Change in reading is worked out when both readings are numbers and the tech left it blank. */
export async function saveTestItem(testId: string, itemId: string, formData: FormData): Promise<void> {
  const { admin, p } = await me(testId)
  await assertDraft(admin, testId)
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const f of ITEM_TEXT_FIELDS) if (formData.has(f)) patch[f] = str(formData.get(f))
  const kind = oneOf(formData.get('kind'), ITEM_KINDS.map(k => k.value)); if (kind) patch.kind = kind
  patch.construction = oneOf(formData.get('construction'), ['sw', 'dw'] as const)
  patch.install_type = oneOf(formData.get('install_type'), ['direct', 'direct_liner', 'sump'] as const)
  patch.material = oneOf(formData.get('material'), ['frp', 'plastic'] as const)
  patch.method = oneOf(formData.get('method'), ['hydrostatic', 'vacuum', 'pressure', 'other'] as const)
  patch.visual = oneOf(formData.get('visual'), ['pass', 'fail'] as const)
  patch.result = oneOf(formData.get('result'), ['pass', 'fail'] as const)
  for (const f of ['riser_cap', 'drain_valve', 'sensor_restored', 'sensor_shutoff'] as const) patch[f] = oneOf(formData.get(f), ['yes', 'no', 'na'] as const)
  for (const f of ['debris_removed', 'installed_after_2008', 'sensor_low', 'sensor_alarmed'] as const) patch[f] = bool(formData.get(f))
  if (!patch.level_change) patch.level_change = computeChange(patch.start_reading as string | null, patch.end_reading as string | null)
  const { error } = await admin.from('con_containment_test_items').update(patch).eq('id', itemId).eq('test_id', testId).eq('company_id', p.company_id)
  if (error) throw new Error(error.message)
  await admin.from('con_containment_tests').update({ updated_at: new Date().toISOString() }).eq('id', testId)
  touch(testId)
}

export async function deleteTestItem(testId: string, itemId: string): Promise<void> {
  const { admin, p } = await me(testId)
  await assertDraft(admin, testId)
  await admin.from('con_containment_test_items').delete().eq('id', itemId).eq('test_id', testId).eq('company_id', p.company_id)
  touch(testId)
}

/** The tester signs on the phone screen; the PNG (data URL) prints on the form's signature line. */
export async function saveSignature(testId: string, dataUrl: string | null): Promise<void> {
  const { admin, p } = await me(testId)
  await assertDraft(admin, testId)
  if (dataUrl && (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 400_000)) throw new Error('Signature image is not valid')
  await admin.from('con_containment_tests').update({ signature: dataUrl, signed_at: dataUrl ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', testId).eq('company_id', p.company_id)
  touch(testId)
}

export type FinishResult = { ok: boolean; missing?: string[]; emailed?: string[]; emailError?: string; error?: string }

/**
 * Finish: check the state form's required boxes, render the PDF on the state's form, file it on the job (Closeout →
 * Testing Form), mark the test complete, and email the PDF to the addresses on the finish box.
 */
export async function finishTest(id: string, _prev: FinishResult | null, formData: FormData): Promise<FinishResult> {
  try {
    const { admin, p } = await me(id)
    const bundle = await loadTestBundle(admin, id, p.company_id)
    if (!bundle) return { ok: false, error: 'Test not found' }
    const missing = missingForFinish(bundle.test, bundle.items)
    if (missing.length) return { ok: false, missing }
    if (!bundle.test.next_due) {
      bundle.test.next_due = nextDueFrom(bundle.test.test_date, bundle.test.state, bundle.items.some(i => isBucket(i.kind)))
      await admin.from('con_containment_tests').update({ next_due: bundle.test.next_due }).eq('id', id)
    }
    const pdf = await renderTestPdf(bundle)
    const fileName = testPdfFileName(bundle.test)
    const path = `${p.company_id}/containment-tests/${id}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: true })
    if (upErr) return { ok: false, error: upErr.message }
    // A re-finish (after Reopen) replaces the earlier PDF on the job instead of stacking copies.
    if (bundle.test.pdf_document_id) await admin.from('con_documents').delete().eq('id', bundle.test.pdf_document_id).eq('company_id', p.company_id)
    if (bundle.test.pdf_path) await admin.storage.from(BUCKET).remove([bundle.test.pdf_path])
    let docId: string | null = null
    const { data: ownJob } = bundle.test.job_id ? await admin.from('con_jobs').select('id').eq('id', bundle.test.job_id).eq('company_id', p.company_id).maybeSingle() : { data: null }
    if (ownJob) {
      const { data: doc } = await admin.from('con_documents').insert({
        company_id: p.company_id, job_id: bundle.test.job_id, file_name: fileName, original_filename: fileName, storage_path: path,
        category: 'closeout', doc_type: 'testing_form', review_status: 'filed', uploaded_by: p.id, imported_by: 'containment_test', imported_at: new Date().toISOString(),
      }).select('id').single()
      docId = doc?.id ?? null
    }
    await admin.from('con_containment_tests').update({ status: 'complete', pdf_document_id: docId, pdf_path: path, updated_at: new Date().toISOString() }).eq('id', id)

    const to = (str(formData.get('send_to')) ?? DEFAULT_SEND_TO).split(/[\s,;]+/).map(x => x.trim()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 10)
    let emailed: string[] = [], emailError: string | undefined
    if (to.length) {
      const t = bundle.test, info = stateInfo(t.state), result = overallResult(bundle.items)
      const subject = `${t.site_number ?? testTitle(t)} ${info.agency} Containment Test - ${bundle.items.map(itemTitle).join(', ').slice(0, 120)} - ${t.test_date}`
      const body = [
        `Attached is the ${info.agency} test report for ${testTitle(t)}${t.address ? `, ${t.address}` : ''}.`,
        '',
        ...bundle.items.map(i => `${itemTitle(i)}: ${i.result === 'pass' ? 'PASS' : i.result === 'fail' ? 'FAIL' : '—'}${i.level_change ? ` (change ${i.level_change})` : ''}`),
        '',
        `Tested ${t.test_date} by ${t.tester_name ?? 'tech'}.${result === 'fail' ? (t.state === 'MD' ? ' A failure must be reported to MDE within 2 hours.' : ' A failed sump or bucket must be repaired or replaced and retested.') : ''}`,
      ].join('\n')
      const sent = await sendDocumentEmail({ to, subject, body, attachment: { filename: fileName, content: pdf }, replyTo: t.tester_email })
      if (sent.ok) { emailed = to; await admin.from('con_containment_tests').update({ status: 'sent', sent_to: to.join(', '), sent_at: new Date().toISOString() }).eq('id', id) }
      else emailError = sent.error
    }
    touch(id)
    if (bundle.test.job_id) revalidatePath(`/construction/jobs/${bundle.test.job_id}`)
    return { ok: true, emailed, emailError }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function reopenTest(id: string): Promise<void> {
  const { admin, p } = await me(id)
  await admin.from('con_containment_tests').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', id).eq('company_id', p.company_id)
  touch(id)
}

export async function deleteTest(id: string): Promise<void> {
  const { admin, p } = await me(id)
  const { data } = await admin.from('con_containment_tests').select('status, pdf_path, pdf_document_id').eq('id', id).single()
  if (data?.status !== 'draft') throw new Error('Reopen a finished test before deleting it')
  await admin.from('con_containment_tests').delete().eq('id', id).eq('company_id', p.company_id)
  touch()
  redirect('/construction/surveys/tests')
}

