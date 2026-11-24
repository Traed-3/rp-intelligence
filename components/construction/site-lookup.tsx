'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, MapPin, Phone } from 'lucide-react'

export type LookupSite = {
  site_number: string
  brand: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  customer: string | null
  edit_href: string | null
  jobs: number
  open_jobs: number
  last_job: string | null
}

const MAX_SHOWN = 100

function fmtDate(d: string | null) {
  if (!d) return null
  const [y, m, day] = d.slice(0, 10).split('-')
  return `${Number(m)}/${Number(day)}/${y.slice(2)}`
}

export function SiteLookup({ sites }: { sites: LookupSite[] }) {
  const [q, setQ] = useState('')

  // one lowercase search string per site, built once
  const indexed = useMemo(() => sites.map(s => ({
    s,
    num: s.site_number.toLowerCase(),
    digits: s.site_number.replace(/\D/g, ''),
    hay: [s.site_number, s.site_number.replace(/[\s-]/g, ''), s.brand, s.address, s.city, s.state, s.zip, s.customer, s.phone]
      .filter(Boolean).join(' ').toLowerCase(),
  })), [sites])

  const results = useMemo(() => {
    const terms = q.toLowerCase().trim().split(/\s+/).filter(Boolean)
    if (!terms.length) return indexed.map(x => x.s)
    const whole = terms.join(' ')
    const wholeDigits = whole.replace(/\D/g, '')
    return indexed
      .filter(x => terms.every(t => x.hay.includes(t)))
      .map(x => ({
        s: x.s,
        // exact number first, then numbers that start with it, then everything else
        rank: x.num === whole || (wholeDigits && x.digits === wholeDigits && /^\D*\d+$/.test(whole)) ? 0
          : x.num.startsWith(whole) || (wholeDigits && x.digits.startsWith(wholeDigits)) ? 1 : 2,
      }))
      .sort((a, b) => a.rank - b.rank)
      .map(x => x.s)
  }, [q, indexed])

  const shown = results.slice(0, MAX_SHOWN)

  return (
    <div>
      <div className="relative mb-4">
        <Search className="w-5 h-5 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          autoFocus
          type="search"
          inputMode="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Site number, street, city or brand…"
          className="w-full rounded-2xl border border-gray-300 bg-card pl-11 pr-4 py-3 text-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
        />
      </div>

      <p className="text-xs text-gray-500 mb-2">
        {results.length === 0 ? 'No site matches that.' :
          results.length > MAX_SHOWN ? `Showing the first ${MAX_SHOWN} of ${results.length} — keep typing to narrow it down.` :
          `${results.length} site${results.length === 1 ? '' : 's'}`}
      </p>

      <ul className="space-y-2">
        {shown.map(s => {
          const cityLine = [s.city, [s.state, s.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
          const full = [s.address, cityLine].filter(Boolean).join(', ')
          return (
            <li key={s.site_number} className="rp-card px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2.5 min-w-0">
                  <span className="text-xl font-bold text-gray-900 tabular-nums">{s.site_number}</span>
                  {s.brand && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{s.brand}</span>}
                  {s.customer && s.customer !== s.brand && <span className="text-xs text-gray-400">{s.customer}</span>}
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  {s.jobs > 0 && (
                    <Link href={`/construction/jobs?view=table&q=${encodeURIComponent(s.site_number)}`} className="text-sm text-blue-600 hover:text-blue-800">
                      {s.jobs} job{s.jobs === 1 ? '' : 's'}{s.open_jobs > 0 ? ` · ${s.open_jobs} open` : ''} →
                    </Link>
                  )}
                  {s.edit_href && <Link href={s.edit_href} className="text-sm text-gray-500 hover:text-gray-700">Edit</Link>}
                </div>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                {full ? (
                  <a href={`https://maps.apple.com/?q=${encodeURIComponent(full)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-gray-700 hover:text-blue-700">
                    <MapPin className="w-4 h-4 text-gray-400 shrink-0" />{full}
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-gray-400"><MapPin className="w-4 h-4 shrink-0" />No address on file</span>
                )}
                {s.phone && (
                  <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1.5 text-gray-700 hover:text-blue-700">
                    <Phone className="w-4 h-4 text-gray-400 shrink-0" />{s.phone}
                  </a>
                )}
                {s.last_job && <span className="text-xs text-gray-400">last job received {fmtDate(s.last_job)}</span>}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
