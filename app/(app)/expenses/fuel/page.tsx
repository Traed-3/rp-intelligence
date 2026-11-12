import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { FuelForm } from './fuel-form'
import { createFuelEntry } from '../actions'

export default async function FuelPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id').eq('id', user!.id).single()

  const [{ data: assets }, { data: paymentMethods }, { data: recentFuel }] = await Promise.all([
    admin.from('assets').select('id, unit_number, name, make, model, current_mileage')
      .eq('company_id', profile!.company_id).in('status', ['active', 'available']).order('unit_number'),
    admin.from('payment_methods').select('id, code, name')
      .eq('company_id', profile!.company_id).eq('is_active', true).order('code'),
    admin.from('fuel_entries')
      .select('id, entry_date, mileage, gallons, total_cost, oil_level, assets(unit_number)')
      .eq('company_id', profile!.company_id)
      .order('entry_date', { ascending: false })
      .limit(10),
  ])

  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href="/expenses" className="text-sm text-gray-500 hover:text-gray-700">← Expenses</Link>
        <h1 className="rp-title mt-2">Fuel Receipt</h1>
        <p className="text-sm text-gray-500 mt-0.5">Log a fill-up. Mileage auto-updates the asset record.</p>
      </div>

      <div className="rp-card p-6 mb-6">
        <FuelForm action={createFuelEntry} assets={assets ?? []} paymentMethods={paymentMethods ?? []} today={today} />
      </div>

      {/* Recent fuel entries */}
      {recentFuel && recentFuel.length > 0 && (
        <div className="rp-card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
            <h2 className="font-semibold text-sm text-gray-900">Recent Fill-Ups</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {recentFuel.map(f => (
              <div key={f.id} className="px-5 py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-gray-900">{(f as any).assets?.unit_number ?? '—'}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(f.entry_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ·{' '}
                    {f.mileage.toLocaleString()} mi · {f.gallons} gal
                    {f.oil_level && (
                      <span className={`ml-2 font-semibold ${f.oil_level <= 3 ? 'text-red-600' : f.oil_level <= 5 ? 'text-amber-600' : 'text-green-600'}`}>
                        Oil: {f.oil_level}/9
                      </span>
                    )}
                  </p>
                </div>
                {f.total_cost && (
                  <span className="font-semibold text-gray-900">${Number(f.total_cost).toFixed(2)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
