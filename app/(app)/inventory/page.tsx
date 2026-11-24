import Link from 'next/link'
import { Package, PackagePlus, Warehouse, ArrowLeftRight, ClipboardCheck, AlertTriangle } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInventory } from '@/lib/inventory-guard'

export default async function InventoryHubPage() {
  const { company_id } = await requireInventory()
  const admin = createAdminClient()

  const [{ count: partCount }, { count: needPrice }, { count: stockedCount }, { count: truckCount }, { count: txnCount }, { count: queued }] = await Promise.all([
    admin.from('parts').select('id', { count: 'exact', head: true }).eq('company_id', company_id).eq('active', true),
    admin.from('parts').select('id', { count: 'exact', head: true }).eq('company_id', company_id).eq('active', true).neq('price_status', 'ok'),
    admin.from('parts').select('id', { count: 'exact', head: true }).eq('company_id', company_id).eq('is_stocked', true),
    admin.from('stock_locations').select('id', { count: 'exact', head: true }).eq('company_id', company_id).eq('kind', 'truck').eq('active', true),
    admin.from('inventory_transactions').select('id', { count: 'exact', head: true }).eq('company_id', company_id),
    admin.from('billing_inbox_documents').select('id', { count: 'exact', head: true }).eq('company_id', company_id).eq('status', 'new'),
  ])

  const tiles = [
    { href: '/inventory/parts', icon: Package, title: 'Parts catalog', body: `${partCount ?? 0} parts and services · ${needPrice ?? 0} need a price`, live: true },
    { href: '/inventory/locations', icon: Warehouse, title: 'Stock locations', body: `Office shelves and ${truckCount ?? 0} trucks`, live: true },
    { href: '/inventory/stock', icon: ClipboardCheck, title: 'Stock on hand', body: `${stockedCount ?? 0} tracked parts · ${txnCount ?? 0} ledger entries · counts and min/max per truck`, live: true },
    { href: (queued ?? 0) > 0 ? '/inventory/receive/queue' : '/inventory/receive', icon: PackagePlus, title: 'Receive', body: (queued ?? 0) > 0 ? `${queued} email${queued === 1 ? '' : 's'} with paperwork waiting in the queue` : 'Packing slips, vendor invoices, counter pickups · email queue', live: true },
    { href: '/inventory/transfers', icon: ArrowLeftRight, title: 'Transfers', body: 'Office → truck, truck → truck', live: true },
  ]

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="rp-title">
          Inventory
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Price book, truck and office stock, and every part that moves.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tiles.map(t => {
          const Icon = t.icon
          const inner = (
            <div className={`h-full rounded-2xl border p-5 shadow-sm ${t.live ? 'bg-card border-gray-200 hover:border-blue-300 hover:shadow' : 'bg-gray-50 border-dashed border-gray-300'}`}>
              <div className="flex items-start gap-3">
                <span className={`inline-flex w-10 h-10 items-center justify-center rounded-xl ${t.live ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400'}`}><Icon className="w-5 h-5" /></span>
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900">{t.title}</div>
                  <div className="text-sm text-gray-500 mt-0.5">{t.body}</div>
                </div>
              </div>
            </div>
          )
          return t.live ? <Link key={t.href} href={t.href} className="block">{inner}</Link> : <div key={t.href}>{inner}</div>
        })}
      </div>

      {(needPrice ?? 0) > 0 && (
        <div className="mt-6 rounded-xl border border-pink-200 bg-pink-50 px-4 py-3 text-sm text-pink-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <b>{needPrice}</b> catalog items are marked <i>price needed</i>, <i>verify</i> or <i>held high</i>.{' '}
            <Link href="/inventory/parts?status=attention" className="underline">Review them</Link> before they land on a quote.
          </div>
        </div>
      )}
    </div>
  )
}
