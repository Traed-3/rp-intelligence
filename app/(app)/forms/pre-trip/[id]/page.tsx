import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireFieldSurveys } from '@/lib/construction-guard'
import { PRETRIP_INTRO, pretripSections, pretripTitle, kindLabel, fmtDate, remarkItems, itemShort } from '@/lib/pretrip'
import { loadPretrip } from '@/lib/pretrip-pdf'
import { PretripForm, PretripSignature, PretripEmail } from '@/components/forms/pretrip-form'
import { submitInspection, saveSignature, emailInspection, reopenInspection, deleteInspection } from '../actions'

export const dynamic = 'force-dynamic'
const btn = 'px-3 py-1.5 rounded-lg border border-gray-300 bg-card hover:bg-gray-50'

export default async function PretripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await requireFieldSurveys()
  const admin = createAdminClient()
  const row = await loadPretrip(admin, id, profile.company_id)
  if (!row) notFound()
  if (!profile.fullAccess && row.created_by !== profile.id) notFound()
  const locked = row.status !== 'draft'

  // Numbers to pick from: trailers for the trailer sheet, everything else for the vehicle sheet. Typing a new one is fine.
  const { data: assets } = await admin.from('assets').select('unit_number, is_active, status, asset_types(name)').eq('company_id', profile.company_id).order('unit_number')
  const units = [...new Set((assets ?? []).filter(a => a.is_active !== false && a.status !== 'retired').filter(a => {
    const isTrailer = /trailer/i.test((a.asset_types as unknown as { name: string | null } | null)?.name ?? '')
    return row.kind === 'trailer' ? isTrailer : !isTrailer
  }).map(a => a.unit_number as string).filter(Boolean))]
  const flagged = remarkItems(row)
  const pdf = `/forms/pre-trip/${id}/pdf`

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto overflow-x-hidden space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="rp-title">{kindLabel(row.kind)} {row.unit_number ?? ''} <span className="text-base font-normal text-gray-500">· Pre-trip inspection</span></h1>
          <p className="text-xs text-gray-500 mt-0.5">{fmtDate(row.inspection_date)} · {row.checked_by ?? 'driver'} · <span className="uppercase font-semibold">{locked ? 'finished' : 'draft'}</span>{locked && <> · <span className={flagged.length ? 'text-amber-700 font-bold' : 'text-emerald-700 font-bold'}>{flagged.length ? `${flagged.length} NEED${flagged.length === 1 ? 'S' : ''} ATTENTION` : 'ALL OK'}</span></>}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <a href={pdf} target="_blank" rel="noopener" className={btn}>{locked ? 'Open PDF' : 'Preview PDF'}</a>
          <Link href="/forms/pre-trip" className="px-3 py-1.5 text-gray-500">All inspections</Link>
        </div>
      </div>

      {locked ? (
        <div className="rp-card p-4 space-y-4 border-emerald-200 bg-emerald-50/50">
          <div>
            <p className="text-sm font-semibold text-gray-900">This inspection is finished.</p>
            {flagged.length ? <p className="text-sm text-amber-800 mt-0.5">Needs attention: {flagged.map(itemShort).join(', ')}. Repairs should be made before the vehicle is used.</p> : null}
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <a href={pdf} target="_blank" rel="noopener" className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-600/90">Open / print PDF</a>
            <a href={`${pdf}?download=1`} className="px-4 py-2 rounded-lg border border-gray-300 bg-card font-semibold text-gray-800 hover:bg-gray-50">Download PDF</a>
            <form action={reopenInspection.bind(null, id)}><button className="px-4 py-2 rounded-lg border border-gray-300 bg-card text-gray-600 hover:bg-gray-50">Reopen to change</button></form>
          </div>
          <PretripEmail action={emailInspection.bind(null, id)} sentTo={row.emailed_to} />
        </div>
      ) : (
        <details className="rp-card">
          <summary className="px-4 py-3 text-sm font-semibold text-gray-800 cursor-pointer">{pretripTitle(row.kind)}</summary>
          <p className="px-4 pb-4 text-sm text-gray-600">{PRETRIP_INTRO}</p>
        </details>
      )}

      <PretripForm key={row.status} row={row} sections={pretripSections(row.kind)} units={units} locked={locked} action={submitInspection.bind(null, id)} />

      <div className="rp-card p-4">
        <PretripSignature existing={row.signature} signedLabel={row.signed_at ? `Signed ${new Date(row.signed_at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' })}` : null} locked={locked} save={saveSignature.bind(null, id)} />
      </div>

      {!locked && (
        <form action={deleteInspection.bind(null, id)} className="text-right">
          <button className="text-xs text-gray-400 hover:text-red-600 underline">Delete this draft</button>
        </form>
      )}
    </div>
  )
}
