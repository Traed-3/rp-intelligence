import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireFieldSurveys } from '@/lib/construction-guard'
import { surveyTitle, surveyCounts, fmtDate } from '@/lib/site-survey'
import { loadSiteSurvey } from '@/lib/site-survey-pdf'
import { SiteSurveyForm, SiteSurveyEmail } from '@/components/forms/site-survey-form'
import { SitePlanEditor } from '@/components/forms/site-plan-editor'
import { saveSurvey, addPhotos, updatePhoto, removePhoto, finishSurvey, savePlan, loadAerial, removeAerial, scanPlan, drawFromSurvey, emailSurvey, reopenSurvey, deleteSurvey } from '../actions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const btn = 'px-3 py-1.5 rounded-lg border border-gray-300 bg-card hover:bg-gray-50'

export default async function SiteSurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await requireFieldSurveys()
  const admin = createAdminClient()
  const row = await loadSiteSurvey(admin, id, profile.company_id)
  if (!row) notFound()
  if (!profile.fullAccess && row.created_by !== profile.id) notFound()
  const locked = row.status !== 'draft'
  const pdf = `/forms/site-survey/${id}/pdf`
  const counts = surveyCounts(row.data)

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto overflow-x-hidden space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="rp-title">{surveyTitle(row)} <span className="text-base font-normal text-gray-500">· Site survey</span></h1>
          <p className="text-xs text-gray-500 mt-0.5">{fmtDate(row.survey_date)} · {row.tech_name ?? 'tech'} · <span className="uppercase font-semibold">{locked ? 'finished' : 'draft'}</span>{counts ? ` · ${counts}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <a href={pdf} target="_blank" rel="noopener" className={btn}>{locked ? 'Open PDF' : 'Preview PDF'}</a>
          <Link href="/forms/site-survey" className="px-3 py-1.5 text-gray-500">All site surveys</Link>
        </div>
      </div>

      {locked && (
        <div className="rp-card p-4 space-y-4 border-emerald-200 bg-emerald-50/50">
          <p className="text-sm font-semibold text-gray-900">This survey is finished.</p>
          <div className="flex flex-wrap gap-2 text-sm">
            <a href={pdf} target="_blank" rel="noopener" className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-600/90">Open / print PDF</a>
            <a href={`${pdf}?download=1`} className="px-4 py-2 rounded-lg border border-gray-300 bg-card font-semibold text-gray-800 hover:bg-gray-50">Download PDF</a>
            <form action={reopenSurvey.bind(null, id)}><button className="px-4 py-2 rounded-lg border border-gray-300 bg-card text-gray-600 hover:bg-gray-50">Reopen to change</button></form>
          </div>
          <SiteSurveyEmail action={emailSurvey.bind(null, id)} sentTo={row.emailed_to} />
        </div>
      )}

      <SiteSurveyForm key={row.status} row={row} locked={locked} actions={{
        save: saveSurvey.bind(null, id), addPhotos: addPhotos.bind(null, id), updatePhoto: updatePhoto.bind(null, id), removePhoto: removePhoto.bind(null, id), finish: finishSurvey.bind(null, id),
      }} />

      <section className="rp-card overflow-hidden">
        <div className="px-4 py-3 bg-foreground text-background text-sm font-semibold uppercase tracking-wide">Site plan</div>
        <div className="p-4">
          <p className="text-xs text-gray-500 mb-3">Store, canopy, dispensers, tank pad, tanks, vents and pipe runs. Pull up the picture from above and scan it, or draw it. A photo of a paper sketch can go under Site and property.</p>
          <SitePlanEditor key={`${row.status}-plan`} surveyId={id} initial={row.plan} address={row.address ?? ''} locked={locked} actions={{
            save: savePlan.bind(null, id), loadAerial: loadAerial.bind(null, id), removeAerial: removeAerial.bind(null, id), scan: scanPlan.bind(null, id), fromSurvey: drawFromSurvey.bind(null, id),
          }} />
        </div>
      </section>

      {!locked && (
        <form action={deleteSurvey.bind(null, id)} className="text-right">
          <button className="text-xs text-gray-400 hover:text-red-600 underline">Delete this draft</button>
        </form>
      )}
    </div>
  )
}
