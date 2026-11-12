import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { ClickableRow } from '@/components/clickable-row'

type Tracker = {
  id: string; tracker: string; site: string | null; work_type: string | null
  address: string | null; state: string | null; schedule_date: string | null
  el_permit: string | null; mech_permit: string | null; permit: string | null
  quote_needed: string | null; scope: string | null; notes: string | null
  status: string | null; job_id: string | null
}

const TABS = [
  { key: 'line_testing', slug: 'line-testing', label: 'Line Testing' },
  { key: 'spillbucket', slug: 'spillbucket', label: 'Spillbuckets' },
]

const th = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 whitespace-nowrap'
const td = 'px-3 py-2 text-sm text-gray-700 align-top'

function StatusPill({ value }: { value: string | null }) {
  if (!value) return null
  const v = value.toLowerCase()
  const cls = /complete|passed|approved|done/.test(v) ? 'bg-green-100 text-green-700 border-green-200'
    : /progress|schedul|ordered|shipp/.test(v) ? 'bg-blue-100 text-blue-700 border-blue-200'
    : /quote|pending|waiting|need|findings/.test(v) ? 'bg-amber-100 text-amber-800 border-amber-200'
    : 'bg-gray-100 text-gray-600 border-gray-200'
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] leading-tight ${cls}`}>{value}</span>
}

export default async function TrackersPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const sp = await searchParams
  const tab = TABS.find(t => t.slug === sp.type) ?? TABS[0]
  const { company_id } = await requireConstruction()
  const admin = createAdminClient()

  const { data } = await admin.from('con_sunoco_trackers').select('*')
    .eq('company_id', company_id).eq('tracker', tab.key)
    .order('sort').order('site')
  const rows = (data ?? []) as Tracker[]
  const isLine = tab.key === 'line_testing'

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="rp-title">
            Sunoco Trackers
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{rows.length} {tab.label.toLowerCase()} site{rows.length !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/construction" className="text-sm text-gray-500 hover:text-gray-700">← Construction</Link>
      </div>

      {/* Tracker toggle */}
      <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium mb-4">
        {TABS.map(t => (
          <Link key={t.key} href={`/construction/trackers?type=${t.slug}`}
            className={`px-4 py-2 ${t.key === tab.key ? 'bg-foreground text-background' : 'hover:bg-gray-50 text-gray-600'}`}>{t.label}</Link>
        ))}
      </div>

      <div className="rp-card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className={th}>Site</th>
              {isLine ? <th className={th}>Address</th> : <th className={th}>Work</th>}
              {!isLine && <th className={th}>Schedule</th>}
              {isLine ? <th className={th}>Permit</th> : <><th className={th}>EL</th><th className={th}>Mech</th></>}
              <th className={th}>Quote?</th>
              <th className={th}>Scope</th>
              <th className={th}>Notes</th>
              <th className={th}>Status</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => {
              const cells = (
                <>
                  <td className={`${td} font-semibold text-gray-900 whitespace-nowrap`}>{r.site ?? '—'}</td>
                  {isLine
                    ? <td className={td}>{r.address ?? '—'}{r.state ? `, ${r.state}` : ''}</td>
                    : <td className={td}>{r.work_type ?? '—'}</td>}
                  {!isLine && <td className={`${td} whitespace-nowrap`}>{r.schedule_date ?? '—'}</td>}
                  {isLine
                    ? <td className={td}>{r.permit ?? '—'}</td>
                    : <><td className={`${td} text-center`}>{r.el_permit ?? ''}</td><td className={`${td} text-center`}>{r.mech_permit ?? ''}</td></>}
                  <td className={td}>{r.quote_needed ?? ''}</td>
                  <td className={`${td} max-w-[16rem]`}><span className="line-clamp-2">{r.scope ?? ''}</span></td>
                  <td className={`${td} max-w-[16rem]`}><span className="line-clamp-2 text-gray-500">{r.notes ?? ''}</span></td>
                  <td className={td}><StatusPill value={r.status} /></td>
                  <td className={`${td} text-right whitespace-nowrap`}>{r.job_id && <span className="text-xs text-blue-600">View →</span>}</td>
                </>
              )
              return r.job_id
                ? <ClickableRow key={r.id} href={`/construction/jobs/${r.job_id}`}>{cells}</ClickableRow>
                : <tr key={r.id}>{cells}</tr>
            })}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-sm text-gray-400">No {tab.label.toLowerCase()} sites yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
