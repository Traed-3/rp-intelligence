import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { MapPin } from 'lucide-react'

const th = 'text-left px-4 py-3 font-medium text-gray-500'

const triLabel: Record<string, string> = { unknown: 'Unknown', yes: 'Yes', no: 'No' }

export default async function JurisdictionsPage() {
  const { company_id } = await requireConstruction()
  const admin = createAdminClient()
  const [{ data: jurisdictions }, { data: permits }] = await Promise.all([
    admin.from('con_jurisdictions').select('*').eq('company_id', company_id).order('name'),
    admin.from('con_permits').select('id, requirement_status, project_id').eq('company_id', company_id),
  ])
  // count permits per jurisdiction (via project → site → jurisdiction)
  const { data: sites } = await admin.from('con_permit_sites').select('id, jurisdiction_id').eq('company_id', company_id)
  const { data: projects } = await admin.from('con_permit_projects').select('id, site_id').eq('company_id', company_id)
  const siteJur = new Map((sites ?? []).map(s => [s.id, s.jurisdiction_id]))
  const projJur = new Map((projects ?? []).map(p => [p.id, siteJur.get(p.site_id) ?? null]))
  const counts = new Map<string, number>()
  for (const p of permits ?? []) {
    if (p.requirement_status !== 'Required') continue
    const jid = projJur.get(p.project_id)
    if (jid) counts.set(jid, (counts.get(jid) ?? 0) + 1)
  }

  const list = jurisdictions ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="rp-title">
            Jurisdictions
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{list.length} issuing offices · the reusable cheat sheet</p>
        </div>
        <Link href="/construction/permits" className="text-sm text-gray-500 hover:text-gray-700">← Permit Board</Link>
      </div>

      <div className="rp-card overflow-hidden">
        {list.length === 0 ? (
          <div className="p-12 text-center"><MapPin className="w-8 h-8 text-gray-300 mx-auto mb-3" /><p className="text-gray-400 text-sm">No jurisdictions yet.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="rp-table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className={th}>Jurisdiction</th>
                  <th className={th}>State</th>
                  <th className={`${th} hidden sm:table-cell`}>Bldg w/ Elec</th>
                  <th className={`${th} hidden sm:table-cell`}>Mech w/ Elec</th>
                  <th className={th}>Permits</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {list.map(j => (
                  <ClickableRow key={j.id} href={`/construction/permits/jurisdictions/${j.id}`}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{j.name}</span>
                      {j.is_independent_city && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">Independent city</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{j.state ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{triLabel[j.requires_building_with_electrical] ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{triLabel[j.requires_mechanical_with_electrical] ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{counts.get(j.id) ?? 0}</td>
                    <td className="px-4 py-3 text-right"><span className="text-xs font-medium text-blue-600">Open →</span></td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
