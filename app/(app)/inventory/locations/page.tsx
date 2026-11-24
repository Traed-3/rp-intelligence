import Link from 'next/link'
import { Plus, Warehouse, Truck } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInventory } from '@/lib/inventory-guard'
import { LocationForm } from '@/components/inventory/location-form'
import { LocationActiveToggle } from '@/components/inventory/location-active-toggle'
import { saveLocation } from '../actions'
import { LOCATION_KINDS } from '@/lib/inventory'

const th = 'text-left px-4 py-3 font-medium text-gray-500'

export default async function LocationsPage() {
  const { company_id, canWrite } = await requireInventory()
  const admin = createAdminClient()

  const [{ data: locations }, { data: assets }, { data: techs }, { data: onHand }] = await Promise.all([
    admin.from('stock_locations').select('*, assets(unit_number, name, status), svc_technicians(full_name)').eq('company_id', company_id).order('kind').order('name'),
    admin.from('assets').select('id, unit_number, name').eq('company_id', company_id).eq('is_active', true).order('unit_number'),
    admin.from('svc_technicians').select('id, full_name').eq('company_id', company_id).eq('is_active', true).order('full_name'),
    admin.from('stock_on_hand').select('location_id, on_hand').eq('company_id', company_id),
  ])
  const list = locations ?? []
  const lineCount = new Map<string, number>()
  for (const r of onHand ?? []) lineCount.set(r.location_id, (lineCount.get(r.location_id) ?? 0) + (Number(r.on_hand) > 0 ? 1 : 0))
  const kindLabel = (k: string) => LOCATION_KINDS.find(x => x.value === k)?.label ?? k
  const groups = ['office', 'truck', 'jobsite', 'vendor_rma', 'customer_owned'].map(k => ({ kind: k, rows: list.filter(l => l.kind === k) })).filter(g => g.rows.length)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="rp-title">
            Stock locations
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{list.length} location{list.length !== 1 ? 's' : ''} · a truck is a place parts live, tied to its asset number</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/inventory/parts" className="text-sm text-gray-500 hover:text-gray-700">Parts</Link>
          <Link href="/inventory" className="text-sm text-gray-500 hover:text-gray-700">← Inventory</Link>
        </div>
      </div>

      {groups.map(g => (
        <div key={g.kind} className="rp-card overflow-hidden mb-5">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2 font-semibold text-gray-900">
            {g.kind === 'truck' ? <Truck className="w-4 h-4 text-blue-600" /> : <Warehouse className="w-4 h-4 text-blue-600" />}
            {kindLabel(g.kind)}s <span className="text-sm font-normal text-gray-400">({g.rows.length})</span>
          </div>
          <div className="overflow-x-auto">
            <table className="rp-table w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className={th}>Location</th>
                  <th className={`${th} hidden sm:table-cell`}>Asset</th>
                  <th className={`${th} hidden md:table-cell`}>Technician</th>
                  <th className={th}>Dept</th>
                  <th className={`${th} text-right`}>Parts stocked</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {g.rows.map(l => (
                  <tr key={l.id}>
                    <td className="px-4 py-3 font-medium text-gray-900">{l.name}</td>
                    <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{l.assets ? `${l.assets.unit_number}${l.assets.name ? ` · ${l.assets.name}` : ''}` : '—'}</td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{l.svc_technicians?.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600 capitalize">{l.department ?? 'shared'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">{lineCount.get(l.id) ?? 0}</td>
                    <td className="px-4 py-3">{canWrite ? <LocationActiveToggle id={l.id} active={!!l.active} /> : (l.active ? 'Active' : 'Inactive')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {canWrite && (
        <details className="rp-card">
          <summary className="px-5 py-4 cursor-pointer font-semibold text-gray-900 flex items-center gap-2"><Plus className="w-4 h-4 text-blue-600" />Add location</summary>
          <div className="px-5 pb-5"><LocationForm action={saveLocation.bind(null, null)} assets={assets ?? []} techs={techs ?? []} /></div>
        </details>
      )}
    </div>
  )
}
