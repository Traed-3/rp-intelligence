import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireFieldSurveys } from '@/lib/construction-guard'
import { ACCIDENT_INTRO, ACCIDENT_NOTIFY, fmtDate, accidentFlags } from '@/lib/accident'
import { loadAccident } from '@/lib/accident-pdf'
import { AccidentForm, AccidentPhotos, AccidentSignature, AccidentEmail } from '@/components/forms/accident-form'
import { submitReport, addPhotos, deletePhoto, saveSignature, emailReport, reopenReport, deleteReport } from '../actions'

export const dynamic = 'force-dynamic'
const btn = 'px-3 py-1.5 rounded-lg border border-gray-300 bg-card hover:bg-gray-50'

export default async function AccidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await requireFieldSurveys()
  const admin = createAdminClient()
  const row = await loadAccident(admin, id, profile.company_id)
  if (!row) notFound()
  if (!profile.fullAccess && row.created_by !== profile.id) notFound()
  const locked = row.status !== 'draft'

  // Truck / equipment numbers to pick from. Typing one that isn't listed (or N/A) is fine.
  const { data: assets } = await admin.from('assets').select('unit_number, is_active, status').eq('company_id', profile.company_id).order('unit_number')
  const units = [...new Set((assets ?? []).filter(a => a.is_active !== false && a.status !== 'retired').map(a => a.unit_number as string).filter(Boolean))]
  const flags = accidentFlags(row)
  const pdf = `/forms/accident/${id}/pdf`

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto overflow-x-hidden space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="rp-title">Accident report{row.unit_number ? <span className="text-base font-normal text-gray-500"> · Truck {row.unit_number}</span> : null}</h1>
          <p className="text-xs text-gray-500 mt-0.5">{fmtDate(row.accident_date)} · {row.employee_name ?? 'driver'} · <span className="uppercase font-semibold">{locked ? 'submitted' : 'draft'}</span>{flags.length ? <> · <span className="text-amber-700 font-bold">{flags.join(', ').toUpperCase()}</span></> : null}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <a href={pdf} target="_blank" rel="noopener" className={btn}>{locked ? 'Open PDF' : 'Preview PDF'}</a>
          <Link href="/forms/accident" className="px-3 py-1.5 text-gray-500">All reports</Link>
        </div>
      </div>

      {locked ? (
        <div className="rp-card p-4 space-y-4 border-emerald-200 bg-emerald-50/50">
          <p className="text-sm font-semibold text-gray-900">This report is submitted.{!profile.fullAccess ? ' Ask the office if something needs to change.' : ''}</p>
          <div className="flex flex-wrap gap-2 text-sm">
            <a href={pdf} target="_blank" rel="noopener" className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-600/90">Open / print PDF</a>
            <a href={`${pdf}?download=1`} className="px-4 py-2 rounded-lg border border-gray-300 bg-card font-semibold text-gray-800 hover:bg-gray-50">Download PDF</a>
            {profile.fullAccess && <form action={reopenReport.bind(null, id)}><button className="px-4 py-2 rounded-lg border border-gray-300 bg-card text-gray-600 hover:bg-gray-50">Reopen to change</button></form>}
          </div>
          {row.emailed_at
            ? <p className="text-sm text-emerald-800">Emailed to {row.emailed_to} on {new Date(row.emailed_at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' })}.</p>
            : <p className="text-sm font-semibold text-red-700">The automatic email to {ACCIDENT_NOTIFY.join(' and ')} did not go out. Press Email PDF below to send it, and call the office.</p>}
          <AccidentEmail action={emailReport.bind(null, id)} defaultTo={row.emailed_at ? '' : ACCIDENT_NOTIFY.join(', ')} />
        </div>
      ) : (
        <div className="rp-card p-4 border-amber-200 bg-amber-50/60 text-sm text-amber-900">{ACCIDENT_INTRO}</div>
      )}

      <AccidentForm key={row.status} row={row} units={units} locked={locked} action={submitReport.bind(null, id)} />

      <div className="rp-card p-4">
        <AccidentPhotos reportId={id} photos={row.photos ?? []} locked={locked} add={addPhotos.bind(null, id)} remove={deletePhoto.bind(null, id)} />
      </div>

      <div className="rp-card p-4">
        <AccidentSignature existing={row.signature} signedLabel={row.signed_at ? `Signed ${new Date(row.signed_at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' })}` : null} locked={locked} save={saveSignature.bind(null, id)} />
        {!locked && <p className="text-xs text-gray-500 mt-2">After signing, press <b>Submit report</b> above.</p>}
      </div>

      {!locked && (
        <form action={deleteReport.bind(null, id)} className="text-right">
          <button className="text-xs text-gray-400 hover:text-red-600 underline">Delete this draft</button>
        </form>
      )}
    </div>
  )
}
