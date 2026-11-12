import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInventory } from '@/lib/inventory-guard'
import { LOCATION_KINDS } from '@/lib/inventory'

const th = 'text-left px-4 py-3 font-medium text-gray-500'

export default async function StockOverviewPage() {
  const { company_id } = await requireInventory()
  const admin = createAdminClient()
  const [{ data: locations }, { data: onHand }, { data: pendingTransfers }] = await Promise.all([
    admin.from('stock_locations').select('id, name, kind, department, svc_technicians(full_name)').eq('company_id', company_id).eq('active', true).order('kind').order('name'),
    admin.from('stock_on_hand').select('location_id, on_hand, below_min').eq('company_id', company_id),
    admin.from('stock_transfers').select('to_location').eq('company_id', company_id).in('status', ['pending', 'picked']),
  ])
  const stats = new Map<string, { lines: number; units: number; below: number }>()
  for (const r of onHand ?? []) { const s = stats.get(r.location_id) ?? { lines: 0, units: 0, below: 0 }; if (Number(r.on_hand) > 0) { s.lines++; s.units += Number(r.on_hand) } if (r.below_min) s.below++; stats.set(r.location_id, s) }
  const inbound = new Map<string, number>(); for (const t of pendingTransfers ?? []) inbound.set(t.to_location, (inbound.get(t.to_location) ?? 0) + 1)
  const kindLabel = (k: string) => LOCATION_KINDS.find(x => x.value === k)?.label ?? k
  const list = locations ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="rp-title">Stock on hand</h1>
          <p className="text-sm text-gray-500 mt-0.5">Every shelf and truck. Open one to set min/max, count it, or adjust.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/inventory/receive" className="text-sm text-blue-600 hover:text-blue-800">Receive</Link>
          <Link href="/inventory/transfers" className="text-sm text-blue-600 hover:text-blue-800">Transfers</Link>
          <Link href="/inventory" className="text-sm text-gray-500 hover:text-gray-700">← Inventory</Link>
        </div>
      </div>
      <div className="rp-card overflow-hidden">
        <div className="overflow-x-auto"><table className="rp-table w-full text-sm">
          <thead><tr className="border-b border-gray-100 bg-gray-50"><th className={th}>Location</th><th className={`${th} hidden sm:table-cell`}>Kind</th><th className={`${th} hidden md:table-cell`}>Technician</th><th className={`${th} text-right`}>Parts</th><th className={`${th} text-right`}>Units</th><th className={`${th} text-right`}>Below min</th><th className={`${th} text-right hidden sm:table-cell`}>Inbound</th><th className="px-4 py-3" /></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {list.map(l => { const s = stats.get(l.id) ?? { lines: 0, units: 0, below: 0 }; const tech = (l as unknown as { svc_technicians: { full_name: string } | null }).svc_technicians; return (
              <ClickableRow key={l.id} href={`/inventory/stock/${l.id}`}>
                <td className="px-4 py-3 font-medium text-gray-900">{l.name}</td>
                <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{kindLabel(l.kind)}</td>
                <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{tech?.full_name ?? '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{s.lines}</td>
                <td className="px-4 py-3 text-right tabular-nums">{s.units}</td>
                <td className={`px-4 py-3 text-right tabular-nums ${s.below ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{s.below || '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500 hidden sm:table-cell">{inbound.get(l.id) ?? '—'}</td>
                <td className="px-4 py-3 text-right"><span className="text-xs font-medium text-blue-600">Open →</span></td>
              </ClickableRow>) })}
          </tbody></table></div>
      </div>
    </div>
  )
}
