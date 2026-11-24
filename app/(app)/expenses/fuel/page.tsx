import { PageHeader } from '@/components/ui/page-header'
import { SectionCard } from '@/components/ui/section-card'
import { money, shortDate } from '@/lib/receipt-report'
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
    <div className="rp-page max-w-2xl">
      <PageHeader
        crumbs={[{ label: 'Expenses', href: '/expenses' }, { label: 'Fuel' }]}
        title="Fuel Receipt"
        description="Log a fill-up. The mileage you enter updates the truck's record."
      />

      <div className="rp-card p-5 sm:p-6 mb-6">
        <FuelForm action={createFuelEntry} assets={assets ?? []} paymentMethods={paymentMethods ?? []} today={today} />
      </div>

      {recentFuel && recentFuel.length > 0 && (
        <SectionCard title="Recent fill-ups" flush>
          {recentFuel.map(f => {
            const unit = (f.assets as unknown as { unit_number: string | null } | null)?.unit_number
            return (
              <div key={f.id} className="px-5 py-3 flex items-center justify-between text-sm border-b border-hairline last:border-0">
                <div>
                  <p className="font-medium text-foreground">{unit ?? 'No unit #'}</p>
                  <p className="text-xs text-muted-foreground">
                    {shortDate(String(f.entry_date).slice(0, 10))} · {f.mileage.toLocaleString()} mi · {f.gallons} gal
                    {f.oil_level && (
                      <span className={`ml-2 font-semibold ${f.oil_level <= 3 ? 'text-danger' : f.oil_level <= 5 ? 'text-warning' : 'text-success'}`}>
                        Oil {f.oil_level}/9
                      </span>
                    )}
                  </p>
                </div>
                {f.total_cost && <span className="font-semibold text-foreground tabular-nums">{money(Number(f.total_cost))}</span>}
              </div>
            )
          })}
        </SectionCard>
      )}
    </div>
  )
}
