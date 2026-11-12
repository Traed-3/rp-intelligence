import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { StatusBadge } from '@/components/assets/status-badge'
import { Button } from '@/components/ui/button'
import { Pencil, Gauge, Wrench, Hammer } from 'lucide-react'
import { revalidatePath } from 'next/cache'
import { DeleteAssetButton } from './delete-button'
import { AssetPhotoSection } from '@/components/assets/asset-photo-section'
import { TicketStatusBadge } from '@/components/tickets/ticket-badges'

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === '') return null
  return (
    <div className="py-2.5 flex gap-4">
      <span className="w-44 shrink-0 text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  )
}

function DueDate({ label, date }: { label: string; date?: string | null }) {
  if (!date) return null
  const due = new Date(date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86400000)

  let statusClass = 'text-green-700 bg-green-50 border-green-200'
  let note = `${diffDays} days away`
  if (diffDays < 0) {
    statusClass = 'text-red-700 bg-red-50 border-red-200'
    note = `${Math.abs(diffDays)} days overdue`
  } else if (diffDays <= 7) {
    statusClass = 'text-red-600 bg-red-50 border-red-200'
    note = `Due in ${diffDays} days`
  } else if (diffDays <= 14) {
    statusClass = 'text-orange-600 bg-orange-50 border-orange-200'
    note = `Due in ${diffDays} days`
  } else if (diffDays <= 30) {
    statusClass = 'text-amber-600 bg-amber-50 border-amber-200'
    note = `Due in ${diffDays} days`
  }

  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm ${statusClass}`}>
      <span className="font-medium">{label}</span>
      <span>
        {due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        <span className="ml-2 text-xs opacity-75">({note})</span>
      </span>
    </div>
  )
}

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // In Next.js 16, params is a Promise
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('company_id, role')
    .eq('id', user!.id)
    .single()

  const [{ data: asset }, { data: mileageHistory }, { data: maintenanceHistory }, { data: assetPhotos }, { data: ticketHistory }] = await Promise.all([
    admin
      .from('assets')
      .select('*, asset_types(name), assigned:profiles!assets_assigned_profile_id_fkey(full_name)')
      .eq('id', id)
      .eq('company_id', profile!.company_id)
      .single(),
    admin
      .from('mileage_entries')
      .select('id, entry_date, mileage, notes, submitted_by, profiles(full_name)')
      .eq('asset_id', id)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(15),
    admin
      .from('maintenance_events')
      .select('id, performed_date, mileage_at_service, cost, notes, maintenance_types(name)')
      .eq('asset_id', id)
      .order('performed_date', { ascending: false })
      .limit(20),
    admin.from('asset_photos').select('id, photo_url, caption, is_primary').eq('asset_id', id).order('created_at'),
    admin
      .from('repair_tickets')
      .select('id, ticket_number, title, status, priority, date_completed, created_at')
      .eq('asset_id', id)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const { data: toolRows } = await admin
    .from('asset_tool_items')
    .select('total_cost, kind')
    .eq('asset_id', id)
  const toolTotal = (toolRows ?? []).reduce((sum, r) => sum + Number(r.total_cost), 0)

  async function saveAssetPhoto(photoUrl: string, caption: string) {
    'use server'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const admin = createAdminClient()
    await admin.from('asset_photos').insert({ asset_id: id, uploaded_by: user.id, photo_url: photoUrl, caption: caption || null })
    revalidatePath(`/assets/${id}`)
  }

  // Compute mileage deltas for history display
  const historyWithDelta = (mileageHistory ?? []).map((entry, i, arr) => {
    const prev = arr[i + 1]
    const delta = prev ? entry.mileage - prev.mileage : null
    return { ...entry, delta }
  })

  if (!asset) notFound()

  const canManage = ['owner', 'manager', 'shop_manager'].includes(profile?.role ?? '')
  const canDelete = ['owner', 'manager'].includes(profile?.role ?? '')

  const vehicleLabel = [asset.year, asset.make, asset.model].filter(Boolean).join(' ')

  // State inspections don't apply to hours-based assets or machines/equipment
  const typeName = (asset as any).asset_types?.name ?? ''
  const inspectionNA = !!(asset as any).uses_hours || ['Machine', 'Equipment'].includes(typeName)
  // Buildings / facilities are "property" — no mileage, service, or due dates.
  const isProperty = typeName === 'Building / Facility' || asset.status === 'property'

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Back link */}
      <Link href="/assets" className="text-sm text-gray-500 hover:text-gray-700">
        ← Back to Assets
      </Link>

      {/* Header */}
      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="rp-title">{asset.unit_number}</h1>
            <StatusBadge status={asset.status} />
          </div>
          {vehicleLabel && <p className="text-gray-500 mt-0.5">{vehicleLabel}</p>}
          {asset.name && <p className="text-sm text-gray-400">{asset.name}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          {!isProperty && (
          <Link href={`/assets/${id}/mileage`}>
            <Button variant="outline" className="gap-2">
              <Gauge className="w-4 h-4" />
              {(asset as any).uses_hours ? 'Add Hours' : 'Add Mileage'}
            </Button>
          </Link>
          )}
          {canManage && (
            <Link href={`/assets/${id}/edit`}>
              <Button variant="outline" className="gap-2">
                <Pencil className="w-4 h-4" />
                Edit
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Quick service actions — vehicles/equipment only */}
      {!isProperty && (
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/assets/${id}/maintenance/oil-change`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
        >
          <Wrench className="w-3.5 h-3.5" /> Oil Change
        </Link>
        <Link
          href={`/assets/${id}/maintenance/brakes`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
        >
          <Wrench className="w-3.5 h-3.5" /> Brake Service
        </Link>
        <Link
          href={`/assets/${id}/maintenance/tires`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
        >
          <Wrench className="w-3.5 h-3.5" /> Tire Service
        </Link>
        <Link
          href={`/assets/${id}/tools`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
        >
          <Hammer className="w-3.5 h-3.5" /> Tools &amp; Supplies
        </Link>
      </div>
      )}

      <div className="mt-6 space-y-5">
        {/* Asset Info */}
        <div className="rp-card p-5">
          <h2 className="font-semibold text-gray-900 mb-2">Asset Info</h2>
          <div className="divide-y divide-gray-50">
            <InfoRow label="Asset Type" value={(asset as any).asset_types?.name} />
            <InfoRow label="Unit Number" value={asset.unit_number} />
            <InfoRow label="Assigned To" value={(asset as any).assigned?.full_name} />
            <InfoRow label="Year" value={asset.year} />
            <InfoRow label="Make" value={asset.make} />
            <InfoRow label="Model" value={asset.model} />
            <InfoRow label="VIN / Serial Number" value={asset.vin} />
            <InfoRow label="License Plate" value={asset.license_plate} />
            {isProperty ? (
              <InfoRow label="Mileage" value="N/A" />
            ) : (asset as any).uses_hours ? (
              <InfoRow
                label="Current Hours"
                value={(asset as any).current_hours != null ? `${Number((asset as any).current_hours).toLocaleString()} hrs` : null}
              />
            ) : (
              <InfoRow
                label="Current Mileage"
                value={asset.current_mileage != null ? `${asset.current_mileage.toLocaleString()} mi` : null}
              />
            )}
          </div>
        </div>

        {/* Oil Change */}
        {!isProperty && (asset.last_oil_change_date || asset.oil_change_interval_miles) && (
          <div className="rp-card p-5">
            <h2 className="font-semibold text-gray-900 mb-2">Oil Change / Service</h2>
            <div className="divide-y divide-gray-50">
              <InfoRow label="Last Service Date" value={asset.last_oil_change_date} />
              <InfoRow
                label={(asset as any).uses_hours ? 'Last Service Hours' : 'Last Service Mileage'}
                value={asset.last_oil_change_mileage != null
                  ? `${asset.last_oil_change_mileage.toLocaleString()} ${(asset as any).uses_hours ? 'hrs' : 'mi'}`
                  : null}
              />
              <InfoRow
                label={(asset as any).uses_hours ? 'Next Service Hours' : 'Next Service Mileage'}
                value={asset.next_oil_change_mileage != null
                  ? `${asset.next_oil_change_mileage.toLocaleString()} ${(asset as any).uses_hours ? 'hrs' : 'mi'}`
                  : null}
              />
              <InfoRow
                label={(asset as any).uses_hours ? 'Interval (hours)' : 'Interval (miles)'}
                value={asset.oil_change_interval_miles
                  ? `every ${asset.oil_change_interval_miles.toLocaleString()} ${(asset as any).uses_hours ? 'hrs' : 'mi'}`
                  : null}
              />
              <InfoRow label="Interval (months)" value={asset.oil_change_interval_months ? `every ${asset.oil_change_interval_months} months` : null} />
            </div>
          </div>
        )}

        {/* Due Dates */}
        {(isProperty || inspectionNA || asset.inspection_due_date || asset.registration_due_date) && (
          <div className="rp-card p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Due Dates</h2>
            <div className="space-y-2">
              {isProperty ? (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-500">
                  <span className="font-medium">Inspection / Registration</span>
                  <span>N/A — property asset</span>
                </div>
              ) : inspectionNA ? (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-500">
                  <span className="font-medium">State Inspection</span>
                  <span>N/A — {(asset as any).uses_hours ? 'hours-based' : typeName.toLowerCase()}</span>
                </div>
              ) : (
                <DueDate label="State Inspection" date={asset.inspection_due_date} />
              )}
              <DueDate label="Registration / Tag" date={asset.registration_due_date} />
            </div>
          </div>
        )}

        {/* Notes */}
        {asset.notes && (
          <div className="rp-card p-5">
            <h2 className="font-semibold text-gray-900 mb-2">Notes</h2>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{asset.notes}</p>
          </div>
        )}

        {/* Maintenance History — vehicles/equipment only */}
        {!isProperty && (
        <div className="rp-card p-5">
          <h2 className="font-semibold text-gray-900 mb-3">Maintenance History</h2>
          {!maintenanceHistory?.length ? (
            <p className="text-sm text-gray-400 text-center py-4">
              No maintenance records yet. Use the buttons above to record a service.
            </p>
          ) : (
            <div className="space-y-2">
              {maintenanceHistory.map((event) => (
                <div
                  key={event.id}
                  className="flex items-start justify-between py-2 border-b border-gray-50 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {(event as any).maintenance_types?.name ?? 'Service'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {new Date(event.performed_date).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                      {event.mileage_at_service != null && (
                        <> &mdash; {event.mileage_at_service.toLocaleString()} mi</>
                      )}
                    </p>
                    {event.notes && (
                      <p className="text-xs text-gray-400 mt-0.5 italic">{event.notes}</p>
                    )}
                  </div>
                  {event.cost != null && (
                    <span className="text-sm font-medium text-gray-700 shrink-0 ml-4">
                      ${Number(event.cost).toFixed(2)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* Tools & Supplies bought for this asset */}
        {!isProperty && (toolRows?.length ?? 0) > 0 && (
          <Link
            href={`/assets/${id}/tools`}
            className="rp-card rp-card-link block p-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Tools &amp; Supplies</h2>
              <span className="text-sm font-medium text-gray-700">
                ${toolTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span className="ml-2 text-xs text-gray-400">{toolRows!.length} purchase{toolRows!.length === 1 ? '' : 's'} →</span>
              </span>
            </div>
          </Link>
        )}

        {/* Repair Ticket History — every ticket (incl. closed email tickets) */}
        <div className="rp-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Repair Ticket History</h2>
            <span className="text-xs text-gray-400">{ticketHistory?.length ?? 0} total</span>
          </div>
          {!ticketHistory?.length ? (
            <p className="text-sm text-gray-400 text-center py-4">No tickets for this asset yet.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {ticketHistory.map((t) => {
                const done = t.status === 'closed' || t.status === 'completed'
                const dateStr = done && t.date_completed ? t.date_completed : t.created_at
                return (
                  <Link
                    key={t.id}
                    href={`/tickets/${t.id}`}
                    className="flex items-start justify-between gap-3 py-2.5 hover:bg-gray-50 -mx-2 px-2 rounded-lg transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        <span className="font-mono">{t.ticket_number}</span>
                        {' · '}
                        {done ? 'Completed ' : 'Opened '}
                        {new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                    <TicketStatusBadge status={t.status} />
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Mileage History — vehicles/equipment only */}
        {!isProperty && (
        <div className="rp-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">
              {(asset as any).uses_hours ? 'Hours History' : 'Mileage History'}
            </h2>
            <Link
              href={`/assets/${id}/mileage`}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              + Add Entry
            </Link>
          </div>
          {historyWithDelta.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              No {(asset as any).uses_hours ? 'hours' : 'mileage'} entries yet.{' '}
              <Link href={`/assets/${id}/mileage`} className="text-blue-600 hover:underline">
                Add the first one.
              </Link>
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="rp-table w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 pr-4">Date</th>
                    <th className="text-right py-2 pr-4">
                      {(asset as any).uses_hours ? 'Hours' : 'Mileage'}
                    </th>
                    <th className="text-right py-2 pr-4">+/−</th>
                    <th className="text-left py-2">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {historyWithDelta.map((entry) => (
                    <tr key={entry.id}>
                      <td className="py-2 pr-4 text-gray-600 whitespace-nowrap">
                        {new Date(entry.entry_date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="py-2 pr-4 text-right font-semibold text-gray-900 whitespace-nowrap">
                        {entry.mileage.toLocaleString()} {(asset as any).uses_hours ? 'hrs' : 'mi'}
                      </td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">
                        {entry.delta != null ? (
                          <span className={entry.delta >= 0 ? 'text-green-600' : 'text-red-500'}>
                            {entry.delta >= 0 ? '+' : ''}
                            {entry.delta.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="py-2 text-gray-500 text-xs">{entry.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}

        {/* Asset Photos */}
        <AssetPhotoSection assetId={id} initialPhotos={assetPhotos ?? []} onSave={saveAssetPhoto} />

        {/* Danger zone */}
        {canDelete && (
          <div className="bg-card rounded-xl border border-red-100 p-5">
            <h2 className="font-semibold text-red-700 mb-1">Danger Zone</h2>
            <p className="text-sm text-gray-500 mb-3">
              Permanently delete this asset and all its records. This cannot be undone.
            </p>
            <DeleteAssetButton id={id} unitNumber={asset.unit_number} />
          </div>
        )}
      </div>
    </div>
  )
}
