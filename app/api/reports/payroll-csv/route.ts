import { NextRequest, NextResponse } from 'next/server'
import { toCsv } from '@/lib/csv'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PAYROLL_ROLES, hoursText, isDay, nyDay, nyRange, nyTime, payWeekOf, splitOvertime } from '@/lib/time-clock'

type Row = {
  profile_id: string; clock_in: string; clock_out: string | null; total_minutes: number | null; break_minutes: number | null
  is_approved: boolean; manually_adjusted: boolean; adjustment_note: string | null; notes: string | null; needs_review: boolean
  review_reason: string | null; source: string; store_number: string | null
  profiles: { full_name: string; email: string } | null; con_jobs: { site_number: string | null } | null
}
const usDate = (day: string) => `${day.slice(5, 7)}/${day.slice(8, 10)}/${day.slice(0, 4)}`

// Every shift in the range (Eastern days, both included), then a summary block: regular / overtime per person.
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id, role').eq('id', user.id).single()
  if (!profile || !PAYROLL_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const today = nyDay(new Date())
  const s = searchParams.get('start'), e = searchParams.get('end')
  const start = isDay(s) ? s : today
  const end = isDay(e) && e >= start ? e : start
  const empId = searchParams.get('employee')
  const { from, before } = nyRange(start, end)

  const entries: Row[] = []
  for (let page = 0; page < 20; page++) {
    let q = admin
      .from('time_clock_entries')
      .select('profile_id, clock_in, clock_out, total_minutes, break_minutes, is_approved, manually_adjusted, adjustment_note, notes, needs_review, review_reason, source, store_number, profiles!time_clock_entries_profile_id_fkey(full_name, email), con_jobs(site_number)')
      .eq('company_id', profile.company_id)
      .gte('clock_in', from).lt('clock_in', before)
      .order('clock_in', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (empId && /^[0-9a-f-]{36}$/i.test(empId)) q = q.eq('profile_id', empId)
    const { data } = await q
    entries.push(...((data ?? []) as unknown as Row[]))
    if ((data ?? []).length < 1000) break
  }

  const rows: unknown[][] = [
    ['Employee', 'Email', 'Date', 'Pay Week Ending', 'Clock In', 'Clock Out', 'Unpaid Break (min)', 'Paid Hours', 'Site', 'Approved', 'Needs Fixing', 'Source', 'Changed By Hand', 'Notes'],
  ]
  const byPerson = new Map<string, { name: string; days: Record<string, number> }>()
  for (const r of entries) {
    const day = nyDay(r.clock_in)
    const name = r.profiles?.full_name ?? ''
    rows.push([
      name,
      r.profiles?.email ?? '',
      usDate(day),
      usDate(payWeekOf(day).end),
      nyTime(r.clock_in),
      r.clock_out ? nyTime(r.clock_out) : 'still on the clock',
      r.break_minutes ?? 0,
      r.clock_out ? hoursText(r.total_minutes) : '',
      r.con_jobs?.site_number ?? r.store_number ?? '',
      r.is_approved ? 'Yes' : 'No',
      r.needs_review ? (r.review_reason ?? 'Yes') : '',
      r.source === 'truck_log' ? 'Truck log' : r.source === 'manager' ? 'Added by hand' : 'Clock',
      r.manually_adjusted ? 'Yes' : 'No',
      [r.notes, r.adjustment_note].filter(Boolean).join(' | '),
    ])
    if (!r.clock_out) continue
    const p = byPerson.get(r.profile_id) ?? { name, days: {} }
    p.days[day] = (p.days[day] ?? 0) + (r.total_minutes ?? 0)
    byPerson.set(r.profile_id, p)
  }

  rows.push([], ['SUMMARY', `${usDate(start)} to ${usDate(end)}`, 'Overtime = past 40 hours in a pay week (Thursday through Wednesday)'])
  rows.push(['Employee', 'Pay Week Ending', 'Regular Hours', 'Overtime Hours', 'Total Hours'])
  for (const p of [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const w of splitOvertime(p.days).weeks) {
      rows.push([p.name, usDate(w.end), hoursText(w.minutes - w.overtime), hoursText(w.overtime), hoursText(w.minutes)])
    }
  }

  return new NextResponse(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="payroll_${start}_${end}.csv"`,
    },
  })
}
