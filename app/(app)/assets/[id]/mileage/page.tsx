import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { MileageForm } from './mileage-form'
import { addMileageEntry } from './actions'

export default async function MileagePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('company_id')
    .eq('id', user!.id)
    .single()

  const { data: asset } = await admin
    .from('assets')
    .select('id, unit_number, name, make, model, year, current_mileage, current_hours, uses_hours, next_oil_change_mileage')
    .eq('id', id)
    .eq('company_id', profile!.company_id)
    .single()

  if (!asset) notFound()

  // Bind the asset id into the server action
  const action = addMileageEntry.bind(null, id)
  const today = new Date().toISOString().split('T')[0]
  const vehicleLabel = [asset.year, asset.make, asset.model].filter(Boolean).join(' ')

  return (
    <div className="p-6 max-w-lg mx-auto">
      <div className="mb-6">
        <Link href={`/assets/${id}`} className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to {asset.unit_number}
        </Link>
        <h1 className="rp-title mt-2">
          {(asset as any).uses_hours ? 'Add Hours' : 'Add Mileage'}
        </h1>
        {vehicleLabel && <p className="text-gray-500 text-sm mt-0.5">{vehicleLabel}</p>}
      </div>

      {/* Current mileage / hours callout */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-4 mb-6">
        <p className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-0.5">
          {(asset as any).uses_hours ? 'Current Recorded Hours' : 'Current Recorded Mileage'}
        </p>
        <p className="text-3xl font-bold text-blue-900">
          {(asset as any).uses_hours
            ? ((asset as any).current_hours != null ? Number((asset as any).current_hours).toLocaleString() + ' hrs' : '—')
            : (asset.current_mileage != null ? asset.current_mileage.toLocaleString() + ' mi' : '—')}
        </p>
        {!(asset as any).uses_hours && asset.next_oil_change_mileage != null && (
          <p className="text-xs text-blue-600 mt-1">
            Next oil change due at {asset.next_oil_change_mileage.toLocaleString()} mi
          </p>
        )}
      </div>

      <div className="rp-card p-6">
        <MileageForm action={action} today={today} usesHours={(asset as any).uses_hours} />
      </div>
    </div>
  )
}
