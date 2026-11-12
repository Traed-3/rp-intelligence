import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireFieldSurveys } from '@/lib/construction-guard'
import { type TestRow, type ItemRow, testTitle, stateInfo, overallResult, missingForFinish, ITEM_KINDS, STATES, METHOD_BY, REASONS, CERT_TYPES, DEFAULT_SEND_TO } from '@/lib/containment-test'
import { ContainmentItemCard } from '@/components/construction/containment-item-card'
import { TestSignature, FinishBox } from '@/components/construction/containment-finish'
import { saveTestHeader, addTestItem, saveTestItem, deleteTestItem, saveSignature, finishTest, reopenTest, deleteTest } from '../actions'

export const dynamic = 'force-dynamic'
const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-card disabled:bg-gray-50'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'

function HF({ t, locked, name, label, ph, type, span }: { t: TestRow; locked: boolean; name: keyof TestRow; label: string; ph?: string; type?: string; span?: boolean }) {
  return <div className={span ? 'col-span-2 sm:col-span-3' : ''}><label className={lbl}>{label}</label><input name={name} type={type} defaultValue={(t[name] as string | null) ?? ''} placeholder={ph} disabled={locked} className={inp} /></div>
}

export default async function ContainmentTestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await requireFieldSurveys()
  const admin = createAdminClient()
  const { data: row } = await admin.from('con_containment_tests').select('*').eq('id', id).eq('company_id', profile.company_id).maybeSingle()
  if (!row) notFound()
  const t = row as TestRow
  if (profile.ownOnly && t.created_by !== profile.id) notFound()
  const [{ data: itemRows }, { data: jobs }] = await Promise.all([
    admin.from('con_containment_test_items').select('*').eq('test_id', id).order('sort_order'),
    admin.from('con_jobs').select('id, site_number, gas_brand').eq('company_id', profile.company_id).neq('stage', 'complete').order('site_number'),
  ])
  const items = (itemRows ?? []) as ItemRow[]
  const locked = t.status !== 'draft'
  const info = stateInfo(t.state)
  const result = overallResult(items)
  const missing = missingForFinish(t, items)
  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto overflow-x-hidden space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="rp-title">{testTitle(t)} <span className="text-base font-normal text-gray-500">· Containment test</span></h1>
          <p className="text-xs text-gray-500 mt-0.5">{t.test_date} · {t.tester_name ?? 'tech'} · <span className="uppercase font-semibold">{t.status}</span>{result !== 'incomplete' && <> · <span className={result === 'fail' ? 'text-red-600 font-bold' : 'text-emerald-700 font-bold'}>{result.toUpperCase()}</span></>}</p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800">{info.label} → {info.form}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <a href={`/api/construction/surveys/tests/${id}/pdf`} target="_blank" rel="noopener" className="px-3 py-1.5 rounded-lg border border-gray-300 bg-card hover:bg-gray-50">Preview PDF</a>
          {t.job_id && profile.fullAccess && <Link href={`/construction/jobs/${t.job_id}`} className="px-3 py-1.5 rounded-lg border border-gray-300 bg-card hover:bg-gray-50">Job</Link>}
          <Link href="/construction/surveys/tests" className="px-3 py-1.5 text-gray-500">All tests</Link>
        </div>
      </div>

      <details className="rp-card" open={!locked && (!t.facility_id || !t.tester_cert)}>
        <summary className="px-4 py-3 text-sm font-semibold text-gray-800 cursor-pointer">Facility, owner and tester</summary>
        <form action={saveTestHeader.bind(null, id)} className="p-4 pt-0 grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div><label className={lbl}>State form</label><select name="state" defaultValue={t.state} disabled={locked} className={inp}>{STATES.map(s => <option key={s.value} value={s.value}>{s.label} ({s.agency})</option>)}</select></div>
          <div className="sm:col-span-2"><label className={lbl}>Job</label><select name="job_id" defaultValue={t.job_id ?? ''} disabled={locked} className={inp}><option value="">— none —</option>{(jobs ?? []).map(j => <option key={j.id} value={j.id}>{j.site_number}{j.gas_brand ? ` · ${j.gas_brand}` : ''}</option>)}</select></div>
          <HF t={t} locked={locked} name="site_number" label="Site #" /><HF t={t} locked={locked} name="facility_name" label="Facility name" /><HF t={t} locked={locked} name="facility_id" label={`${info.agency} facility ID #`} />
          <HF t={t} locked={locked} name="address" label="Street address" span /><HF t={t} locked={locked} name="city" label="City" /><HF t={t} locked={locked} name="zip" label="Zip" />
          {t.state === 'VA' && <HF t={t} locked={locked} name="county" label="County" />}
          <HF t={t} locked={locked} name="test_date" label="Test date" type="date" />
          {t.state === 'MD' && <><HF t={t} locked={locked} name="weather" label="Weather" ph="Overcast" /><HF t={t} locked={locked} name="temperature" label="Temperature" ph="63 F" /></>}
          {t.state === 'WV' && <><HF t={t} locked={locked} name="facility_contact" label="Facility contact" /><HF t={t} locked={locked} name="contact_phone" label="Contact phone" /></>}
          {t.state !== 'WV' && <>
            <div className="col-span-2 sm:col-span-3 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t.state === 'MD' ? 'UST owner' : 'Owner / operator'}</div>
            <HF t={t} locked={locked} name="owner_name" label="Owner name" />
            {t.state === 'MD' && <><HF t={t} locked={locked} name="owner_address" label="Owner address" /><HF t={t} locked={locked} name="owner_city" label="Owner city" /><HF t={t} locked={locked} name="owner_state" label="Owner state" /><HF t={t} locked={locked} name="owner_zip" label="Owner zip" /><HF t={t} locked={locked} name="owner_phone" label="Owner phone" /></>}
          </>}
          <div className="col-span-2 sm:col-span-3 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Tester</div>
          <HF t={t} locked={locked} name="tester_name" label="Tester name" /><HF t={t} locked={locked} name="tester_phone" label="Phone" /><HF t={t} locked={locked} name="tester_email" label="Email" />
          {t.state === 'MD' && <div><label className={lbl}>Certification</label><select name="tester_cert_type" defaultValue={t.tester_cert_type ?? 'mde_tech'} disabled={locked} className={inp}>{CERT_TYPES.MD.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>}
          {t.state !== 'VA' && <HF t={t} locked={locked} name="tester_cert" label={t.state === 'MD' ? 'MDE cert # (MDIC-YYYY-####-T)' : 'WVDEP certification #'} />}
          {t.state === 'WV' && <>
            <div><label className={lbl}>Test method developed by</label><select name="method_by" defaultValue={t.method_by ?? 'industry'} disabled={locked} className={inp}>{METHOD_BY.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></div>
            <HF t={t} locked={locked} name="method_other" label="Other method (specify)" />
            <HF t={t} locked={locked} name="test_equipment" label="Test equipment used" ph="Ruler / sight gauge" /><HF t={t} locked={locked} name="equipment_precision" label="Equipment precision" ph='1/16"' />
            <div><label className={lbl}>Reason for test (sumps)</label><select name="reason" defaultValue={t.reason ?? 'routine'} disabled={locked} className={inp}>{REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
            <HF t={t} locked={locked} name="reason_other" label="Other reason" />
          </>}
          {t.state === 'VA' && <>
            <div><label className={lbl}>Sump test type</label><select name="sump_test_kind" defaultValue={t.sump_test_kind} disabled={locked} className={inp}><option value="full">Full-height hydrostatic / vacuum</option><option value="low_level">Low liquid level (DEQ procedure)</option></select></div>
            <HF t={t} locked={locked} name="gauge_range" label="Vacuum gauge range (DW buckets)" />
            <HF t={t} locked={locked} name="next_due" label="Next test due" type="date" />
          </>}
          <div className="col-span-2 sm:col-span-3"><label className={lbl}>Comments (prints in the form&apos;s comments box)</label><textarea name="comments" rows={2} defaultValue={t.comments ?? ''} disabled={locked} className={inp} /></div>
          {!locked && <div className="col-span-2 sm:col-span-3"><button className="rounded-lg bg-foreground text-background px-4 py-2 text-sm font-semibold">Save facility and tester</button></div>}
        </form>
      </details>

      {items.map(it => (
        <ContainmentItemCard key={it.id} item={it} state={t.state} lowLevel={t.sump_test_kind === 'low_level'} locked={locked}
          saveAction={saveTestItem.bind(null, id, it.id)} deleteAction={deleteTestItem.bind(null, id, it.id)} />
      ))}

      {!locked && (
        <form action={addTestItem.bind(null, id)} className="rounded-2xl border border-dashed border-gray-300 bg-card p-4 flex flex-wrap items-end gap-2">
          <div className="w-52"><label className={lbl}>Add another</label><select name="kind" defaultValue={items.at(-1)?.kind ?? 'udc'} className={inp}>{ITEM_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</select></div>
          <div className="w-36"><label className={lbl}>Number / product</label><input name="label" list="add-item-num" placeholder="3/4, PUL" className={inp} /><datalist id="add-item-num">{[...new Set(ITEM_KINDS.flatMap(k => k.numbers))].map(n => <option key={n} value={n} />)}</datalist></div>
          <button className="rounded-lg border border-gray-300 bg-card px-4 py-2 text-sm font-semibold hover:bg-gray-50">+ Add</button>
        </form>
      )}

      <TestSignature existing={t.signature} signedLabel={t.signed_at ? `${t.tester_name ?? 'Tester'} · ${new Date(t.signed_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}` : null} locked={locked} save={saveSignature.bind(null, id)} />

      <div className="rp-card p-4 space-y-3">
        {locked ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-700 flex-1">
              Test is {t.status}. {t.job_id ? 'The PDF is filed on the job under Closeout → Testing Form.' : 'No job linked, so the PDF is only here.'}
              {t.sent_to ? ` Emailed to ${t.sent_to}${t.sent_at ? ` on ${new Date(t.sent_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}` : ''}.` : ' Not emailed.'}
            </span>
            <a href={`/api/construction/surveys/tests/${id}/pdf?saved=1`} target="_blank" rel="noopener" className="px-3 py-2 rounded-lg bg-foreground text-background text-sm">Open PDF</a>
            <form action={reopenTest.bind(null, id)}><button className="px-3 py-2 rounded-lg border border-gray-300 text-sm">Reopen</button></form>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-700">Save every item and sign, then finish. It prints on the {info.agency} form, files the PDF on the job, and emails it.</p>
            {missing.length > 0 && <p className="text-xs text-amber-700">Still needed: {missing.join(' · ')}</p>}
            <FinishBox action={finishTest.bind(null, id)} defaultTo={DEFAULT_SEND_TO} agency={info.agency} />
            <form action={deleteTest.bind(null, id)}><button className="px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-red-600">Delete this test</button></form>
          </>
        )}
      </div>
    </div>
  )
}
