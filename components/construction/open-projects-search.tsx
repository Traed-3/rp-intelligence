'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, X } from 'lucide-react'
import { StageBadge } from '@/components/construction/badges'

export type OpenProject = {
  id: string
  site_number: string | null
  job_number: string | null
  work_order_number: string | null
  stage: string
  scope_of_work: string | null
  gas_brand: string | null
  customer_name: string | null
  address: string | null
}

/** The house number an address starts with: "4710 Williamsburg Rd" → "4710". */
function houseNumber(address: string | null): string {
  return address?.match(/^\s*(\d+)/)?.[1] ?? ''
}

/**
 * Matches a typed number against the site number or the street number.
 *   "*"      → every open project
 *   "34006"  → site 34006          "4710" → SU-4710, or anything at 4710 <street>
 * A number has to line up with the START of the site/street number, so "201"
 * finds 201 N Point Blvd but not site 42010. Typing letters falls back to a
 * plain contains match on the site name, address and customer.
 * Returns 0 = no match, 2 = exact, 1 = partial (exact hits sort first).
 */
function matchRank(p: OpenProject, raw: string): number {
  const q = raw.trim().toLowerCase()
  if (!q) return 0
  if (q === '*') return 1
  const site = (p.site_number ?? '').toLowerCase()
  const house = houseNumber(p.address)
  if (/^\d+$/.test(q)) {
    const siteNums: string[] = site.match(/\d+/g) ?? []
    if (siteNums.includes(q) || house === q) return 2
    if (siteNums.some(n => n.startsWith(q)) || house.startsWith(q)) return 1
    return 0
  }
  if (site === q) return 2
  const hay = [p.site_number, p.job_number, p.address, p.customer_name].filter(Boolean).join(' ').toLowerCase()
  return hay.includes(q) ? 1 : 0
}

/**
 * Construction page header: the title on the left, the open-projects search
 * box to its right, and the matches listed underneath. Only open (not
 * Complete) jobs are ever passed in, so nothing finished can show up here.
 */
export function OpenProjectsSearch({ projects, children }: { projects: OpenProject[]; children: React.ReactNode }) {
  const [text, setText] = useState('')
  const [applied, setApplied] = useState('')

  const results = useMemo(() => {
    if (!applied.trim()) return []
    return projects
      .map(p => ({ p, rank: matchRank(p, applied) }))
      .filter(x => x.rank > 0)
      .sort((a, b) => b.rank - a.rank || (a.p.site_number ?? '').localeCompare(b.p.site_number ?? '', undefined, { numeric: true }))
      .map(x => x.p)
  }, [projects, applied])

  const clear = () => { setText(''); setApplied('') }
  const showing = applied.trim() !== ''
  const all = applied.trim() === '*'

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0">{children}</div>
        <form
          role="search"
          className="relative flex-1 min-w-[220px] max-w-md"
          onSubmit={e => { e.preventDefault(); setApplied(text) }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            aria-label="Search open projects"
            value={text}
            onChange={e => {
              const v = e.target.value
              setText(v)
              // live results once there is enough to go on; Enter always searches
              const t = v.trim()
              setApplied(t === '*' || t.length >= 2 ? v : '')
            }}
            onKeyDown={e => { if (e.key === 'Escape') clear() }}
            placeholder="Open projects — site # or street #  (* = all)"
            className="w-full pl-9 pr-9 py-2 text-sm border border-gray-300 rounded-full bg-card focus:outline-none focus:ring-2 focus:ring-blue-500 [&::-webkit-search-cancel-button]:hidden"
          />
          {text && (
            <button type="button" onClick={clear} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </form>
      </div>

      {showing && (
        <section className="rp-card overflow-hidden mt-4" aria-live="polite">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-900 text-sm">
              {all ? 'All open projects' : <>Open projects matching &ldquo;{applied.trim()}&rdquo;</>}
              <span className="ml-2 font-normal text-gray-400">{results.length}</span>
            </h2>
            <button type="button" onClick={clear} className="text-xs font-medium text-blue-600 hover:text-blue-800">Clear</button>
          </div>
          {results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400">
              No open project with that site number or street number. Enter * to list every open project.
            </p>
          ) : (
            <ul className="divide-y divide-gray-50 max-h-[70vh] overflow-y-auto">
              {results.map(p => (
                <li key={p.id}>
                  <Link href={`/construction/jobs/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 min-w-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="font-semibold text-gray-900 text-sm shrink-0">{p.site_number ?? p.job_number ?? '—'}</span>
                        {p.gas_brand && <span className="text-[11px] text-gray-400 shrink-0">{p.gas_brand}</span>}
                        {p.address && <span className="text-xs text-gray-600 truncate min-w-0">{p.address}</span>}
                      </div>
                      {(p.scope_of_work || p.work_order_number) && (
                        <p className="text-xs text-gray-500 truncate">
                          {[p.work_order_number, p.scope_of_work].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 whitespace-nowrap"><StageBadge stage={p.stage} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
