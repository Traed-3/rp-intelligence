import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { SiteLookup, type LookupSite } from '@/components/construction/site-lookup'

/**
 * Site Lookup — one box to find any site by number, street, city or brand.
 * Pulls every site the app knows about into one list: con_sites (the site
 * records, with addresses), con_permit_sites (store phone) and every site
 * number that has ever had a job, so a number with no site record still shows.
 */
export default async function SiteLookupPage() {
  const { company_id } = await requireConstruction()
  const admin = createAdminClient()

  const [{ data: sites }, { data: permitSites }, { data: customers }] = await Promise.all([
    admin.from('con_sites').select('id, customer_id, site_number, store_brand, address, city, state, zip').eq('company_id', company_id).order('site_number').range(0, 999),
    admin.from('con_permit_sites').select('site_number, brand, address, city, state, zip, store_phone').eq('company_id', company_id).range(0, 999),
    admin.from('con_customers').select('id, name').eq('company_id', company_id),
  ])

  // con_jobs is past Supabase's 1000-rows-per-request cap — read it a page at a time.
  type JobRow = { site_number: string | null; stage: string | null; gas_brand: string | null; date_received: string | null }
  const jobs: JobRow[] = []
  for (let from = 0; from < 20000; from += 1000) {
    const { data } = await admin.from('con_jobs').select('site_number, stage, gas_brand, date_received')
      .eq('company_id', company_id).not('site_number', 'is', null).order('id').range(from, from + 999)
    if (!data?.length) break
    jobs.push(...(data as JobRow[]))
    if (data.length < 1000) break
  }

  const custName = new Map((customers ?? []).map(c => [c.id, c.name as string]))
  const key = (s: string) => s.trim().toUpperCase()
  const byKey = new Map<string, LookupSite>()

  for (const s of sites ?? []) {
    if (!s.site_number) continue
    const k = key(s.site_number)
    const prev = byKey.get(k)
    // the same number can be on file twice — keep the one that has an address
    if (prev && (prev.address || !s.address)) continue
    byKey.set(k, {
      site_number: s.site_number.trim(), brand: s.store_brand, address: s.address, city: s.city, state: s.state, zip: s.zip,
      phone: null, customer: s.customer_id ? custName.get(s.customer_id) ?? null : null,
      edit_href: s.customer_id ? `/construction/customers/${s.customer_id}/sites/${s.id}` : null,
      jobs: 0, open_jobs: 0, last_job: null,
    })
  }
  const blank = (site_number: string): LookupSite => ({
    site_number, brand: null, address: null, city: null, state: null, zip: null, phone: null, customer: null, edit_href: null, jobs: 0, open_jobs: 0, last_job: null,
  })
  for (const p of permitSites ?? []) {
    if (!p.site_number) continue
    const k = key(p.site_number)
    const row = byKey.get(k) ?? blank(p.site_number.trim())
    row.brand ??= p.brand; row.address ??= p.address; row.city ??= p.city; row.state ??= p.state; row.zip ??= p.zip
    row.phone = p.store_phone ?? row.phone
    byKey.set(k, row)
  }
  for (const j of jobs) {
    const sn = (j.site_number ?? '').trim()
    if (!sn) continue
    const k = key(sn)
    const row = byKey.get(k) ?? blank(sn)
    row.brand ??= j.gas_brand
    row.jobs += 1
    if (j.stage !== 'complete') row.open_jobs += 1
    if (j.date_received && (!row.last_job || j.date_received > row.last_job)) row.last_job = j.date_received
    byKey.set(k, row)
  }

  const rows = [...byKey.values()].sort((a, b) => a.site_number.localeCompare(b.site_number, undefined, { numeric: true }))

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">
            Site Lookup
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{rows.length} sites · type a site number, street, city or brand</p>
        </div>
        <Link href="/construction" className="text-sm text-gray-500 hover:text-gray-700">← Construction</Link>
      </div>
      <SiteLookup sites={rows} />
    </div>
  )
}
