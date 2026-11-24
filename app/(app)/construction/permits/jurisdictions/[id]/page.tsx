import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { loadPermitGraph } from '@/lib/permits-data'
import { JurisdictionForm, type JurisdictionRecord } from '@/components/construction/jurisdiction-form'
import { permitStatusMeta } from '@/lib/permits'
import { saveJurisdiction } from '../../actions'

const th = 'text-left px-3 py-2.5 font-medium text-gray-500'

export default async function JurisdictionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()

  const { data: jur } = await admin.from('con_jurisdictions').select('*')
    .eq('id', id).eq('company_id', company_id).single()
  if (!jur) notFound()

  const graph = await loadPermitGraph(admin, company_id)
  // every permit ever pulled in this jurisdiction (all requirement states)
  const permits = graph.enriched
    .filter(p => p.jurisdiction?.id === id)
    .sort((a, b) => (a.site?.site_number ?? '').localeCompare(b.site?.site_number ?? ''))

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-5">
        <Link href="/construction/permits/jurisdictions" className="text-sm text-gray-500 hover:text-gray-700">← Jurisdictions</Link>
        <h1 className="rp-title mt-2 flex items-center gap-2">
          {jur.name}
          {jur.is_independent_city && <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">Independent city</span>}
        </h1>
        <p className="text-sm text-gray-500">{jur.state}{jur.department ? ` · ${jur.department}` : ''}</p>
      </div>

      <div className="rp-card p-5 mb-5">
        {canWrite
          ? <JurisdictionForm action={saveJurisdiction.bind(null, id)} jurisdiction={jur as JurisdictionRecord} />
          : <ReadOnly jur={jur} />}
      </div>

      <div className="rp-card overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <h2 className="font-semibold text-gray-900 text-sm">Permits pulled here ({permits.length})</h2>
        </div>
        {permits.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No permits yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="rp-table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className={th}>Permit ID</th>
                  <th className={th}>Site</th>
                  <th className={th}>Type</th>
                  <th className={th}>Requirement</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {permits.map(p => {
                  const c = permitStatusMeta(p.status)
                  return (
                    <ClickableRow key={p.id} href={p.site ? `/construction/permits/sites/${p.site.id}` : '/construction/permits'}>
                      <td className="px-3 py-2.5 font-mono text-xs font-semibold text-gray-900">{p.permit_key ?? '—'}</td>
                      <td className="px-3 py-2.5 text-gray-700">{p.site?.site_number ?? '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{p.permit_type}</td>
                      <td className="px-3 py-2.5 text-gray-600">{p.requirement_status}</td>
                      <td className="px-3 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full border ${c.className}`}>{p.status}</span></td>
                    </ClickableRow>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function ReadOnly({ jur }: { jur: Record<string, unknown> }) {
  const rows: [string, unknown][] = [
    ['Contact', jur.contact_name], ['Phone', jur.phone], ['Email', jur.email],
    ['Portal', jur.portal_url], ['Submittal method', jur.submittal_method],
    ['Turnaround', jur.typical_turnaround_days], ['Fee notes', jur.fee_notes],
    ['Building w/ electrical', jur.requires_building_with_electrical],
    ['Mechanical w/ electrical', jur.requires_mechanical_with_electrical],
    ['Contractor requirements', jur.contractor_requirements], ['Cheat sheet', jur.cheat_sheet],
  ]
  return (
    <dl className="space-y-2 text-sm">
      {rows.map(([k, v]) => v ? (
        <div key={k} className="grid grid-cols-3 gap-2"><dt className="text-gray-500">{k}</dt><dd className="col-span-2 text-gray-800 whitespace-pre-wrap">{String(v)}</dd></div>
      ) : null)}
    </dl>
  )
}
