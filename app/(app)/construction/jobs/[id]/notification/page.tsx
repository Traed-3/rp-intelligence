import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { fmtDate, projectNotificationStatus } from '@/lib/construction'
import { PrintButton } from '@/components/construction/print-button'

const norm = (s: string | null | undefined) =>
  (s ?? '').toUpperCase().split('(')[0].split('/')[0].replace(/[^A-Z0-9]/g, '')

// Common fuel-site work types; checked when the job text mentions them.
const WORK_TYPES: { label: string; kw: RegExp }[] = [
  { label: 'Dispenser replacement', kw: /disp/i },
  { label: 'Canopy work', kw: /canopy/i },
  { label: 'Tank work', kw: /tank/i },
  { label: 'Line replacement / testing', kw: /\bline\b|secondary|piping/i },
  { label: 'Sump work', kw: /sump/i },
  { label: 'Spill / overspill bucket work', kw: /spill|bucket|overspill/i },
  { label: 'EMV', kw: /emv/i },
  { label: 'Sign work', kw: /\bsign\b/i },
  { label: 'Concrete / islands / curbs', kw: /concrete|island|curb|bollard/i },
  { label: 'Fuel removal', kw: /fuel removal|purge|remove fuel/i },
]

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="border-b border-gray-300 pb-1">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-sm text-gray-900 min-h-5">{value || ' '}</p>
    </div>
  )
}

export default async function NotificationFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { company_id } = await requireConstruction()
  const admin = createAdminClient()

  const { data: job } = await admin
    .from('con_jobs').select('*, con_customers(name)')
    .eq('id', id).eq('company_id', company_id).single()
  if (!job) notFound()

  // Match the job's site to a con_sites record for equipment details.
  const { data: sites } = await admin
    .from('con_sites').select('*').eq('company_id', company_id)
  const site = (sites ?? []).find(s => norm(s.site_number) === norm(job.site_number)) ?? null

  const status = projectNotificationStatus(job)
  const blob = `${job.scope_of_work ?? ''} ${job.program ?? ''} ${job.status_detail ?? ''}`
  const customerName = (job as any).con_customers?.name ?? null

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Controls (hidden when printing) */}
      <div className="no-print flex items-center justify-between mb-4">
        <Link href={`/construction/jobs/${id}`} className="text-sm text-gray-500 hover:text-gray-700">← Back to job</Link>
        <PrintButton />
      </div>

      <div className="rp-card p-8 print:border-0 print:shadow-none">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="rp-title">Project Notification</h1>
            <p className="text-sm text-gray-500">RPS — Rappahannock Petroleum</p>
          </div>
          <div className="text-right text-xs text-gray-500">
            <p>Send window: <span className="font-medium text-gray-700">{fmtDate(status.windowOpen)}</span></p>
            <p>Must be sent by: <span className="font-semibold text-gray-900">{fmtDate(status.deadline)}</span></p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
          <Field label="Site #" value={job.site_number} />
          <Field label="Store Brand" value={site?.store_brand ?? job.gas_brand} />
          <Field label="Customer" value={customerName} />
          <Field label="Project Start Date" value={fmtDate(job.project_start_date)} />
          <Field label="Work Order #" value={job.work_order_number} />
          <Field label="Response Time" value={job.response_time} />
          <div className="col-span-2 sm:col-span-3">
            <Field label="Facility Address" value={site ? [site.address, site.city, site.state, site.zip].filter(Boolean).join(', ') : job.facility_address} />
          </div>
        </div>

        {/* Scope */}
        <div className="mb-6">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Scope of Work</p>
          <p className="text-sm text-gray-900 whitespace-pre-line border border-gray-200 rounded-lg p-3 min-h-12">{job.scope_of_work || ' '}</p>
        </div>

        {/* Work types */}
        <div className="mb-6">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Work Type</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            {WORK_TYPES.map(w => {
              const checked = w.kw.test(blob)
              return (
                <div key={w.label} className="flex items-center gap-2 text-sm">
                  <span className={`inline-flex items-center justify-center w-4 h-4 border border-gray-400 rounded-sm text-[11px] ${checked ? 'bg-foreground text-background border-foreground' : 'text-transparent'}`}>✓</span>
                  <span className={checked ? 'text-gray-900 font-medium' : 'text-gray-600'}>{w.label}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Equipment */}
        <div className="mb-6">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Site Equipment{site ? '' : ' (no site record matched — fill in manually)'}</p>
          <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
            <tbody className="divide-y divide-gray-100">
              <EquipRow label="Dispensers" qty={site?.dispenser_count} type={site?.dispenser_type} />
              <EquipRow label="Tanks" qty={site?.tank_count} type={site?.tank_type} />
              <EquipRow label="STPs" qty={site?.stp_count} type={site?.stp_type} />
              <EquipRow label="Fill Spill Buckets" qty={site?.fill_spill_bucket_count} type={site?.fill_spill_bucket_type} />
              <EquipRow label="Vapor Buckets" qty={site?.vapor_bucket_count} type={site?.vapor_bucket_type} />
            </tbody>
          </table>
        </div>

        {/* Fuel sales / removal — filled in by hand */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Will fuel sales stop during construction?  (Yes / No)" />
          <Field label="Fuel removal needed?  (Yes / No / Volume)" />
        </div>
      </div>

      <style>{`@media print { .no-print { display: none !important; } }`}</style>
    </div>
  )
}

function EquipRow({ label, qty, type }: { label: string; qty?: number | null; type?: string | null }) {
  return (
    <tr>
      <td className="px-3 py-2 text-gray-600 w-44">{label}</td>
      <td className="px-3 py-2 text-gray-900 w-16 text-center">{qty ?? '—'}</td>
      <td className="px-3 py-2 text-gray-700">{type || ''}</td>
    </tr>
  )
}
