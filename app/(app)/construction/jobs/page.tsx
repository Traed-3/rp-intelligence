import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { CON_STAGES, stageMeta, fmtDate, safeSearchTerm } from '@/lib/construction'
import { StageBadge, ConPriorityBadge } from '@/components/construction/badges'
import { Button } from '@/components/ui/button'
import { Plus, LayoutGrid, List } from 'lucide-react'

type SearchParams = {
  view?: string; stage?: string; customer?: string; brand?: string
  program?: string; priority?: string; q?: string
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const view = sp.view === 'table' ? 'table' : 'kanban'
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()

  const { data: customers } = await admin
    .from('con_customers').select('id, name').eq('company_id', company_id).order('name')

  // Supabase returns at most 1000 rows per request no matter what .limit()
  // says, so the list is read a page at a time until it runs out. (A plain
  // .limit(5000) silently dropped the oldest completed jobs past row 1000.)
  const q = safeSearchTerm(sp.q)
  const buildQuery = () => {
    let query = admin
      .from('con_jobs')
      .select('id, site_number, job_number, work_order_number, stage, priority, gas_brand, program, status_detail, date_received, customer_id, con_customers(name)')
      .eq('company_id', company_id)
      .order('date_received', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id')

    if (sp.customer) query = query.eq('customer_id', sp.customer)
    if (sp.priority) query = query.eq('priority', sp.priority)
    if (sp.brand)    query = query.ilike('gas_brand', `%${sp.brand}%`)
    if (sp.program)  query = query.ilike('program', `%${sp.program}%`)
    if (q)           query = query.or(`site_number.ilike.%${q}%,work_order_number.ilike.%${q}%,scope_of_work.ilike.%${q}%`)
    // stage filter only applies in table view (kanban shows all stages as columns)
    if (view === 'table' && sp.stage) query = query.eq('stage', sp.stage)

    return query
  }
  const PAGE = 1000
  const first = await buildQuery().range(0, PAGE - 1)
  const list = first.data ?? []
  for (let from = PAGE; list.length === from && from < 20000; from += PAGE) {
    const { data: more } = await buildQuery().range(from, from + PAGE - 1)
    if (!more?.length) break
    list.push(...more)
  }

  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams()
    if (sp.customer) p.set('customer', sp.customer)
    if (sp.priority) p.set('priority', sp.priority)
    if (sp.brand) p.set('brand', sp.brand)
    if (sp.program) p.set('program', sp.program)
    if (sp.q) p.set('q', sp.q)
    if (sp.stage) p.set('stage', sp.stage)
    for (const [k, v] of Object.entries(extra)) { if (v) p.set(k, v); else p.delete(k) }
    return `/construction/jobs?${p.toString()}`
  }

  return (
    <div className={view === 'kanban' ? 'p-6' : 'p-6 max-w-7xl mx-auto'}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">
            Jobs
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{list.length} job{list.length !== 1 ? 's' : ''}{view === 'table' && sp.stage ? ` · ${stageMeta(sp.stage).label}` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/construction" className="text-sm text-gray-500 hover:text-gray-700 mr-1">← Construction</Link>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <Link href={qs({ view: 'table' })} className={`px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5 ${view === 'table' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}><List className="w-3.5 h-3.5" />Table</Link>
            <Link href={qs({ view: 'kanban' })} className={`px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5 ${view === 'kanban' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}><LayoutGrid className="w-3.5 h-3.5" />Board</Link>
          </div>
          {canWrite && <Link href="/construction/jobs/new"><Button className="gap-2"><Plus className="w-4 h-4" />New Job</Button></Link>}
        </div>
      </div>

      {/* Filters */}
      <form method="GET" className="flex flex-wrap items-end gap-2 mb-5">
        <input type="hidden" name="view" value={view} />
        <div className="flex-1 min-w-[180px]">
          <input name="q" defaultValue={sp.q ?? ''} placeholder="Search site #, WO #, scope…" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select name="customer" defaultValue={sp.customer ?? ''} className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white">
          <option value="">All customers</option>
          {customers?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {view === 'table' && (
          <select name="stage" defaultValue={sp.stage ?? ''} className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white">
            <option value="">All stages</option>
            {CON_STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
        <select name="priority" defaultValue={sp.priority ?? ''} className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white">
          <option value="">Any priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
        <input name="brand" defaultValue={sp.brand ?? ''} placeholder="Brand" className="w-28 px-3 py-2 text-sm border border-gray-300 rounded-lg" />
        <input name="program" defaultValue={sp.program ?? ''} placeholder="Program" className="w-32 px-3 py-2 text-sm border border-gray-300 rounded-lg" />
        <button type="submit" className="px-4 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 rounded-lg">Filter</button>
      </form>

      {list.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center">
          <p className="text-gray-400 text-sm">No jobs match.</p>
        </div>
      ) : view === 'kanban' ? (
        <div className="min-w-0">
          {/* Board wraps to fit the screen (no sideways scroll); empty stages collapse to chips below. */}
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 min-w-0">
            {CON_STAGES.filter(stage => list.some(j => j.stage === stage.value)).map(stage => {
              const col = list.filter(j => j.stage === stage.value)
              return (
                <div key={stage.value} className="min-w-0">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <StageBadge stage={stage.value} />
                    <span className="text-xs text-gray-400">{col.length}</span>
                  </div>
                  <div className="space-y-2">
                    {col.map(j => (
                      <Link key={j.id} href={`/construction/jobs/${j.id}`} className="block bg-white rounded-xl border border-gray-200 shadow-sm p-3 hover:border-blue-300 hover:shadow transition-all min-w-0">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="font-semibold text-sm text-gray-900 truncate">{j.job_number ?? j.site_number ?? "—"}</span>
                          <ConPriorityBadge priority={j.priority} />
                        </div>
                        {(j as any).con_customers?.name && <div className="text-xs text-gray-500 mt-0.5 truncate">{(j as any).con_customers.name}</div>}
                        {j.work_order_number && <div className="text-xs text-gray-400 mt-0.5 font-mono truncate">{j.work_order_number}</div>}
                        {j.status_detail && <div className="text-xs text-gray-500 mt-1 line-clamp-2 break-words">{j.status_detail}</div>}
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          {CON_STAGES.some(stage => !list.some(j => j.stage === stage.value)) && (
            <div className="flex flex-wrap items-center gap-2 mt-4 px-1">
              <span className="text-xs text-gray-400">Empty:</span>
              {CON_STAGES.filter(stage => !list.some(j => j.stage === stage.value)).map(stage => <StageBadge key={stage.value} stage={stage.value} />)}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Site #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden md:table-cell">Customer</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden lg:table-cell">WO #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Stage</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden sm:table-cell">Priority</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden lg:table-cell">Program</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden xl:table-cell">Received</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {list.map(j => (
                  <ClickableRow key={j.id} href={`/construction/jobs/${j.id}`}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{j.job_number ?? j.site_number ?? "—"}</span>
                      {j.gas_brand && <div className="text-xs text-gray-400">{j.gas_brand}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{(j as any).con_customers?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono hidden lg:table-cell">{j.work_order_number ?? '—'}</td>
                    <td className="px-4 py-3"><StageBadge stage={j.stage} /></td>
                    <td className="px-4 py-3 hidden sm:table-cell"><ConPriorityBadge priority={j.priority} /></td>
                    <td className="px-4 py-3 text-gray-600 hidden lg:table-cell text-xs">{j.program ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs hidden xl:table-cell">{fmtDate(j.date_received)}</td>
                    <td className="px-4 py-3 text-right"><span className="text-xs font-medium text-blue-600">View →</span></td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
