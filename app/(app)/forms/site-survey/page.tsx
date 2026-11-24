import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireFieldSurveys } from '@/lib/construction-guard'
import { type SiteSurveyRow, surveyTitle, surveyCounts, fmtDate } from '@/lib/site-survey'
import { StartSurvey } from '@/components/forms/site-picker'
import { createSurvey, findSites } from './actions'
import { ClipboardList } from 'lucide-react'
import { TitleIcon } from '@/components/ui/title-icon'

export const dynamic = 'force-dynamic'
const STATUS: Record<string, string> = { draft: 'rp-stage rp-stage-needs-scheduled', complete: 'rp-stage rp-stage-complete' }

export default async function SiteSurveyListPage() {
  const profile = await requireFieldSurveys()
  const admin = createAdminClient()
  // Techs see the surveys they did; the construction office roles see everyone's.
  const q = admin.from('site_surveys').select('id, site_number, site_name, address, survey_date, tech_name, status, data, photos, plan, created_by').eq('company_id', profile.company_id)
  const { data } = await (profile.fullAccess ? q : q.eq('created_by', profile.id)).order('survey_date', { ascending: false }).order('created_at', { ascending: false }).limit(200)
  const rows = (data ?? []) as unknown as SiteSurveyRow[]

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto overflow-x-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="rp-title"><TitleIcon icon={ClipboardList} tone="gold" />Site Surveys</h1>
          <p className="text-sm text-gray-500 mt-0.5">The whole site on one form: tanks, sumps, buckets, dispensers, piping, electrical, photos and a site plan. Add as many of each as the site has.</p>
        </div>
        <Link href="/forms" className="text-sm text-gray-500 hover:text-gray-700">← Forms</Link>
      </div>

      <StartSurvey action={createSurvey} search={findSites} />

      <div className="rp-card overflow-hidden">
        <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide bg-foreground text-background">{profile.fullAccess ? 'Site surveys' : 'My site surveys'}</div>
        {!rows.length ? <p className="p-4 text-sm text-gray-400">No site surveys yet. Start one above.</p> : (
          <ul className="divide-y divide-gray-100">
            {rows.map(r => {
              const counts = surveyCounts(r.data), n = (r.photos ?? []).length
              return (
                <li key={r.id}>
                  <Link href={`/forms/site-survey/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS[r.status] ?? 'bg-gray-200'}`}>{r.status === 'complete' ? 'done' : 'draft'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-900 truncate">{surveyTitle(r)}{r.address ? <span className="font-normal text-gray-500"> · {r.address}</span> : null}</span>
                      <span className="block text-xs text-gray-500">{fmtDate(r.survey_date)} · {r.tech_name ?? 'tech'}{counts ? ` · ${counts}` : ''}{n ? ` · ${n} photo${n === 1 ? '' : 's'}` : ''}{r.plan?.elements?.length ? ' · site plan' : ''}</span>
                    </span>
                    <span className="text-xs text-blue-600">Open →</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
