import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { loadPermitGraph } from '@/lib/permits-data'
import { computeReadyToWork } from '@/lib/permits'
import { PermitProjectForm } from '@/components/construction/permit-project-form'
import { createPermitProject } from '../actions'
import { LayoutList, Plus } from 'lucide-react'

const th = 'text-left px-4 py-3 font-medium text-gray-500'

export default async function PermitSitesPage() {
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()
  const graph = await loadPermitGraph(admin, company_id)

  const byProject = new Map<string, typeof graph.enriched>()
  for (const p of graph.enriched) {
    const arr = byProject.get(p.project_id) ?? []
    arr.push(p); byProject.set(p.project_id, arr as never)
  }

  const jurName = new Map(graph.jurisdictions.map(j => [j.id, j.name]))
  const rows = [...graph.sites].sort((a, b) => a.site_number.localeCompare(b.site_number)).map(site => {
    const projects = graph.projects.filter(pr => pr.site_id === site.id)
    const permits = graph.enriched.filter(p => p.site?.id === site.id && p.requirement_status === 'Required')
    const ready = projects.some(pr => computeReadyToWork((byProject.get(pr.id) ?? []) as never))
    return { site, jurisdictionName: site.jurisdiction_id ? jurName.get(site.jurisdiction_id) ?? null : null, requiredCount: permits.length, ready }
  })

  const jurisdictions = [...graph.jurisdictions].sort((a, b) => a.name.localeCompare(b.name)).map(j => ({ id: j.id, name: j.name }))

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="rp-title">
            Sites
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{rows.length} sites</p>
        </div>
        <Link href="/construction/permits" className="text-sm text-gray-500 hover:text-gray-700">← Permit Board</Link>
      </div>

      <div className="rp-card overflow-hidden mb-5">
        {rows.length === 0 ? (
          <div className="p-12 text-center"><LayoutList className="w-8 h-8 text-gray-300 mx-auto mb-3" /><p className="text-gray-400 text-sm">No sites yet.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="rp-table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className={th}>Site</th>
                  <th className={`${th} hidden sm:table-cell`}>Jurisdiction</th>
                  <th className={`${th} hidden sm:table-cell`}>State</th>
                  <th className={th}>Permits</th>
                  <th className={th}>Ready</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(({ site, jurisdictionName, requiredCount, ready }) => (
                  <ClickableRow key={site.id} href={`/construction/permits/sites/${site.id}`}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{site.site_number}</span>
                      {site.name && <div className="text-xs text-gray-400">{site.name}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{jurisdictionName ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{site.state ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{requiredCount}</td>
                    <td className="px-4 py-3">
                      {ready
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">Ready</span>
                        : <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">Not ready</span>}
                    </td>
                    <td className="px-4 py-3 text-right"><span className="text-xs font-medium text-blue-600">Open →</span></td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canWrite && (
        <details className="rp-card">
          <summary className="px-5 py-4 cursor-pointer font-semibold text-gray-900 flex items-center gap-2"><Plus className="w-4 h-4 text-blue-600" />New Project</summary>
          <div className="px-5 pb-5">
            <PermitProjectForm action={createPermitProject} jurisdictions={jurisdictions} />
          </div>
        </details>
      )}
    </div>
  )
}
