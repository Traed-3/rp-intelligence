import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { ChecklistCheck } from '@/components/construction/checklist-check'

type Item = {
  id: string; category: string | null; site: string | null; description: string | null
  status_note: string | null; done: boolean; job_id: string | null
}

export default async function ChecklistPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const sp = await searchParams
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()

  const { data } = await admin.from('con_checklist_items').select('*')
    .eq('company_id', company_id).order('category').order('sort').order('site')
  const all = (data ?? []) as Item[]

  const categories = Array.from(new Set(all.map(i => i.category ?? 'Other')))
  const active = sp.category && categories.includes(sp.category) ? sp.category : ''
  const items = active ? all.filter(i => (i.category ?? 'Other') === active) : all

  // group (preserve order)
  const groups = new Map<string, Item[]>()
  for (const i of items) {
    const k = i.category ?? 'Other'
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(i)
  }
  const doneCount = all.filter(i => i.done).length

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="rp-title">
            Checklist
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{doneCount} of {all.length} done</p>
        </div>
        <Link href="/construction" className="text-sm text-gray-500 hover:text-gray-700">← Construction</Link>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mr-0.5">Category</span>
        <Link href="/construction/checklist" className={`text-xs px-2.5 py-1 rounded-full border ${!active ? 'bg-foreground text-background border-foreground' : 'bg-card text-gray-600 border-gray-300 hover:bg-gray-50'}`}>All</Link>
        {categories.map(c => (
          <Link key={c} href={`/construction/checklist?category=${encodeURIComponent(c)}`}
            className={`text-xs px-2.5 py-1 rounded-full border ${active === c ? 'bg-foreground text-background border-foreground' : 'bg-card text-gray-600 border-gray-300 hover:bg-gray-50'}`}>{c}</Link>
        ))}
      </div>

      <div className="space-y-5">
        {Array.from(groups.entries()).map(([cat, list]) => (
          <div key={cat} className="rp-card overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">{cat}</h2>
              <span className="text-xs text-gray-400">{list.length}</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {list.map(i => (
                <li key={i.id} className="flex items-start gap-3 px-4 py-2.5">
                  <div className="pt-0.5"><ChecklistCheck id={i.id} done={i.done} disabled={!canWrite} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {i.site && (
                        i.job_id
                          ? <Link href={`/construction/jobs/${i.job_id}`} className="font-semibold text-blue-600 hover:underline">{i.site}</Link>
                          : <span className="font-semibold text-gray-900">{i.site}</span>
                      )}
                      <span className={`text-sm ${i.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>{i.description ?? ''}</span>
                    </div>
                    {i.status_note && <p className="text-xs text-gray-400 mt-0.5">{i.status_note}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {all.length === 0 && <p className="text-center text-sm text-gray-400 py-10">No checklist items yet.</p>}
      </div>
    </div>
  )
}
