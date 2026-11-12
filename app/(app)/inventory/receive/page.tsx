import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInventory } from '@/lib/inventory-guard'
import { ReceiveForm } from '@/components/inventory/receive-form'
import { money, fmtDate } from '@/lib/inventory'

export default async function ReceivePage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const { loc } = await searchParams
  const { company_id, canWrite } = await requireInventory()
  const admin = createAdminClient()
  const [{ data: locations }, { data: recent }, { count: queued }] = await Promise.all([
    admin.from('stock_locations').select('id, name, kind').eq('company_id', company_id).eq('active', true).in('kind', ['office', 'truck', 'jobsite']).order('kind').order('name'),
    admin.from('inventory_transactions').select('id, qty, unit_cost, ref_label, note, created_at, parts(part_number, description), stock_locations(name), profiles(full_name)')
      .eq('company_id', company_id).eq('txn_type', 'receive').order('created_at', { ascending: false }).limit(40),
    admin.from('billing_inbox_documents').select('id', { count: 'exact', head: true }).eq('company_id', company_id).eq('status', 'new'),
  ])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="rp-title">Receive stock</h1>
          <p className="text-sm text-gray-500 mt-0.5">Parts arriving from a packing slip, a vendor invoice, or the counter. The cost you type here becomes the part&apos;s receipt cost.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/inventory/receive/queue" className={`text-sm rounded-lg border px-3 py-1.5 ${(queued ?? 0) > 0 ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-blue-300'}`}>Email queue{(queued ?? 0) > 0 ? ` (${queued})` : ''}</Link>
          <Link href="/inventory" className="text-sm text-gray-500 hover:text-gray-700">← Inventory</Link>
        </div>
      </div>

      {canWrite ? (
        <div className="rp-card p-5 mb-6"><ReceiveForm locations={locations ?? []} defaultLocation={loc} /></div>
      ) : <p className="text-sm text-gray-500 mb-6">Your role can view stock but not receive it.</p>}

      <div className="rp-card overflow-hidden">
        <h2 className="px-5 py-3 font-semibold text-gray-900 border-b border-gray-100">Recent receipts</h2>
        {(recent ?? []).length === 0 ? <p className="p-5 text-sm text-gray-400">Nothing received yet.</p> : (
          <div className="overflow-x-auto"><table className="rp-table w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-500 text-xs"><th className="text-left px-4 py-2">When</th><th className="text-left px-4 py-2">Part</th><th className="text-right px-4 py-2">Qty</th><th className="text-right px-4 py-2">Cost</th><th className="text-left px-4 py-2">Into</th><th className="text-left px-4 py-2 hidden md:table-cell">Ref</th><th className="text-left px-4 py-2 hidden md:table-cell">By</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {(recent ?? []).map(r => { const p = (r as unknown as { parts: { part_number: string | null; description: string } | null }).parts; const l = (r as unknown as { stock_locations: { name: string } | null }).stock_locations; const u = (r as unknown as { profiles: { full_name: string } | null }).profiles; return (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  <td className="px-4 py-2"><div className="text-gray-900">{p?.description}</div><div className="text-xs font-mono text-gray-400">{p?.part_number ?? ''}</div></td>
                  <td className="px-4 py-2 text-right tabular-nums">{Number(r.qty)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.unit_cost != null ? money(Number(r.unit_cost)) : '—'}</td>
                  <td className="px-4 py-2 text-gray-700">{l?.name ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-500 hidden md:table-cell">{[r.ref_label, r.note].filter(Boolean).join(' · ')}</td>
                  <td className="px-4 py-2 text-gray-500 hidden md:table-cell">{u?.full_name ?? ''}</td>
                </tr>) })}
            </tbody></table></div>
        )}
      </div>
    </div>
  )
}
