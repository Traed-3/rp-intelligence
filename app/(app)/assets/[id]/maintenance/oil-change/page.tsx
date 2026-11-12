import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { OilChangeForm } from './oil-change-form'
import { recordOilChange } from '../actions'

export default async function OilChangePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('company_id')
    .eq('id', user!.id)
    .single()

  const { data: asset } = await admin
    .from('assets')
    .select('id, unit_number, make, model, year, current_mileage, oil_change_interval_miles, last_oil_change_date, last_oil_change_mileage')
    .eq('id', id)
    .eq('company_id', profile!.company_id)
    .single()

  if (!asset) notFound()

  const action = recordOilChange.bind(null, id)
  const today = new Date().toISOString().split('T')[0]
  const vehicleLabel = [asset.year, asset.make, asset.model].filter(Boolean).join(' ')

  return (
    <div className="p-6 max-w-lg mx-auto">
      <div className="mb-6">
        <Link href={`/assets/${id}`} className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to {asset.unit_number}
        </Link>
        <h1 className="rp-title mt-2">Record Oil Change</h1>
        {vehicleLabel && <p className="text-gray-500 text-sm mt-0.5">{vehicleLabel}</p>}
      </div>

      {/* Last service callout */}
      {(asset.last_oil_change_date || asset.last_oil_change_mileage) && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-5 py-4 mb-6 text-sm">
          <p className="font-semibold text-amber-800 mb-1">Previous Oil Change</p>
          {asset.last_oil_change_date && (
            <p className="text-amber-700">
              Date:{' '}
              {new Date(asset.last_oil_change_date).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          )}
          {asset.last_oil_change_mileage && (
            <p className="text-amber-700">
              Mileage: {asset.last_oil_change_mileage.toLocaleString()} mi
            </p>
          )}
          {asset.oil_change_interval_miles && (
            <p className="text-amber-600 text-xs mt-1">
              Interval: every {asset.oil_change_interval_miles.toLocaleString()} miles
            </p>
          )}
        </div>
      )}

      <div className="rp-card p-6">
        <OilChangeForm
          action={action}
          today={today}
          currentMileage={asset.current_mileage}
        />
      </div>
    </div>
  )
}
