import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInventory } from '@/lib/inventory-guard'
import { TransferForm, TransferStatusButtons } from '@/components/inventory/transfer-form'
import { fmtDate } from '@/lib/inventory'

const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700 border-gray-200', picked: 'bg-amber-100 text-amber-800 border-amber-200',
  received: 'bg-green-100 text-green-800 border-green-200', cancelled: 'bg-gray-100 text-gray-400 border-gray-200',
}

export default async function TransfersPage() {
  const { company_id, canWrite } = await requireInventory()
  const admin = createAdminClient()
  const [{ data: locations }, { data: transfers }, { data: onHand }] = await Promise.all([
    admin.from('stock_locations').select('id, name, kind').eq('company_id', company_id).eq('active', true).in('kind', ['office', 'truck', 'jobsite']).order('kind').order('name'),
    admin.from('stock_transfers').select('*, from:stock_locations!stock_transfers_from_location_fkey(name), to:stock_locations!stock_transfers_to_location_fkey(name), stock_transfer_lines(qty, parts(part_number, description)), profiles!stock_transfers_requested_by_fkey(full_name)')
      .eq('company_id', company_id).order('created_at', { ascending: false }).limit(60),
    admin.from('stock_on_hand').select('location_id, part_id, part_number, description, on_hand, min_qty, max_qty, below_min').eq('company_id', company_id).eq('below_min', true),
  ])
  const shortages = (onHand ?? []).map(r => ({ location_id: r.location_id, part_id: r.part_id, part_number: r.part_number, description: r.description, on_hand: Number(r.on_hand), min_qty: Number(r.min_qty ?? 0), max_qty: Number(r.max_qty ?? 0) }))

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="rp-title">Transfers</h1>
          <p className="text-sm text-gray-500 mt-0.5">Office to truck, truck to truck. Stock moves when the truck marks it received, so nothing is lost in between.</p>
        </div>
        <Link href="/inventory" className="text-sm text-gray-500 hover:text-gray-700">← Inventory</Link>
      </div>

      {canWrite && (
        <details className="rp-card mb-5" open={(transfers ?? []).length === 0}>
          <summary className="px-5 py-4 cursor-pointer font-semibold text-gray-900 flex items-center gap-2"><Plus className="w-4 h-4 text-blue-600" />New transfer</summary>
          <div className="px-5 pb-5"><TransferForm locations={locations ?? []} shortages={shortages} /></div>
        </details>
      )}

      <div className="rp-card overflow-hidden">
        {(transfers ?? []).length === 0 ? <p className="p-8 text-center text-sm text-gray-400">No transfers yet.</p> : (
          <div className="overflow-x-auto"><table className="rp-table w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-500 text-xs"><th className="text-left px-4 py-2">Created</th><th className="text-left px-4 py-2">From → To</th><th className="text-left px-4 py-2">Parts</th><th className="text-left px-4 py-2">Status</th><th className="px-4 py-2" /></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {(transfers ?? []).map(t => { const x = t as unknown as { from: { name: string } | null; to: { name: string } | null; stock_transfer_lines: { qty: number; parts: { part_number: string | null; description: string } | null }[]; profiles: { full_name: string } | null }; return (
                <tr key={t.id} className="align-top">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(t.created_at)}<div className="text-xs text-gray-400">{x.profiles?.full_name ?? ''}</div></td>
                  <td className="px-4 py-3 text-gray-900 whitespace-nowrap">{x.from?.name} → <b>{x.to?.name}</b>{t.note && <div className="text-xs text-gray-400">{t.note}</div>}</td>
                  <td className="px-4 py-3 text-gray-700"><ul className="space-y-0.5">{x.stock_transfer_lines.map((l, i) => <li key={i}><span className="tabular-nums">{Number(l.qty)} ×</span> {l.parts?.description}{l.parts?.part_number && <span className="ml-1 font-mono text-xs text-gray-400">{l.parts.part_number}</span>}</li>)}</ul></td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_CLASS[t.status] ?? ''}`}>{t.status}</span>{t.received_at && <div className="text-xs text-gray-400 mt-1">{fmtDate(t.received_at)}</div>}</td>
                  <td className="px-4 py-3">{canWrite && <TransferStatusButtons id={t.id} status={t.status} />}</td>
                </tr>) })}
            </tbody></table></div>
        )}
      </div>
    </div>
  )
}
