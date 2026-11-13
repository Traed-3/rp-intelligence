import Link from 'next/link'
import { Plus, Search } from 'lucide-react'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInventory } from '@/lib/inventory-guard'
import { noAccountingOrHr } from '@/lib/role-access'
import { PartForm } from '@/components/inventory/part-form'
import { savePart } from '../actions'
import { PART_CATEGORIES, PRICE_STATUS, SEED_TAG_LABEL, categoryLabel, money, fmtDate, priceAgeDays, PRICE_STALE_DAYS, type Part } from '@/lib/inventory'

const th = 'text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap'
const PAGE = 100

export default async function PartsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string; status?: string; source?: string; page?: string }>
}) {
  const { q = '', cat = '', status = '', source = '', page = '1' } = await searchParams
  const { company_id, canEditCatalog: canWrite, role } = await requireInventory()
  const hideSell = noAccountingOrHr(role)   // techs, mechanics, shop: cost only, never what we charge
  const admin = createAdminClient()
  const pageNo = Math.max(1, parseInt(page, 10) || 1)

  let query = admin.from('parts').select('*', { count: 'exact' })
    .eq('company_id', company_id).eq('active', true)
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`
    query = query.or(`part_number.ilike.${like},description.ilike.${like},subcategory.ilike.${like},manufacturer.ilike.${like}`)
  }
  if (cat === 'svc') query = query.is('category', null)
  else if (cat) query = query.eq('category', parseInt(cat, 10))
  if (status === 'attention') query = query.neq('price_status', 'ok')
  else if (status) query = query.eq('price_status', status)
  if (source) query = query.eq('sku', source)
  query = query.order('category', { ascending: true, nullsFirst: false }).order('subcategory').order('description')
    .range((pageNo - 1) * PAGE, pageNo * PAGE - 1)

  const { data, count } = await query
  const parts = (data ?? []) as Part[]
  const total = count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const link = (over: Record<string, string>) => {
    const p = new URLSearchParams({ q, cat, status, source, ...over })
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k)
    return `/inventory/parts?${p.toString()}`
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="rp-title">
            Parts catalog
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{total.toLocaleString()} item{total !== 1 ? 's' : ''}{q ? ` matching “${q}”` : ''}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/inventory/locations" className="text-sm text-gray-500 hover:text-gray-700">Locations</Link>
          <Link href="/inventory" className="text-sm text-gray-500 hover:text-gray-700">← Inventory</Link>
        </div>
      </div>

      <form method="get" className="rp-card p-4 mb-4 grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-end">
        <div>
          <label htmlFor="parts-q" className="block text-xs font-medium text-gray-500 mb-1">Search part number or description</label>
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
            <input id="parts-q" name="q" defaultValue={q} placeholder="71SO-410C, drop tube, shear valve…" className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div>
          <label htmlFor="parts-cat" className="block text-xs font-medium text-gray-500 mb-1">Category</label>
          <select id="parts-cat" name="cat" defaultValue={cat} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="">All</option>
            {PART_CATEGORIES.map(c => <option key={c.n} value={c.n}>{c.n} · {c.label}</option>)}
            <option value="svc">Service ticket items</option>
          </select>
        </div>
        <div>
          <label htmlFor="parts-status" className="block text-xs font-medium text-gray-500 mb-1">Price status</label>
          <select id="parts-status" name="status" defaultValue={status} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="">All</option>
            <option value="attention">Needs attention</option>
            <option value="ok">Priced</option>
            <option value="price_needed">Price needed</option>
            <option value="held_high">Held high</option>
            <option value="verify">Verify</option>
          </select>
        </div>
        <div>
          <label htmlFor="parts-source" className="block text-xs font-medium text-gray-500 mb-1">Source</label>
          <select id="parts-source" name="source" defaultValue={source} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="">All</option>
            {Object.entries(SEED_TAG_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:bg-primary/90">Filter</button>
      </form>

      <div className="rp-card overflow-hidden mb-5">
        {parts.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">No parts match.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="rp-table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className={th}>Part</th>
                  <th className={`${th} hidden lg:table-cell`}>Category</th>
                  <th className={`${th} text-right`}>Cost</th>
                  <th className={`${th} hidden md:table-cell`}>Priced from</th>
                  {!hideSell && <th className={`${th} text-right hidden sm:table-cell`}>Sell</th>}
                  <th className={th}>Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {parts.map(p => {
                  const st = PRICE_STATUS[p.price_status ?? 'ok'] ?? PRICE_STATUS.ok
                  const age = priceAgeDays(p.cost_date)
                  const stale = age != null && age > PRICE_STALE_DAYS && p.price_status === 'ok'
                  return (
                    <ClickableRow key={p.id} href={`/inventory/parts/${p.id}`}>
                      <td className="px-4 py-3 max-w-md">
                        <div className="font-medium text-gray-900 truncate">{p.description}</div>
                        <div className="text-xs text-gray-400 font-mono">{p.part_number ?? '—'}{p.uom && p.uom !== 'EA' ? ` · per ${p.uom}` : ''}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                        <div>{categoryLabel(p.category)}</div>
                        {p.subcategory && <div className="text-xs text-gray-400 truncate max-w-xs">{p.subcategory}</div>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-900">{p.unit_cost != null ? money(p.unit_cost) : <span className="text-pink-600">needed</span>}</td>
                      <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                        <div className="truncate max-w-[14rem]">{p.cost_vendor ?? (p.sku ? SEED_TAG_LABEL[p.sku] ?? p.sku : '—')}</div>
                        <div className={`text-xs ${stale ? 'text-amber-600' : 'text-gray-400'}`}>{p.cost_date ? fmtDate(p.cost_date) : ''}{stale ? ' · verify' : ''}</div>
                      </td>
                      {!hideSell && <td className="px-4 py-3 text-right tabular-nums text-gray-700 hidden sm:table-cell">{p.sell_price != null ? money(p.sell_price) : '—'}</td>}
                      <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full border ${st.className}`}>{st.label}</span></td>
                      <td className="px-4 py-3 text-right"><span className="text-xs font-medium text-blue-600">View →</span></td>
                    </ClickableRow>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
            <span>Page {pageNo} of {pages}</span>
            <div className="flex gap-2">
              {pageNo > 1 && <Link href={link({ page: String(pageNo - 1) })} className="px-3 py-1 rounded-lg border border-gray-300 hover:bg-gray-50">← Prev</Link>}
              {pageNo < pages && <Link href={link({ page: String(pageNo + 1) })} className="px-3 py-1 rounded-lg border border-gray-300 hover:bg-gray-50">Next →</Link>}
            </div>
          </div>
        )}
      </div>

      {canWrite && (
        <details className="rp-card">
          <summary className="px-5 py-4 cursor-pointer font-semibold text-gray-900 flex items-center gap-2"><Plus className="w-4 h-4 text-blue-600" />Add part</summary>
          <div className="px-5 pb-5"><PartForm action={savePart.bind(null, null)} /></div>
        </details>
      )}
    </div>
  )
}
