// ── Unified calendar data layer (server-side only) ──
// One event shape both the Maintenance and Construction layers produce, so the
// calendar page renders them the same way and layer toggles are trivial.
// Each domain has its own loader; they never know about each other.

import type { SupabaseClient } from '@supabase/supabase-js'
import { stageMeta } from './construction'

export type CalendarLayer = 'construction' | 'maintenance'

export type CalendarEvent = {
  id: string
  date: string            // YYYY-MM-DD (the day it sits on)
  layer: CalendarLayer
  category: string        // e.g. 'schedule' | 'time_off' | 'inspection' | 'registration' | 'brake' | 'tire'
  title: string
  subtitle?: string | null
  href: string | null     // click-through to the underlying record
  className: string       // Tailwind chip color classes
}

// Category → chip color. Keeps the calendar visually legible per layer/kind.
export const CATEGORY_META: Record<string, { label: string; className: string; layer: CalendarLayer }> = {
  // Construction
  schedule:   { label: 'Scheduled work', className: 'bg-blue-100 text-blue-800 border-blue-200',       layer: 'construction' },
  time_off:   { label: 'Time off',        className: 'bg-gray-100 text-gray-600 border-gray-200',        layer: 'construction' },
  note:       { label: 'Note',            className: 'bg-amber-100 text-amber-800 border-amber-200',     layer: 'construction' },
  // Maintenance
  inspection: { label: 'State inspection', className: 'bg-purple-100 text-purple-800 border-purple-200', layer: 'maintenance' },
  registration:{ label: 'Registration',   className: 'bg-teal-100 text-teal-800 border-teal-200',        layer: 'maintenance' },
  brake:      { label: 'Brake inspection', className: 'bg-rose-100 text-rose-800 border-rose-200',        layer: 'maintenance' },
  tire:       { label: 'Tire inspection',  className: 'bg-orange-100 text-orange-800 border-orange-200',  layer: 'maintenance' },
}

// ── Construction layer: schedule entries in [start, end] ──
export async function loadConstructionCalendar(
  admin: SupabaseClient, companyId: string, start: string, end: string,
): Promise<CalendarEvent[]> {
  const { data: entries } = await admin.from('con_schedule_entries').select('*')
    .eq('company_id', companyId).gte('schedule_date', start).lte('schedule_date', end)
  // Only the jobs these entries actually reference — fetching every job in the
  // company here silently caps at Supabase's default 1000 rows once completed
  // work piles up.
  const jobIds = [...new Set((entries ?? []).map(e => e.job_id).filter((id): id is string => !!id))]
  const { data: jobs } = jobIds.length
    ? await admin.from('con_jobs').select('id, site_number, stage, scope_of_work').in('id', jobIds)
    : { data: [] }
  const jobById = new Map((jobs ?? []).map(j => [j.id, j]))

  return (entries ?? []).map((e): CalendarEvent => {
    const job = e.job_id ? jobById.get(e.job_id) : null
    const type = (e.entry_type as string) ?? 'job'
    const category = type === 'time_off' ? 'time_off' : type === 'note' ? 'note' : 'schedule'
    // A job entry borrows its linked job's stage color; otherwise use the category color.
    const className = category === 'schedule' && job
      ? stageMeta(job.stage).className
      : CATEGORY_META[category].className
    return {
      id: e.id,
      date: e.schedule_date,
      layer: 'construction',
      category,
      title: e.site_number || job?.site_number || e.task_description || 'Scheduled',
      subtitle: e.task_description || job?.scope_of_work || (e.crew?.length ? e.crew.join(', ') : e.equipment) || null,
      href: job ? `/construction/jobs/${job.id}` : null,
      className,
    }
  })
}

// ── Maintenance layer: asset due-dates in [start, end] ──
// Oil changes are mileage-based (no scheduled date), so they never appear here.
type AssetRow = {
  id: string; unit_number: string | null; name: string | null; status: string | null
  next_brake_inspection_date: string | null; next_tire_inspection_date: string | null
  inspection_due_date: string | null; registration_due_date: string | null
}

export async function loadMaintenanceCalendar(
  admin: SupabaseClient, companyId: string, start: string, end: string,
): Promise<CalendarEvent[]> {
  const { data: assets } = await admin.from('assets')
    .select('id, unit_number, name, status, next_brake_inspection_date, next_tire_inspection_date, inspection_due_date, registration_due_date')
    .eq('company_id', companyId)

  const events: CalendarEvent[] = []
  const inRange = (d: string | null): d is string => !!d && d >= start && d <= end
  const push = (a: AssetRow, date: string, category: string, label: string) => {
    events.push({
      id: `${a.id}-${category}`,
      date,
      layer: 'maintenance',
      category,
      title: a.unit_number || a.name || 'Asset',
      subtitle: label,
      href: `/assets/${a.id}`,
      className: CATEGORY_META[category].className,
    })
  }

  for (const a of (assets ?? []) as AssetRow[]) {
    if (a.status === 'retired') continue
    if (inRange(a.inspection_due_date)) push(a, a.inspection_due_date, 'inspection', 'State inspection due')
    if (inRange(a.registration_due_date)) push(a, a.registration_due_date, 'registration', 'Registration due')
    if (inRange(a.next_brake_inspection_date)) push(a, a.next_brake_inspection_date, 'brake', 'Brake inspection due')
    if (inRange(a.next_tire_inspection_date)) push(a, a.next_tire_inspection_date, 'tire', 'Tire inspection due')
  }
  return events
}
