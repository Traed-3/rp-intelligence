import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInventory } from '@/lib/inventory-guard'
import { LocationStock, type StockRow } from '@/components/inventory/location-stock'
import { LOCATION_KINDS, fmtDate } from '@/lib/inventory'

const TXN_LABEL: Record<string, string> = { receive: 'Received', issue_to_ticket: 'Used on ticket', return_from_ticket: 'Returned from ticket', transfer_out: 'Transferred out', transfer_in: 'Transferred in', adjust: 'Adjusted', count: 'Count variance', warranty_return: 'Warranty return', scrap: 'Scrapped' }

export default async function LocationStockPage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params
  const { company_id, canWrite } = await requireInventory()
  const admin = createAdminClient()
  const [{ data: loc }, { data: onHand }, { data: levels }, { data: history }] = await Promise.all([
    admin.from('stock_locations').select('*, assets(unit_number, name), svc_technicians(full_name)').eq('id', locationId).eq('company_id', company_id).maybeSingle(),
    admin.from('stock_on_hand').select('part_id, part_number, description, on_hand, min_qty, max_qty').eq('location_id', locationId),
    admin.from('stock_levels').select('part_id, min_qty, max_qty, bin, parts(part_number, description)').eq('location_id', locationId),
    admin.from('inventory_transactions').select('id, txn_type, qty, unit_cost, ref_label, note, created_at, parts(part_number, description), profiles(full_name)').eq('location_id', locationId).order('created_at', { ascending: false }).limit(40),
  ])
  if (!loc) notFound()

  // Merge: everything with on-hand plus everything with a min/max, even at zero.
  const byPart = new Map<string, StockRow>()
  for (const r of onHand ?? []) byPart.set(r.part_id, { part_id: r.part_id, part_number: r.part_number, description: r.description, on_hand: Number(r.on_hand), min_qty: r.min_qty != null ? Number(r.min_qty) : null, max_qty: r.max_qty != null ? Number(r.max_qty) : null, bin: null })
  for (const l of levels ?? []) {
    const p = (l as unknown as { parts: { part_number: string | null; description: string } | null }).parts
    const cur = byPart.get(l.part_id) ?? { part_id: l.part_id, part_number: p?.part_number ?? null, description: p?.description ?? '', on_hand: 0, min_qty: null, max_qty: null, bin: null }
    byPart.set(l.part_id, { ...cur, min_qty: Number(l.min_qty ?? 0), max_qty: Number(l.max_qty ?? 0), bin: l.bin })
  }
  const rows = [...byPart.values()].sort((a, b) => (a.description ?? '').localeCompare(b.description ?? ''))
  const asset = (loc as unknown as { assets: { unit_number: string; name: string | null } | null }).assets
  const tech = (loc as unknown as { svc_technicians: { full_name: string } | null }).svc_technicians
  const kind = LOCATION_KINDS.find(k => k.value === loc.kind)?.label ?? loc.kind

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <Link href="/inventory/stock" className="text-sm text-gray-500 hover:text-gray-700">← Stock on hand</Link>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
          <div>
            <h1 className="rp-title">{loc.name}</h1>
            <p className="text-sm text-gray-500">{kind}{asset ? ` · ${asset.unit_number}${asset.name ? ` ${asset.name}` : ''}` : ''}{tech ? ` · ${tech.full_name}` : ''}</p>
          </div>
          <div className="flex gap-2">
            <Link href={`/inventory/receive?loc=${loc.id}`} className="text-sm rounded-lg border border-gray-200 px-3 py-1.5 text-gray-700 hover:border-blue-300">Receive here</Link>
            <Link href="/inventory/transfers" className="text-sm rounded-lg border border-gray-200 px-3 py-1.5 text-gray-700 hover:border-blue-300">Transfer</Link>
          </div>
        </div>
      </div>

      <LocationStock locationId={loc.id} rows={rows} canWrite={canWrite} />

      <div className="rp-card overflow-hidden mt-5">
        <h2 className="px-5 py-3 font-semibold text-gray-900 border-b border-gray-100">Recent movements</h2>
        {(history ?? []).length === 0 ? <p className="p-5 text-sm text-gray-400">No movements yet.</p> : (
          <div className="overflow-x-auto"><table className="rp-table w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-500 text-xs"><th className="text-left px-4 py-2">When</th><th className="text-left px-4 py-2">What</th><th className="text-left px-4 py-2">Part</th><th className="text-right px-4 py-2">Qty</th><th className="text-left px-4 py-2 hidden md:table-cell">Ref / note</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {(history ?? []).map(h => { const p = (h as unknown as { parts: { part_number: string | null; description: string } | null }).parts; const u = (h as unknown as { profiles: { full_name: string } | null }).profiles; return (
                <tr key={h.id}>
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{fmtDate(h.created_at)}<div className="text-xs text-gray-400">{u?.full_name ?? ''}</div></td>
                  <td className="px-4 py-2 text-gray-700">{TXN_LABEL[h.txn_type] ?? h.txn_type}</td>
                  <td className="px-4 py-2"><div className="text-gray-900">{p?.description}</div><div className="text-xs font-mono text-gray-400">{p?.part_number ?? ''}</div></td>
                  <td className={`px-4 py-2 text-right tabular-nums font-medium ${Number(h.qty) < 0 ? 'text-red-600' : 'text-green-700'}`}>{Number(h.qty) > 0 ? '+' : ''}{Number(h.qty)}</td>
                  <td className="px-4 py-2 text-gray-500 hidden md:table-cell">{[h.ref_label, h.note].filter(Boolean).join(' · ')}</td>
                </tr>) })}
            </tbody></table></div>
        )}
      </div>
    </div>
  )
}
