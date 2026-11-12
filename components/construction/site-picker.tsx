'use client'

import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'

export type PickedSite = {
  id: string
  site_number: string | null
  store_brand: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
}

/**
 * Type-in site box for a quote/invoice. Type a site number (or address/city) and
 * pick a match to fill the facility address + city/state/zip. The value stays
 * fully editable, so a brand-new site can just be typed in without picking.
 */
export function SitePicker({
  value,
  onChange,
  onPick,
  placeholder = 'Type a site number (e.g. 40107) — or a brand-new one',
  className,
}: {
  value: string
  onChange: (text: string) => void
  onPick: (site: PickedSite) => void
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<PickedSite[]>([])
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function search(text: string) {
    if (timer.current) clearTimeout(timer.current)
    if (text.trim().length < 1) { setResults([]); setOpen(false); return }
    timer.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await fetch(`/api/construction/sites/search?q=${encodeURIComponent(text)}&limit=12`, { cache: 'no-store' })
        const j = await r.json()
        setResults(j.sites ?? []); setOpen(true)
      } catch { setResults([]) } finally { setLoading(false) }
    }, 250)
  }

  const cityLine = (s: PickedSite) => [s.city, s.state].filter(Boolean).join(', ') + (s.zip ? ` ${s.zip}` : '')

  return (
    <div ref={box} className="relative">
      <input
        value={value}
        onChange={e => { onChange(e.target.value); search(e.target.value) }}
        onFocus={() => { if (results.length) setOpen(true) }}
        className={className}
        placeholder={placeholder}
        autoComplete="off"
      />
      {loading && <Search className="w-3.5 h-3.5 text-gray-300 absolute right-2 top-2.5 animate-pulse" />}
      {open && results.length > 0 && (
        <ul className="rp-card absolute z-30 mt-1 w-[30rem] max-w-[90vw] max-h-72 overflow-auto shadow-lg text-sm" role="listbox">
          {results.map(s => (
            <li key={s.id} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onPick(s); setOpen(false) }}
                className="w-full text-left px-3 py-2 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono font-medium text-gray-900">{s.site_number ?? '—'}</span>
                  {s.store_brand && <span className="text-xs text-gray-500 whitespace-nowrap">{s.store_brand}</span>}
                </div>
                <div className="text-xs text-gray-500 truncate">{[s.address, cityLine(s)].filter(Boolean).join(' · ')}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
