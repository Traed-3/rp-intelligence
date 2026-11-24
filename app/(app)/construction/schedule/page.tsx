import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { ScheduleEntryForm } from '@/components/construction/schedule-entry-form'
import { ScheduleMove } from '@/components/construction/schedule-move'
import { DeleteButton } from '@/components/construction/delete-button'
import { saveScheduleEntry, moveScheduleEntry, deleteScheduleEntry } from '../actions'
import { stageMeta, CON_STAGES } from '@/lib/construction'
import { iso, addDays, mondayOnOrBefore } from '@/lib/date'
import { ChevronLeft, ChevronRight, Users, Plane } from 'lucide-react'

type Entry = {
  id: string; schedule_date: string; entry_type: string | null; job_id: string | null
  site_number: string | null; task_description: string | null; crew: string[] | null
  equipment: string | null; notes: string | null
}
type Job = { id: string; site_number: string | null; work_order_number: string | null; stage: string | null; scope_of_work: string | null }

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string; stage?: string }> }) {
  const sp = await searchParams
  const view = sp.view === 'week' ? 'week' : 'month'
  const stageFilter = sp.stage ?? ''
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()

  const anchor = sp.date ? new Date(sp.date + 'T00:00:00') : new Date()
  const todayIso = iso(new Date())

  // ── Build the visible day range ──────────────────────────────────────────
  let days: Date[]
  let gridStart: Date
  let title: string
  let prevDate: string
  let nextDate: string

  if (view === 'week') {
    gridStart = mondayOnOrBefore(anchor)
    days = Array.from({ length: 6 }, (_, i) => addDays(gridStart, i)) // Mon–Sat
    title = `Week of ${gridStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    prevDate = iso(addDays(gridStart, -7))
    nextDate = iso(addDays(gridStart, 7))
  } else {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    gridStart = mondayOnOrBefore(first)
    days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)) // 6 weeks, Mon-start
    title = anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    prevDate = iso(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))
    nextDate = iso(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))
  }
  const rangeStart = iso(days[0])
  const rangeEnd = iso(days[days.length - 1])
  const anchorMonth = anchor.getMonth()

  const [{ data: entries }, { data: jobs }] = await Promise.all([
    admin.from('con_schedule_entries').select('*').eq('company_id', company_id)
      .gte('schedule_date', rangeStart).lte('schedule_date', rangeEnd).order('schedule_date'),
    // Scheduling only ever cares about open work — also keeps this well under
    // Supabase's default 1000-row cap now that completed jobs have piled up.
    admin.from('con_jobs').select('id, site_number, work_order_number, stage, scope_of_work')
      .eq('company_id', company_id).neq('stage', 'complete').order('site_number'),
  ])

  const jobById = new Map<string, Job>((jobs ?? []).map(j => [j.id, j as Job]))
  const byDay = new Map<string, Entry[]>()
  for (const e of (entries ?? []) as Entry[]) {
    if (stageFilter && !(e.job_id && jobById.get(e.job_id)?.stage === stageFilter)) continue
    const k = e.schedule_date
    if (!byDay.has(k)) byDay.set(k, [])
    byDay.get(k)!.push(e)
  }

  const dayOptions = days.map(d => ({ value: iso(d), label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' }) }))
  const navHref = (v: string, d: string) => {
    const p = new URLSearchParams(); p.set('view', v)
    if (d) p.set('date', d)
    if (stageFilter) p.set('stage', stageFilter)
    return `/construction/schedule?${p.toString()}`
  }
  const filterHref = (st: string) => {
    const p = new URLSearchParams(); p.set('view', view)
    if (sp.date) p.set('date', sp.date)
    if (st) p.set('stage', st)
    return `/construction/schedule?${p.toString()}`
  }
  // Order the status chips: stages that have jobs first, empty ones after,
  // and 'complete' always pinned last.
  const stageCounts = new Map<string, number>()
  for (const j of (jobs ?? []) as Job[]) stageCounts.set(j.stage ?? '', (stageCounts.get(j.stage ?? '') ?? 0) + 1)
  const hasJobs = (v: string) => (stageCounts.get(v) ?? 0) > 0
  const orderedStages = [
    ...CON_STAGES.filter(s => s.value !== 'complete' && hasJobs(s.value)),
    ...CON_STAGES.filter(s => s.value !== 'complete' && !hasJobs(s.value)),
    ...CON_STAGES.filter(s => s.value === 'complete'),
  ]

  function chipClass(e: Entry): string {
    if (e.entry_type === 'time_off') return 'bg-gray-100 text-gray-500 border-gray-300'
    if (e.entry_type === 'note') return 'bg-amber-50 text-amber-800 border-amber-200'
    const stage = e.job_id ? jobById.get(e.job_id)?.stage ?? null : null
    return stage ? stageMeta(stage).className : 'bg-blue-50 text-blue-800 border-blue-200'
  }
  function entryTitle(e: Entry): string {
    if (e.entry_type === 'time_off') return `${(e.crew ?? []).join(' / ') || 'Crew'} — Off`
    const job = e.job_id ? jobById.get(e.job_id) : null
    return e.site_number || job?.site_number || e.task_description || '—'
  }

  function EntryChip({ e, di }: { e: Entry; di: string }) {
    const job = e.job_id ? jobById.get(e.job_id) : null
    const sub = e.entry_type === 'time_off' ? null
      : (e.task_description && entryTitle(e) !== e.task_description ? e.task_description : (job?.scope_of_work ?? null))
    const body = (
      <>
        <div className="flex items-start gap-1">
          {e.entry_type === 'time_off' && <Plane className="w-3 h-3 shrink-0 mt-0.5" />}
          <span className="font-semibold break-words">{entryTitle(e)}</span>
        </div>
        {sub && <p className="opacity-80 line-clamp-2">{sub}</p>}
        {e.entry_type !== 'time_off' && e.crew?.length ? (
          <p className="mt-0.5 inline-flex items-center gap-1 opacity-90"><Users className="w-2.5 h-2.5" />{e.crew.join(', ')}</p>
        ) : null}
        {e.equipment && <p className="mt-0.5 italic opacity-80">{e.equipment}</p>}
      </>
    )
    return (
      <div className={`rounded-lg border px-2 py-1 text-[11px] leading-tight ${chipClass(e)}`}>
        {job ? (
          <Link href={`/construction/jobs/${job.id}`} className="block hover:underline" title={`Open job ${job.site_number ?? ''}`}>{body}</Link>
        ) : body}
        {canWrite && (
          <div className="flex items-center justify-between mt-1 -mb-0.5" data-no-row-nav>
            <ScheduleMove id={e.id} current={di} days={dayOptions} action={moveScheduleEntry} />
            <DeleteButton action={deleteScheduleEntry.bind(null, e.id)} confirm="Remove this entry?" iconOnly />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="rp-title">
            Schedule
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{title}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/construction" className="text-sm text-gray-500 hover:text-gray-700 mr-1">← Construction</Link>
          {/* View toggle */}
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
            <Link href={navHref('month', sp.date ?? '')} className={`px-3 py-2 ${view === 'month' ? 'bg-foreground text-background' : 'hover:bg-gray-50 text-gray-600'}`}>Month</Link>
            <Link href={navHref('week', sp.date ?? '')} className={`px-3 py-2 ${view === 'week' ? 'bg-foreground text-background' : 'hover:bg-gray-50 text-gray-600'}`}>Week</Link>
          </div>
          <Link href={navHref(view, prevDate)} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronLeft className="w-4 h-4" /></Link>
          <Link href={navHref(view, '')} className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50">Today</Link>
          <Link href={navHref(view, nextDate)} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronRight className="w-4 h-4" /></Link>
        </div>
      </div>

      {/* Status filter — also serves as the colour legend */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mr-0.5">Status</span>
        <Link href={filterHref('')} className={`text-[10px] px-2 py-0.5 rounded-full border ${!stageFilter ? 'bg-foreground text-background border-foreground' : 'bg-card text-gray-600 border-gray-300 hover:bg-gray-50'}`}>All</Link>
        {orderedStages.map(s => (
          <Link key={s.value} href={filterHref(s.value)} className={`text-[10px] px-2 py-0.5 rounded-full border ${s.className} ${stageFilter === s.value ? 'ring-2 ring-gray-900 ring-offset-1' : hasJobs(s.value) ? 'opacity-100' : 'opacity-50 hover:opacity-90'}`}>{s.label}</Link>
        ))}
        <span className="text-[10px] px-2 py-0.5 rounded-full border bg-gray-100 text-gray-400 border-gray-300">Time off</span>
      </div>

      {view === 'month' ? (
        <div className="rp-card overflow-hidden">
          {/* Weekday header */}
          <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => (
              <div key={w} className="px-2 py-1.5 text-[11px] font-semibold text-gray-500 text-center">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map(d => {
              const di = iso(d)
              const inMonth = d.getMonth() === anchorMonth
              const isToday = di === todayIso
              const dayEntries = byDay.get(di) ?? []
              return (
                <div key={di} className={`min-h-28 border-b border-r border-gray-100 p-1.5 ${inMonth ? 'bg-card' : 'bg-gray-50/60'} ${isToday ? 'ring-2 ring-inset ring-blue-400' : ''}`}>
                  <div className={`text-[11px] font-semibold mb-1 ${inMonth ? 'text-gray-700' : 'text-gray-300'} ${isToday ? 'text-blue-600' : ''}`}>{d.getDate()}</div>
                  <div className="space-y-1">
                    {dayEntries.map(e => <EntryChip key={e.id} e={e} di={di} />)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {days.map(d => {
            const di = iso(d)
            const isToday = di === todayIso
            const dayEntries = byDay.get(di) ?? []
            return (
              <div key={di} className={`rounded-2xl border p-3 min-h-44 ${isToday ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200 bg-gray-50'}`}>
                <div className="mb-2 px-1">
                  <p className="text-xs font-semibold text-gray-700">{d.toLocaleDateString('en-US', { weekday: 'short' })}</p>
                  <p className="text-xs text-gray-400">{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                </div>
                <div className="space-y-1.5">
                  {dayEntries.map(e => <EntryChip key={e.id} e={e} di={di} />)}
                  {dayEntries.length === 0 && <p className="text-xs text-gray-300 px-1">—</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add form */}
      {canWrite && (
        <div className="rp-card p-5 max-w-2xl mt-6">
          <h3 className="font-semibold text-gray-900 mb-3">Add to Schedule</h3>
          <ScheduleEntryForm action={saveScheduleEntry.bind(null, null)} jobs={(jobs ?? []) as Job[]} defaultDate={rangeStart} />
        </div>
      )}
    </div>
  )
}
