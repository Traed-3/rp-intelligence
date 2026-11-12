import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { MileageForm } from '@/app/(app)/assets/[id]/mileage/mileage-form'
import { addMileageEntry } from '@/app/(app)/assets/[id]/mileage/actions'

export default async function MobileMileagePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id').eq('id', user!.id).single()

  const { data: assets } = await admin
    .from('assets')
    .select('id, unit_number, name, make, model, year, current_mileage')
    .eq('company_id', profile!.company_id)
    .in('status', ['active', 'available'])
    .order('unit_number')

  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-sm mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="rp-title">Log Mileage</h1>
          <Link href="/mobile" className="text-sm text-blue-600">← Home</Link>
        </div>

        {/* Asset picker */}
        <div className="rp-card p-5">
          <p className="text-sm font-medium text-gray-700 mb-3">Select a vehicle:</p>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {(assets ?? []).map(a => (
              <Link
                key={a.id}
                href={`/assets/${a.id}/mileage`}
                className="flex items-center justify-between w-full px-4 py-3 rounded-2xl border border-gray-200 shadow-sm hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <div>
                  <p className="font-semibold text-gray-900">{a.unit_number}</p>
                  <p className="text-xs text-gray-500">
                    {[a.year, a.make, a.model].filter(Boolean).join(' ') || a.name || '—'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">Current</p>
                  <p className="text-sm font-medium text-gray-700">
                    {a.current_mileage != null ? a.current_mileage.toLocaleString() + ' mi' : '—'}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
