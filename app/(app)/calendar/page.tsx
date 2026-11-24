import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canReadConstruction } from '@/lib/construction'
import {
  loadConstructionCalendar, loadMaintenanceCalendar, CATEGORY_META,
  type CalendarEvent, type CalendarLayer,
} from '@/lib/calendar-events'
import {
  iso, parseISO, addDays, addMonths, startOfMonth, mondayOnOrBefore, monthGridDays, WEEKDAY_LABELS,
} from '@/lib/date'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'

type SearchParams = { view?: string; date?: string; layers?: string }

const ALL_LAYERS: CalendarLayer[] = ['maintenance', 'construction']

export default async function CalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile) redirect('/dashboard')
  const companyId = profile.company_id as string

  // Which layers is this viewer allowed to see at all?
  const showConstruction = canReadConstruction(profile)
  const availableLayers: CalendarLayer[] = ALL_LAYERS.filter(l => l !== 'construction' || showConstruction)

  // Enabled layers come from the URL; default is everything available.
  const enabled: CalendarLayer[] = (() => {
    if (sp.layers === 'none') return []
    if (!sp.layers) return availableLayers
    const req = sp.layers.split(',').filter(Boolean) as CalendarLayer[]
    return availableLayers.filter(l => req.includes(l))
  })()

  const view = sp.view === 'week' ? 'week' : 'month'
  const anchor = sp.date ? parseISO(sp.date) : new Date()
  const today = new Date()

  // Compute the visible day range.
  const days: Date[] = view === 'month'
    ? monthGridDays(anchor)
    : Array.from({ length: 7 }, (_, i) => addDays(mondayOnOrBefore(anchor), i))
  const rangeStart = iso(days[0])
  const rangeEnd = iso(days[days.length - 1])

  // Load only the enabled layers (and only construction if allowed).
  const [maintenanceEvents, constructionEvents] = await Promise.all([
    enabled.includes('maintenance') ? loadMaintenanceCalendar(admin, companyId, rangeStart, rangeEnd) : Promise.resolve([]),
    enabled.includes('construction') && showConstruction ? loadConstructionCalendar(admin, companyId, rangeStart, rangeEnd) : Promise.resolve([]),
  ])
  const events = [...maintenanceEvents, ...constructionEvents]

  const byDay = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    const arr = byDay.get(e.date) ?? []
    arr.push(e); byDay.set(e.date, arr)
  }

  // ── URL builders (preserve state) ──
  const build = (patch: Partial<SearchParams>) => {
    const merged: Record<string, string> = {}
    if (view !== 'month') merged.view = view
    if (sp.date) merged.date = sp.date
    if (sp.layers) merged.layers = sp.layers
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete merged[k]; else merged[k] = v }
    const qs = new URLSearchParams(merged).toString()
    return qs ? `/calendar?${qs}` : '/calendar'
  }
  const layersParam = (set: CalendarLayer[]) => {
    if (set.length === 0) return 'none'
    if (set.length === availableLayers.length) return undefined // default → omit
    return set.join(',')
  }
  const toggleLayerHref = (layer: CalendarLayer) => {
    const next = enabled.includes(layer) ? enabled.filter(l => l !== layer) : [...enabled, layer]
    return build({ layers: layersParam(next) })
  }

  const prevHref = build({ date: iso(view === 'month' ? addMonths(startOfMonth(anchor), -1) : addDays(mondayOnOrBefore(anchor), -7)) })
  const nextHref = build({ date: iso(view === 'month' ? addMonths(startOfMonth(anchor), 1) : addDays(mondayOnOrBefore(anchor), 7)) })
  const todayHref = build({ date: iso(today) })

  const heading = view === 'month'
    ? anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : `Week of ${mondayOnOrBefore(anchor).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  const monthOf = anchor.getMonth()
  const categoriesPresent = [...new Set(events.map(e => e.category))]

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="rp-title">
            Calendar
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Maintenance{showConstruction ? ' & Construction' : ''} on one calendar · {events.length} item{events.length !== 1 ? 's' : ''} shown</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View switch */}
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm">
            <Link href={build({ view: undefined })} className={`px-3 py-1.5 ${view === 'month' ? 'bg-primary text-primary-foreground' : 'bg-card text-gray-600 hover:bg-gray-50'}`}>Month</Link>
            <Link href={build({ view: 'week' })} className={`px-3 py-1.5 border-l border-gray-300 ${view === 'week' ? 'bg-primary text-primary-foreground' : 'bg-card text-gray-600 hover:bg-gray-50'}`}>Week</Link>
          </div>
        </div>
      </div>

      {/* Layer toggles + navigation */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {availableLayers.map(layer => {
            const on = enabled.includes(layer)
            const label = layer === 'construction' ? 'Construction' : 'Maintenance'
            return (
              <Link key={layer} href={toggleLayerHref(layer)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-semibold transition-colors ${on ? (layer === 'construction' ? 'bg-primary text-primary-foreground border-primary' : 'bg-emerald-600 text-white border-emerald-600') : 'bg-card text-gray-500 border-gray-300 hover:bg-gray-50'}`}>
                <span className={`w-2 h-2 rounded-full ${on ? 'bg-card' : layer === 'construction' ? 'bg-blue-400' : 'bg-emerald-400'}`} />
                {label}
              </Link>
            )
          })}
        </div>
        <div className="flex items-center gap-1.5">
          <Link href={todayHref} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">Today</Link>
          <Link href={prevHref} aria-label="Previous" className="p-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"><ChevronLeft className="w-4 h-4" /></Link>
          <span className="text-sm font-semibold text-gray-900 min-w-40 text-center">{heading}</span>
          <Link href={nextHref} aria-label="Next" className="p-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"><ChevronRight className="w-4 h-4" /></Link>
        </div>
      </div>

      {/* Legend */}
      {categoriesPresent.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap mb-3 text-xs text-gray-500">
          {categoriesPresent.map(c => (
            <span key={c} className="inline-flex items-center gap-1.5">
              <span className={`w-3 h-3 rounded border ${CATEGORY_META[c]?.className ?? 'bg-gray-100 border-gray-200'}`} />
              {CATEGORY_META[c]?.label ?? c}
            </span>
          ))}
        </div>
      )}

      {enabled.length === 0 ? (
        <div className="rp-card p-12 text-center">
          <CalendarDays className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Both layers are turned off. Turn one on above to see items.</p>
        </div>
      ) : view === 'month' ? (
        <div className="rp-card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50">
            {WEEKDAY_LABELS.map(w => <div key={w} className="px-2 py-2 text-xs font-semibold text-gray-500 text-center">{w}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d, i) => {
              const key = iso(d)
              const dayEvents = byDay.get(key) ?? []
              const inMonth = d.getMonth() === monthOf
              const isToday = iso(today) === key
              return (
                <div key={i} className={`min-h-28 border-b border-r border-gray-100 p-1.5 ${inMonth ? 'bg-card' : 'bg-gray-50/50'}`}>
                  <div className={`text-xs mb-1 ${isToday ? 'font-bold text-blue-700' : inMonth ? 'text-gray-500' : 'text-gray-300'}`}>
                    {isToday ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground">{d.getDate()}</span> : d.getDate()}
                  </div>
                  <div className="space-y-1">
                    {dayEvents.slice(0, 4).map(e => <EventChip key={e.id} e={e} />)}
                    {dayEvents.length > 4 && <div className="text-[11px] text-gray-400 px-1">+{dayEvents.length - 4} more</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
          {days.map((d, i) => {
            const key = iso(d)
            const dayEvents = byDay.get(key) ?? []
            const isToday = iso(today) === key
            return (
              <div key={i} className={`bg-card rounded-xl border shadow-sm p-2 min-h-40 ${isToday ? 'border-blue-300' : 'border-gray-200'}`}>
                <div className={`text-xs font-semibold mb-1.5 ${isToday ? 'text-blue-700' : 'text-gray-500'}`}>
                  {d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </div>
                <div className="space-y-1">
                  {dayEvents.length === 0 ? <p className="text-[11px] text-gray-300">—</p> : dayEvents.map(e => <EventChip key={e.id} e={e} />)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EventChip({ e }: { e: CalendarEvent }) {
  const inner = (
    <div className={`rounded px-1.5 py-1 text-[11px] leading-tight border ${e.className} ${e.href ? 'hover:opacity-80 cursor-pointer' : ''}`}>
      <span className="font-semibold block truncate">{e.title}</span>
      {e.subtitle && <span className="block truncate opacity-80">{e.subtitle}</span>}
    </div>
  )
  return e.href ? <Link href={e.href} className="block">{inner}</Link> : inner
}
