import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { StatusBadge } from '@/components/assets/status-badge'
import { ClickableRow } from '@/components/clickable-row'
import { Button } from '@/components/ui/button'
import { Plus, Search } from 'lucide-react'

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'available', label: 'Available' },
  { value: 'in_shop', label: 'In Shop' },
  { value: 'down', label: 'Down' },
  { value: 'unsafe', label: 'Unsafe' },
  { value: 'retired', label: 'Retired' },
  { value: 'property', label: 'Property' },
]

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  // In Next.js 16, searchParams is a Promise
  const { q = '', status = '' } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('company_id, role')
    .eq('id', user!.id)
    .single()

  let query = admin
    .from('assets')
    .select('id, unit_number, name, status, year, make, model, current_mileage, asset_type_id, asset_types(name)')
    .eq('company_id', profile!.company_id)
    .order('unit_number')

  if (status) query = query.eq('status', status)
  if (q) {
    query = query.or(
      `unit_number.ilike.%${q}%,name.ilike.%${q}%,make.ilike.%${q}%,model.ilike.%${q}%`
    )
  }

  const { data: assets } = await query
  const canManage = ['owner', 'manager', 'shop_manager'].includes(profile?.role ?? '')

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="rp-title">Assets</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {assets?.length ?? 0} asset{assets?.length !== 1 ? 's' : ''}
            {status || q ? ' (filtered)' : ''}
          </p>
        </div>
        {canManage && (
          <Link href="/assets/new">
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Add Asset
            </Button>
          </Link>
        )}
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <form method="GET" className="flex gap-2 flex-1">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search unit #, make, model…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {status && <input type="hidden" name="status" value={status} />}
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Search
          </button>
        </form>

        {/* Status filter pills */}
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={`/assets?status=${f.value}${q ? `&q=${q}` : ''}`}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                status === f.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Asset table */}
      {!assets?.length ? (
        <div className="rp-card p-12 text-center">
          <p className="text-gray-400 text-sm">
            {q || status ? 'No assets match your filters.' : 'No assets yet. Add your first one!'}
          </p>
          {canManage && !q && !status && (
            <Link href="/assets/new" className="mt-4 inline-block">
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Add Asset
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="rp-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="rp-table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3">Unit #</th>
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-left px-4 py-3">Name / Vehicle</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Mileage</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {assets.map((asset) => {
                  const t = asset.asset_types as { name?: string } | { name?: string }[] | null
                  const typeName = Array.isArray(t) ? t[0]?.name : t?.name
                  const isProperty = typeName === 'Building / Facility' || asset.status === 'property'
                  const details = [asset.year, asset.make, asset.model].filter(Boolean).join(' ')
                  return (
                  <ClickableRow key={asset.id} href={`/assets/${asset.id}`}>
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      {asset.unit_number}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {typeName ? (
                        <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                          {typeName}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {asset.name && (
                        <span className="font-medium text-gray-800">{asset.name}{details ? ' — ' : ''}</span>
                      )}
                      {details}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={asset.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {isProperty
                        ? 'N/A'
                        : asset.current_mileage != null
                          ? asset.current_mileage.toLocaleString() + ' mi'
                          : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-blue-600 font-medium text-xs">View →</span>
                    </td>
                  </ClickableRow>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
