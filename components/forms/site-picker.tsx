'use client'

import { useEffect, useRef, useState } from 'react'
import { MapPin, Search } from 'lucide-react'
import type { SiteHit } from '@/lib/site-survey'

/**
 * The site number box with a search behind it. Type a store number, a street, a city or a brand: matching sites list
 * underneath and a tap picks one. A number that matches a site exactly is reported through `onExact` so the form can
 * fill the address without a tap.
 */
export function SitePicker({ value, onChange, onPick, onExact, search, disabled, name, placeholder, className, autoFocus }: {
  value: string; onChange: (v: string) => void; onPick: (s: SiteHit) => void; onExact?: (s: SiteHit) => void
  search: (q: string) => Promise<SiteHit[]>; disabled?: boolean; name?: string; placeholder?: string; className?: string; autoFocus?: boolean
}) {
  const [hits, setHits] = useState<SiteHit[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cursor, setCursor] = useState(-1)
  const [typed, setTyped] = useState(false)   // only search after the person types; not for the number the survey loaded with
  const seq = useRef(0)
  const exact = useRef(onExact)
  useEffect(() => { exact.current = onExact }, [onExact])

  useEffect(() => {
    if (!typed) return
    const q = value.trim()
    const mine = ++seq.current
    const t = setTimeout(async () => {
      if (q.length < 2) { setHits([]); setBusy(false); return }
      setBusy(true)
      const found = await search(q).catch(() => [] as SiteHit[])
      if (mine !== seq.current) return   // a newer keystroke is already out
      setHits(found); setBusy(false); setCursor(-1)
      const same = found.find(h => h.site_number.toLowerCase() === q.toLowerCase())
      if (same) exact.current?.(same)
    }, 300)
    return () => clearTimeout(t)
  }, [value, search, typed])

  const pick = (h: SiteHit) => { setTyped(false); setOpen(false); setHits([]); onPick(h) }
  const show = open && !disabled && value.trim().length >= 2 && typed

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
      <input name={name} value={value} disabled={disabled} autoFocus={autoFocus} autoComplete="off" placeholder={placeholder} className={`${className ?? ''} pl-8`}
        role="combobox" aria-expanded={show} aria-controls="site-picker-list" aria-autocomplete="list"
        onChange={e => { setTyped(true); setOpen(true); onChange(e.target.value) }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (!show || !hits.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(hits.length - 1, c + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)) }
          else if (e.key === 'Enter' && cursor >= 0) { e.preventDefault(); pick(hits[cursor]) }
          else if (e.key === 'Escape') setOpen(false)
        }} />
      {show && (
        <ul id="site-picker-list" role="listbox" className="absolute z-30 left-0 right-0 sm:right-auto sm:min-w-[22rem] mt-1 max-h-72 overflow-auto rounded-lg border border-gray-200 bg-card shadow-lg">
          {busy && !hits.length && <li className="px-3 py-2 text-xs text-gray-400">Searching…</li>}
          {!busy && !hits.length && <li className="px-3 py-2 text-xs text-gray-500">No site matches. Keep what you typed and fill in the address by hand.</li>}
          {hits.map((h, i) => (
            <li key={h.site_number} role="option" aria-selected={i === cursor}>
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(h)} className={`w-full text-left px-3 py-2 flex items-start gap-2 ${i === cursor ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-gray-900">{h.site_number}{h.site_name ? <span className="font-normal text-gray-500"> · {h.site_name}</span> : null}</span>
                  <span className="block text-xs text-gray-500 truncate">{h.address ?? 'no address on file'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The "start a survey" box on the list page: search for the site, then start. */
export function StartSurvey({ action, search }: { action: (fd: FormData) => Promise<void>; search: (q: string) => Promise<SiteHit[]> }) {
  const [site, setSite] = useState('')
  const [found, setFound] = useState<SiteHit | null>(null)
  const shown = found && found.site_number.toLowerCase() === site.trim().toLowerCase() ? found : null
  return (
    <form action={action} className="rp-card p-4 mb-5 flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[14rem]">
        <label className="block text-xs font-medium text-gray-600 mb-1">Find the site: store number, street, city or brand</label>
        <SitePicker name="site_number" value={site} onChange={setSite} onPick={h => { setSite(h.site_number); setFound(h) }} onExact={setFound} search={search}
          placeholder="40017, SU-13400, Patterson Ave, Berryville" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-card" />
        <p className="text-xs mt-1 min-h-[1rem] text-gray-500">{shown ? <span className="text-emerald-700">{[shown.site_name, shown.address].filter(Boolean).join(' · ') || 'Site found'}</span> : site.trim() ? 'Not in the site list: the survey starts with this number and you type the address.' : 'Leave it blank to start without a site.'}</p>
      </div>
      <button className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 mb-5">Start a site survey</button>
    </form>
  )
}
