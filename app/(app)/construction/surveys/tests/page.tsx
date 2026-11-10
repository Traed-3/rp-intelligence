import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireFieldSurveys } from '@/lib/construction-guard'
import { testTitle, stateInfo, ITEM_KINDS, STATES } from '@/lib/containment-test'
import { createTest } from './actions'

export const dynamic = 'force-dynamic'
const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'
const STATUS: Record<string, string> = { draft: 'bg-[#FFC000] text-black', complete: 'bg-[#70AD47] text-white', sent: 'bg-[#385624] text-white' }

export default async function ContainmentTestsPage() {
  const profile = await requireFieldSurveys()
  const admin = createAdminClient()
  const [{ data: tests }, { data: jobs }] = await Promise.all([
    (() => { const q = admin.from('con_containment_tests').select('id, site_number, facility_name, state, test_date, tester_name, status, updated_at').eq('company_id', profile.company_id); return (profile.ownOnly ? q.eq('created_by', profile.id) : q).order('updated_at', { ascending: false }).limit(80) })(),
    admin.from('con_jobs').select('id, site_number, gas_brand, work_order_number, con_sites(state)').eq('company_id', profile.company_id).neq('stage', 'complete').order('site_number'),
  ])
  const results = new Map<string, { n: number; fail: boolean }>()
  if (tests?.length) {
    const { data: items } = await admin.from('con_containment_test_items').select('test_id, result').in('test_id', tests.map(t => t.id))
    for (const r of items ?? []) { const c = results.get(r.test_id) ?? { n: 0, fail: false }; c.n++; if (r.result === 'fail') c.fail = true; results.set(r.test_id, c) }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto overflow-x-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-emerald-500 before:to-emerald-700 before:shrink-0">Sump / UDC / Spill Bucket Tests</h1>
          <p className="text-sm text-gray-500 mt-0.5">Filled out at the site. The site&apos;s state picks the form: Maryland → MDE, Virginia → DEQ, West Virginia → WVDEP. Finish makes the PDF and emails it.</p>
        </div>
        <Link href="/construction/surveys" className="text-sm text-gray-500 hover:text-gray-700">← Field Surveys</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide bg-gray-900 text-white">Tests</div>
          {!tests?.length ? <p className="p-4 text-sm text-gray-400">No tests yet. Start one on the right.</p> : (
            <ul className="divide-y divide-gray-100">
              {tests.map(t => { const r = results.get(t.id); return (
                <li key={t.id}>
                  <Link href={`/construction/surveys/tests/${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS[t.status] ?? 'bg-gray-200'}`}>{t.status}</span>
                    <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border border-gray-300 text-gray-700">{stateInfo(t.state).agency}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-900 truncate">{testTitle(t)}</span>
                      <span className="block text-xs text-gray-500">{t.test_date} · {t.tester_name ?? 'tech'} · {r?.n ?? 0} tested{r?.fail ? <span className="text-red-600 font-semibold"> · FAIL</span> : ''}</span>
                    </span>
                    <span className="text-xs text-blue-600">Open →</span>
                  </Link>
                </li>
              ) })}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide bg-emerald-700 text-white">New test</div>
          <form action={createTest} className="p-4 space-y-3">
            <div><label className={lbl}>Job (fills site, address and state)</label><select name="job_id" defaultValue="" className={inp}><option value="">— no job, type the site —</option>{(jobs ?? []).map(j => { const st = (j.con_sites as unknown as { state: string | null } | null)?.state; return <option key={j.id} value={j.id}>{j.site_number}{j.gas_brand ? ` · ${j.gas_brand}` : ''}{st ? ` · ${st}` : ''}{profile.fullAccess && j.work_order_number ? ` · ${j.work_order_number}` : ''}</option> })}</select></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={lbl}>Site #</label><input name="site_number" placeholder="11009" className={inp} /></div>
              <div><label className={lbl}>Facility name</label><input name="facility_name" placeholder="Global Exxon" className={inp} /></div>
            </div>
            <div><label className={lbl}>Address (street, city, ST zip)</label><input name="address" placeholder="6971 Baltimore Annapolis Blvd, Brooklyn, MD 21225" className={inp} /></div>
            <div><label className={lbl}>State form</label><select name="state" defaultValue="" className={inp}><option value="">Auto from the site address</option>{STATES.map(s => <option key={s.value} value={s.value}>{s.label} ({s.agency})</option>)}</select></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={lbl}>First item</label><select name="kind" defaultValue="udc" className={inp}>{ITEM_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</select></div>
              <div><label className={lbl}>Number / product</label><input name="label" list="first-item-num" placeholder="1/2, RUL" className={inp} /><datalist id="first-item-num">{[...new Set(ITEM_KINDS.flatMap(k => k.numbers))].map(n => <option key={n} value={n} />)}</datalist></div>
            </div>
            <div><label className={lbl}>Test date</label><input name="test_date" type="date" defaultValue={new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })} className={inp} /></div>
            <button className="w-full rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-semibold hover:bg-emerald-700">Start test</button>
          </form>
        </div>
      </div>
    </div>
  )
}
