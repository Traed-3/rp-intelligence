import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireFieldSurveys } from '@/lib/construction-guard'
import { surveyTitle, surveyTypeLabel, SUMP_TYPES, type SurveyRow, type SumpRow, type PhotoRow } from '@/lib/survey'
import { SurveySumpCard } from '@/components/construction/survey-sump-card'
import { saveSurveyHeader, addSump, saveSump, deleteSump, addSurveyPhotos, deletePhoto, completeSurvey, reopenSurvey, deleteSurvey } from '../actions'

export const dynamic = 'force-dynamic'
const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-card disabled:bg-gray-50'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'

export default async function SurveyEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await requireFieldSurveys()
  const admin = createAdminClient()
  const { data: survey } = await admin.from('con_surveys').select('*').eq('id', id).eq('company_id', profile.company_id).maybeSingle()
  if (!survey) notFound()
  if (profile.ownOnly && (survey as { created_by?: string | null }).created_by !== profile.id) notFound()   // the locked-down role only opens its own surveys
  const sv = survey as SurveyRow
  const [{ data: sumps }, { data: photos }, { data: jobs }] = await Promise.all([
    admin.from('con_survey_sumps').select('*').eq('survey_id', id).order('sort_order'),
    admin.from('con_survey_photos').select('*').eq('survey_id', id).order('sort_order'),
    admin.from('con_jobs').select('id, site_number, gas_brand, work_order_number').eq('company_id', profile.company_id).neq('stage', 'complete').order('site_number'),
  ])
  const locked = sv.status !== 'draft'
  const photoList = (photos ?? []) as PhotoRow[]

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto overflow-x-hidden space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="rp-title">{surveyTitle(sv)} <span className="text-base font-normal text-gray-500">· {surveyTypeLabel(sv.survey_type)}</span></h1>
          <p className="text-xs text-gray-500 mt-0.5">{sv.survey_date} · {sv.tech_name ?? 'tech'} · <span className="uppercase font-semibold">{sv.status}</span></p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <a href={`/api/construction/surveys/${id}/pdf`} target="_blank" rel="noopener" className="px-3 py-1.5 rounded-lg border border-gray-300 bg-card hover:bg-gray-50">Preview PDF</a>
          {sv.job_id && profile.fullAccess && <Link href={`/construction/jobs/${sv.job_id}`} className="px-3 py-1.5 rounded-lg border border-gray-300 bg-card hover:bg-gray-50">Job</Link>}
          <Link href="/construction/surveys" className="px-3 py-1.5 text-gray-500">All surveys</Link>
        </div>
      </div>

      <details className="rp-card" open={!sv.site_number}>
        <summary className="px-4 py-3 text-sm font-semibold text-gray-800 cursor-pointer">Site and tech</summary>
        <form action={saveSurveyHeader.bind(null, id)} className="p-4 pt-0 grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div className="col-span-2 sm:col-span-3"><label className={lbl}>Job</label><select name="job_id" defaultValue={sv.job_id ?? ''} disabled={locked} className={inp}><option value="">— none —</option>{(jobs ?? []).map(j => <option key={j.id} value={j.id}>{j.site_number}{j.gas_brand ? ` · ${j.gas_brand}` : ''}{profile.fullAccess && j.work_order_number ? ` · ${j.work_order_number}` : ''}</option>)}</select></div>
          <div><label className={lbl}>Site #</label><input name="site_number" defaultValue={sv.site_number ?? ''} disabled={locked} className={inp} /></div>
          <div><label className={lbl}>Brand / name</label><input name="site_name" defaultValue={sv.site_name ?? ''} disabled={locked} className={inp} /></div>
          <div><label className={lbl}>Date</label><input name="survey_date" type="date" defaultValue={sv.survey_date} disabled={locked} className={inp} /></div>
          <div className="col-span-2 sm:col-span-3"><label className={lbl}>Address</label><input name="address" defaultValue={sv.address ?? ''} disabled={locked} className={inp} /></div>
          <div><label className={lbl}>Tech</label><input name="tech_name" defaultValue={sv.tech_name ?? ''} disabled={locked} className={inp} /></div>
          <div><label className={lbl}>Phone</label><input name="tech_phone" defaultValue={sv.tech_phone ?? ''} disabled={locked} className={inp} /></div>
          <div><label className={lbl}>Email</label><input name="tech_email" defaultValue={sv.tech_email ?? ''} disabled={locked} className={inp} /></div>
          <div className="col-span-2 sm:col-span-3"><label className={lbl}>Site notes</label><textarea name="notes" rows={2} defaultValue={sv.notes ?? ''} disabled={locked} className={inp} /></div>
          {!locked && <div className="col-span-2 sm:col-span-3"><button className="rounded-lg bg-foreground text-background px-4 py-2 text-sm font-semibold">Save site and tech</button></div>}
        </form>
      </details>

      {((sumps ?? []) as SumpRow[]).map(sm => (
        <SurveySumpCard key={sm.id} sump={sm} photos={photoList.filter(p => p.sump_id === sm.id)} locked={locked}
          saveAction={saveSump.bind(null, id, sm.id)} deleteAction={deleteSump.bind(null, id, sm.id)}
          photosAction={addSurveyPhotos.bind(null, id, sm.id)} deletePhotoAction={deletePhoto.bind(null, id)} />
      ))}

      {!locked && (
        <form action={addSump.bind(null, id)} className="rounded-2xl border border-dashed border-gray-300 bg-card p-4 flex flex-wrap items-end gap-2">
          <div className="w-48"><label className={lbl}>Add another sump</label><select name="sump_type" defaultValue="udc" className={inp}>{SUMP_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
          <div className="w-40"><label className={lbl}>Number / product</label><input name="sump_number" list="add-sump-num" placeholder="3/4, PUL, Probe sump" className={inp} /><datalist id="add-sump-num">{SUMP_TYPES.flatMap(t => t.numbers).map(n => <option key={n} value={n} />)}</datalist></div>
          <button className="rounded-lg border border-gray-300 bg-card px-4 py-2 text-sm font-semibold hover:bg-gray-50">+ Sump</button>
        </form>
      )}

      <div className="rp-card p-4 flex flex-wrap items-center gap-2">
        {locked ? (
          <>
            <span className="text-sm text-gray-700 flex-1">Survey is {sv.status}. The PDF is on the job's Documents and the email to ICON is on the plate.</span>
            <a href={`/api/construction/surveys/${id}/pdf`} target="_blank" rel="noopener" className="px-3 py-2 rounded-lg bg-foreground text-background text-sm">Open PDF</a>
            {profile.fullAccess && <Link href="/my" className="px-3 py-2 rounded-lg border border-gray-300 text-sm">My Plate</Link>}
            <form action={reopenSurvey.bind(null, id)}><button className="px-3 py-2 rounded-lg border border-gray-300 text-sm">Reopen</button></form>
          </>
        ) : (
          <>
            <span className="text-sm text-gray-700 flex-1">Save every sump, then finish: builds the ICON PDF with the photos, files it on the job, and puts the email to ICON on the plate.</span>
            <form action={completeSurvey.bind(null, id)}><button className="px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-600/90">Finish survey → PDF</button></form>
            <form action={deleteSurvey.bind(null, id)}><button className="px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-red-600">Delete</button></form>
          </>
        )}
      </div>
    </div>
  )
}
