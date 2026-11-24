import { noAccountingOrHr } from '@/lib/role-access'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInventory } from '@/lib/inventory-guard'
import { PartForm } from '@/components/inventory/part-form'
import { DeleteButton } from '@/components/construction/delete-button'
import { savePart, deletePart } from '../../actions'
import { PRICE_STATUS, COST_SOURCE_LABEL, SEED_TAG_LABEL, categoryLabel, money, fmtDate, computeSellPrice, DEFAULT_MATERIAL_MARKUP, type Part } from '@/lib/inventory'

const KIND_LABEL: Record<string, string> = {
  cost_receipt: 'Receipt', cost_vendor_quote: 'Vendor quote', cost_book: 'Price book', cost_web: 'Web', sell_billed: 'Billed to customer',
}

export default async function PartDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { company_id, canEditCatalog: mayWrite, role } = await requireInventory()
  // Techs, mechanics and shop employees see cost only: no sell price, markup or billed-to-customer history, and no price editing.
  const hideSell = noAccountingOrHr(role)
  const canWrite = mayWrite && !hideSell
  const admin = createAdminClient()

  const [{ data: part }, { data: history }, { data: stock }] = await Promise.all([
    admin.from('parts').select('*').eq('id', id).eq('company_id', company_id).single(),
    admin.from('part_price_history').select('*').eq('part_id', id).order('observed_on', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(50),
    admin.from('stock_on_hand').select('location_name, location_kind, on_hand, min_qty, max_qty').eq('part_id', id).order('location_name'),
  ])
  if (!part) notFound()
  const p = part as Part
  const st = PRICE_STATUS[p.price_status ?? 'ok'] ?? PRICE_STATUS.ok
  const computedVa = computeSellPrice(p, 0.053, p.markup_pct ?? DEFAULT_MATERIAL_MARKUP)
  const computedExempt = computeSellPrice(p, 0, p.markup_pct ?? DEFAULT_MATERIAL_MARKUP)

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-5">
        <Link href="/inventory/parts" className="text-sm text-gray-500 hover:text-gray-700">← Parts catalog</Link>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <h1 className="rp-title">{p.description}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${st.className}`}>{st.label}</span>
        </div>
        <p className="text-sm text-gray-500 mt-1 font-mono">{p.part_number ?? 'no part number'} · {categoryLabel(p.category)}{p.subcategory ? ` · ${p.subcategory}` : ''}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Stat label="Unit cost" value={p.unit_cost != null ? money(p.unit_cost) : 'needed'} sub={p.cost_vendor ?? (p.sku ? SEED_TAG_LABEL[p.sku] : undefined)} />
        <Stat label="Priced on" value={fmtDate(p.cost_date)} sub={p.cost_source ? COST_SOURCE_LABEL[p.cost_source] ?? p.cost_source : undefined} />
        {!hideSell && <Stat label="Sell (explicit)" value={p.sell_price != null ? money(p.sell_price) : '—'} sub={p.markup_pct != null ? `${Math.round(p.markup_pct * 100)}% markup` : 'flat 20% markup'} />}
        {!hideSell && <Stat label="Computed sell" value={computedVa != null ? money(computedVa) : 'rule not set'} sub={computedExempt != null ? `${money(computedExempt)} tax-exempt` : 'VA 5.3% tax'} />}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <section className="rp-card overflow-hidden">
          <h2 className="px-5 py-3 font-semibold text-gray-900 border-b border-gray-100">Price history</h2>
          {(history ?? []).length === 0 ? (
            <p className="p-5 text-sm text-gray-400">No prices recorded yet.</p>
          ) : (
            <table className="rp-table w-full text-sm">
              <thead><tr className="bg-gray-50 text-gray-500"><th className="text-left px-4 py-2">Date</th><th className="text-left px-4 py-2">Kind</th><th className="text-right px-4 py-2">Price</th><th className="text-left px-4 py-2 hidden sm:table-cell">Reference</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {(history ?? []).filter(h => !hideSell || !String(h.kind).startsWith('sell')).map(h => (
                  <tr key={h.id}>
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{fmtDate(h.observed_on)}</td>
                    <td className="px-4 py-2 text-gray-600">{KIND_LABEL[h.kind] ?? h.kind}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-900">{money(Number(h.price))}</td>
                    <td className="px-4 py-2 text-gray-500 hidden sm:table-cell truncate max-w-[16rem]">{[h.vendor, h.reference].filter(Boolean).join(' · ') || h.source_note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rp-card overflow-hidden">
          <h2 className="px-5 py-3 font-semibold text-gray-900 border-b border-gray-100">On hand by location</h2>
          {(stock ?? []).length === 0 ? (
            <p className="p-5 text-sm text-gray-400">{p.is_stocked ? 'No stock movements posted yet.' : 'Not tracked as stock. Tick “Tracked in inventory” below to count it on trucks and shelves.'}</p>
          ) : (
            <table className="rp-table w-full text-sm">
              <thead><tr className="bg-gray-50 text-gray-500"><th className="text-left px-4 py-2">Location</th><th className="text-right px-4 py-2">On hand</th><th className="text-right px-4 py-2">Min / Max</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {(stock ?? []).map(s => (
                  <tr key={s.location_name}>
                    <td className="px-4 py-2 text-gray-800">{s.location_name}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${Number(s.on_hand) < Number(s.min_qty ?? 0) ? 'text-red-600 font-semibold' : 'text-gray-900'}`}>{Number(s.on_hand)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-500">{s.min_qty ?? '—'} / {s.max_qty ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {p.notes && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 mb-5"><span className="text-xs uppercase tracking-wide text-gray-400 mr-2">Source note</span>{p.notes}</div>
      )}

      <div className="rp-card p-5 mb-5">
        <h2 className="font-semibold text-gray-900 mb-4">{canWrite ? 'Edit part' : 'Details'}</h2>
        {canWrite ? <PartForm action={savePart.bind(null, id)} part={p} /> : <p className="text-sm text-gray-500">You can view the catalog. Ask a manager to change prices.</p>}
      </div>

      {canWrite && <DeleteButton action={deletePart.bind(null, id)} confirm={`Remove “${p.description}” from the catalog?`} label="Remove part" />}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rp-card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-lg font-semibold text-gray-900 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-gray-500 truncate">{sub}</div>}
    </div>
  )
}
