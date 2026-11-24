import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  DEFAULT_REPEAT_WINDOW_MONTHS,
  TOOL_STATUSES,
  TOOL_STATUS_LABEL,
  findRepeats,
  type ToolType,
} from '@/lib/asset-tools'
import { addToolItem, setToolStatus, deleteToolItem } from './actions'
import { ToolForm } from './tool-form'
import { DeleteToolButton } from './delete-tool-button'

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default async function AssetToolsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('company_id, role')
    .eq('id', user!.id)
    .single()

  const { data: asset } = await admin
    .from('assets')
    .select('id, unit_number, name, make, model, year')
    .eq('id', id)
    .eq('company_id', profile!.company_id)
    .single()
  if (!asset) notFound()

  const [{ data: itemsRaw }, { data: typesRaw }] = await Promise.all([
    admin
      .from('asset_tool_items')
      .select('id, type_id, item_name, kind, mileage, quantity, total_cost, purchased_on, vendor, receipt_url, status, notes')
      .eq('asset_id', id)
      .order('purchased_on', { ascending: false })
      .order('created_at', { ascending: false }),
    admin
      .from('asset_tool_types')
      .select('id, name, kind, repeat_window_months')
      .eq('company_id', profile!.company_id)
      .eq('is_active', true)
      .order('name'),
  ])

  const types: ToolType[] = (typesRaw ?? []) as ToolType[]
  const typeById = new Map(types.map((t) => [t.id, t]))
  const items = (itemsRaw ?? []).map((i) => ({
    ...i,
    quantity: Number(i.quantity),
    total_cost: Number(i.total_cost),
  }))

  // Which rows are repeats of another row for this truck inside the item type's watch window?
  const repeatIds = new Set<string>()
  for (const it of items) {
    const windowMonths = (it.type_id && typeById.get(it.type_id)?.repeat_window_months) ?? DEFAULT_REPEAT_WINDOW_MONTHS
    if (windowMonths > 0 && findRepeats(items, it, windowMonths).length > 0) repeatIds.add(it.id)
  }

  const yearAgo = new Date()
  yearAgo.setFullYear(yearAgo.getFullYear() - 1)
  const yearAgoStr = yearAgo.toISOString().split('T')[0]
  const total = items.reduce((s, i) => s + i.total_cost, 0)
  const last12 = items.filter((i) => i.purchased_on >= yearAgoStr).reduce((s, i) => s + i.total_cost, 0)
  const sumKind = (k: string) => items.filter((i) => i.kind === k).reduce((s, i) => s + i.total_cost, 0)
  const toolTotal = sumKind('tool')
  const supplyTotal = sumKind('supply')
  const fluidTotal = sumKind('fluid')
  const onTruck = items.filter((i) => i.status === 'on_truck' && i.kind === 'tool').length

  // Fluid cost per mile: every fill-up after the first one pays for the miles driven since it.
  const fluidFills = items
    .filter((i) => i.kind === 'fluid' && i.mileage != null)
    .sort((a, b) => (a.mileage as number) - (b.mileage as number))
  const fluidMiles = fluidFills.length >= 2 ? (fluidFills[fluidFills.length - 1].mileage as number) - (fluidFills[0].mileage as number) : 0
  const fluidPerMile = fluidMiles > 0 ? fluidFills.slice(1).reduce((s, i) => s + i.total_cost, 0) / fluidMiles : null

  const canWrite = profile!.role !== 'viewer'
  const canDelete = ['owner', 'manager'].includes(profile!.role)
  const today = new Date().toISOString().split('T')[0]
  const vehicleLabel = [asset.year, asset.make, asset.model].filter(Boolean).join(' ')

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link href={`/assets/${id}`} className="text-sm text-gray-500 hover:text-gray-700">
        ← Back to {asset.unit_number}
      </Link>
      <h1 className="rp-title mt-2">Tools &amp; Supplies — {asset.unit_number}</h1>
      {vehicleLabel && <p className="text-gray-500 text-sm mt-0.5">{vehicleLabel}</p>}

      <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          ['Total spent', money(total)],
          ['Last 12 months', money(last12)],
          ['Tools / Supplies / Fluids', `${money(toolTotal)} / ${money(supplyTotal)} / ${money(fluidTotal)}`],
          ['Tools on truck', String(onTruck)],
          ['Fluid cost per mile', fluidPerMile != null ? `$${fluidPerMile.toFixed(4)}` : 'needs 2+ fill-ups with mileage'],
        ].map(([label, value]) => (
          <div key={label} className="rp-card px-4 py-3">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-lg font-semibold text-gray-900 mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {repeatIds.size > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          🔁 {repeatIds.size} line{repeatIds.size === 1 ? '' : 's'} below {repeatIds.size === 1 ? 'was' : 'were'} bought more
          than once for this truck inside the watch window — look into why.
        </div>
      )}

      <div className="rp-card mt-5 p-5">
        <h2 className="font-semibold text-gray-900 mb-3">Purchases</h2>
        {items.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Nothing logged for this truck yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="rp-table w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 pr-3 text-right">Cost</th>
                  <th className="py-2 pr-3">Vendor</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Receipt</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-gray-50 last:border-0 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap text-gray-600">{fmtDate(it.purchased_on)}</td>
                    <td className="py-2 pr-3">
                      <span className="font-medium text-gray-900">{it.item_name}</span>
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">{it.kind}</span>
                      {repeatIds.has(it.id) && (
                        <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                          🔁 repeat
                        </span>
                      )}
                      {it.mileage != null && <p className="text-xs text-gray-400 mt-0.5">at {it.mileage.toLocaleString()} mi</p>}
                      {it.notes && <p className="text-xs text-gray-400 italic mt-0.5">{it.notes}</p>}
                    </td>
                    <td className="py-2 pr-3 text-right text-gray-600">{it.quantity}</td>
                    <td className="py-2 pr-3 text-right font-medium text-gray-900">{money(it.total_cost)}</td>
                    <td className="py-2 pr-3 text-gray-600">{it.vendor ?? '—'}</td>
                    <td className="py-2 pr-3">
                      {canWrite ? (
                        <form action={setToolStatus.bind(null, it.id, id)} className="flex items-center gap-1">
                          <select
                            name="status"
                            defaultValue={it.status}
                            className="rounded border border-gray-300 px-1.5 py-1 text-xs"
                          >
                            {TOOL_STATUSES.map((s) => (
                              <option key={s} value={s}>{TOOL_STATUS_LABEL[s]}</option>
                            ))}
                          </select>
                          <button type="submit" className="text-xs text-blue-600 hover:underline">Save</button>
                        </form>
                      ) : (
                        TOOL_STATUS_LABEL[it.status as keyof typeof TOOL_STATUS_LABEL]
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {it.receipt_url ? (
                        <a href={it.receipt_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                          View
                        </a>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-2">
                      {canDelete && <DeleteToolButton action={deleteToolItem.bind(null, it.id, id)} label={it.item_name} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canWrite && (
        <div className="rp-card mt-5 p-5">
          <h2 className="font-semibold text-gray-900 mb-3">Add a tool or supply</h2>
          <ToolForm action={addToolItem.bind(null, id)} types={types} today={today} />
        </div>
      )}
    </div>
  )
}
