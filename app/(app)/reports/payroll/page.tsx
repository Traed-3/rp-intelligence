import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { bulkApprove } from '../../time/actions'
import { Download } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { StatusPill } from '@/components/ui/status-pill'
import { buttonVariants } from '@/components/ui/button'
import { PAYROLL_ROLES, addDaysTo, hoursText, isDay, nyDateLabel, nyDay, nyRange, nyTime, payWeekOf, splitOvertime } from '@/lib/time-clock'

// ── Periods (Eastern days; the pay week runs Thursday through Wednesday) ──────

function getPeriodRange(period: string, customStart?: string, customEnd?: string): { start: string; end: string; label: string } {
  const today = nyDay(new Date())
  const [y, m] = today.split('-').map(Number)
  const monthEnd = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10)   // mm is 1-based: day 0 of the next month
  const first = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-01`

  if (period === 'last_week') {
    const w = payWeekOf(addDaysTo(today, -7))
    return { ...w, label: 'Last Pay Week' }
  }
  if (period === 'this_month') return { start: first(y, m), end: monthEnd(y, m), label: 'This Month' }
  if (period === 'last_month') {
    const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1
    return { start: first(ly, lm), end: monthEnd(ly, lm), label: 'Last Month' }
  }
  if (period === 'custom' && isDay(customStart) && isDay(customEnd) && customStart <= customEnd) {
    // Keep a hand-typed range to a size the grid can show.
    const end = customEnd > addDaysTo(customStart, 61) ? addDaysTo(customStart, 61) : customEnd
    return { start: customStart, end, label: 'Custom Range' }
  }
  return { ...payWeekOf(today), label: 'This Pay Week' }
}

const dayHead = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'numeric', day: 'numeric' })
const longDay = (day: string, year = false) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) })

type Row = {
  id: string; profile_id: string; clock_in: string; clock_out: string | null; total_minutes: number | null; break_minutes: number | null
  is_approved: boolean; manually_adjusted: boolean; needs_review: boolean; auto_clocked_out_at: string | null; source: string
  store_number: string | null; fix_requested_at: string | null; con_jobs: { site_number: string | null } | null
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; start?: string; end?: string; employee?: string }>
}) {
  const { period = 'this_week', start: customStart, end: customEnd, employee: empFilter } =
    await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id, role').eq('id', user!.id).single()

  if (!profile || !PAYROLL_ROLES.includes(profile.role)) {
    redirect('/dashboard')
  }

  const { start, end, label } = getPeriodRange(period, customStart, customEnd)
  const { from, before } = nyRange(start, end)

  // Time entries for this period (past the 1,000-row page size)
  const entries: Row[] = []
  for (let page = 0; page < 10; page++) {
    let q = admin
      .from('time_clock_entries')
      .select('id, profile_id, clock_in, clock_out, total_minutes, break_minutes, is_approved, manually_adjusted, needs_review, auto_clocked_out_at, source, store_number, fix_requested_at, con_jobs(site_number)')
      .eq('company_id', profile.company_id)
      .gte('clock_in', from)
      .lt('clock_in', before)
      .order('clock_in')
      .range(page * 1000, page * 1000 + 999)
    if (empFilter) q = q.eq('profile_id', empFilter)
    const { data } = await q
    entries.push(...((data ?? []) as unknown as Row[]))
    if ((data ?? []).length < 1000) break
  }

  // Everyone active (for the picker), and the name of anyone with time in the period, active or not.
  const { data: everyone } = await admin
    .from('profiles').select('id, full_name, is_active').eq('company_id', profile.company_id).order('full_name')
  const nameOf = new Map((everyone ?? []).map(p => [p.id as string, p.full_name as string]))

  // Per-employee per-day minutes, by Eastern day
  const empDayMap: Record<string, Record<string, number>> = {}
  for (const e of entries) {
    if (!e.clock_out) continue                       // only closed entries count
    const day = nyDay(e.clock_in)
    const byDay = (empDayMap[e.profile_id] ??= {})
    byDay[day] = (byDay[day] ?? 0) + (e.total_minutes ?? 0)
  }
  const rows = Object.keys(empDayMap)
    .map(id => ({ id, name: nameOf.get(id) ?? 'Unknown', days: empDayMap[id], ...splitOvertime(empDayMap[id]) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  // People with only an open or unfixed entry still get a line.
  for (const e of entries) if (!empDayMap[e.profile_id] && !rows.some(r => r.id === e.profile_id)) rows.push({ id: e.profile_id, name: nameOf.get(e.profile_id) ?? 'Unknown', days: {}, regular: 0, overtime: 0, weeks: [] })

  const days: string[] = []
  for (let d = start; d <= end; d = addDaysTo(d, 1)) days.push(d)
  const wide = days.length > 14               // a month: totals only, no day columns

  const totalReg = rows.reduce((s, r) => s + r.regular, 0)
  const totalOt = rows.reduce((s, r) => s + r.overtime, 0)
  const unapprovedCount = entries.filter(e => !e.is_approved && e.clock_out && !e.needs_review).length
  const needFix = entries.filter(e => e.needs_review || e.fix_requested_at)
  const stillOpen = entries.filter(e => !e.clock_out)
  // Overtime is counted per pay week, so a range that cuts a pay week in half under-counts it.
  const cutsWeek = payWeekOf(start).start !== start || payWeekOf(end).end !== end

  // Bulk approve action
  async function handleBulkApprove() {
    'use server'
    await bulkApprove(start, end)
  }

  const csvUrl = `/api/reports/payroll-csv?start=${start}&end=${end}${empFilter ? `&employee=${empFilter}` : ''}`
  const emp = empFilter ? `&employee=${empFilter}` : ''

  const PERIODS = [
    { value: 'this_week',   label: 'This Pay Week' },
    { value: 'last_week',   label: 'Last Pay Week' },
    { value: 'this_month',  label: 'This Month' },
    { value: 'last_month',  label: 'Last Month' },
  ]
  const prev = payWeekOf(addDaysTo(start, -1)), next = payWeekOf(addDaysTo(end, 1))

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Payroll Report"
        description={`${label} · ${longDay(start)} to ${longDay(end, true)} · pay week runs Thursday through Wednesday`}
        crumbs={[{ label: 'Reports', href: '/reports' }, { label: 'Payroll' }]}
        actions={<>
          <Link href="/time/approvals" className={buttonVariants({ variant: 'outline' })}>Fix &amp; Approve</Link>
          <a href={csvUrl} className={buttonVariants({ variant: 'success' })}><Download className="w-4 h-4" />Export CSV</a>
        </>}
      />

      {/* Period + employee filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {PERIODS.map(p => (
          <Link key={p.value} href={`/reports/payroll?period=${p.value}${emp}`} className="rp-chip" aria-current={period === p.value ? 'true' : undefined}>{p.label}</Link>
        ))}
        <Link href={`/reports/payroll?period=custom&start=${prev.start}&end=${prev.end}${emp}`} className="rp-chip" title="The pay week before">← Week before</Link>
        <Link href={`/reports/payroll?period=custom&start=${next.start}&end=${next.end}${emp}`} className="rp-chip" title="The pay week after">Week after →</Link>
      </div>
      <form action="/reports/payroll" className="flex flex-wrap items-end gap-2 mb-6">
        <input type="hidden" name="period" value="custom" />
        <label className="block"><span className="rp-label">From</span><input type="date" name="start" defaultValue={start} required className="rp-input mt-1 w-auto" /></label>
        <label className="block"><span className="rp-label">Through</span><input type="date" name="end" defaultValue={end} required className="rp-input mt-1 w-auto" /></label>
        <label className="block"><span className="rp-label">Employee</span>
          <select name="employee" defaultValue={empFilter ?? ''} className="rp-input mt-1 w-auto">
            <option value="">Everyone</option>
            {(everyone ?? []).filter(p => p.is_active || empDayMap[p.id as string]).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </label>
        <button type="submit" className={buttonVariants({ variant: 'outline' })}>Show</button>
      </form>

      {(needFix.length > 0 || stillOpen.length > 0) && (
        <div className="mb-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-foreground">
          <p className="font-semibold text-danger">Not ready for payroll yet</p>
          <p className="mt-0.5">
            {needFix.length > 0 && <>{needFix.length} shift{needFix.length === 1 ? '' : 's'} need{needFix.length === 1 ? 's' : ''} fixing ({[...new Set(needFix.map(e => nameOf.get(e.profile_id) ?? 'Unknown'))].join(', ')}). </>}
            {stillOpen.length > 0 && <>{stillOpen.length} still on the clock ({[...new Set(stillOpen.map(e => nameOf.get(e.profile_id) ?? 'Unknown'))].join(', ')}); open shifts count as 0 hours. </>}
            <Link href="/time/approvals" className="font-semibold text-brand hover:underline">Fix them</Link>
          </p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="rp-card p-4 text-center">
          <p className="text-2xl font-bold text-foreground tabular-nums">{hoursText(totalReg + totalOt)}</p>
          <p className="text-xs font-medium text-muted-foreground mt-0.5">Total Hours</p>
        </div>
        <div className="rp-card p-4 text-center">
          <p className="text-2xl font-bold text-foreground tabular-nums">{hoursText(totalOt)}</p>
          <p className="text-xs font-medium text-muted-foreground mt-0.5">Overtime (past 40 in a pay week)</p>
        </div>
        <div className="rp-card p-4 text-center">
          <p className="text-2xl font-bold text-foreground tabular-nums">{entries.filter(e => e.clock_out).length}</p>
          <p className="text-xs font-medium text-muted-foreground mt-0.5">Shifts · {rows.length} people</p>
        </div>
        <div className="rp-card p-4 text-center">
          <p className={`text-2xl font-bold tabular-nums ${unapprovedCount > 0 ? 'text-warning' : 'text-foreground'}`}>{unapprovedCount}</p>
          <p className="text-xs font-medium text-muted-foreground mt-0.5">Waiting for Approval</p>
        </div>
      </div>

      {/* Hours grid */}
      <div className="rp-card overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-hairline flex items-center justify-between gap-3">
          <h2 className="rp-card-title">Hours by Employee</h2>
          {unapprovedCount > 0 && (
            <form action={handleBulkApprove}>
              <button type="submit" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Approve All ({unapprovedCount})
              </button>
            </form>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="rp-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                {!wide && days.map(day => (
                  <th key={day} className="text-center px-2 py-2.5 whitespace-nowrap min-w-[64px]">{dayHead(day)}</th>
                ))}
                <th className="text-right px-3 py-2.5">Regular</th>
                <th className="text-right px-3 py-2.5">Overtime</th>
                <th className="text-right px-4 py-2.5">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-hairline">
                  <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                    <Link href={`/time?employee=${r.id}`} className="hover:underline">{r.name}</Link>
                  </td>
                  {!wide && days.map(day => {
                    const mins = r.days[day] ?? 0
                    return (
                      <td key={day} className={`text-center px-2 py-3 tabular-nums ${mins === 0 ? 'text-muted-foreground/50' : mins > 12 * 60 ? 'text-warning font-semibold' : 'text-foreground'}`}>
                        {mins > 0 ? hoursText(mins) : '—'}
                      </td>
                    )
                  })}
                  <td className="text-right px-3 py-3 tabular-nums">{hoursText(r.regular)}</td>
                  <td className={`text-right px-3 py-3 tabular-nums ${r.overtime > 0 ? 'font-semibold text-warning' : 'text-muted-foreground/50'}`}>{r.overtime > 0 ? hoursText(r.overtime) : '—'}</td>
                  <td className="text-right px-4 py-3 font-bold text-foreground tabular-nums">{hoursText(r.regular + r.overtime)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={(wide ? 0 : days.length) + 4} className="px-4 py-8 text-center text-sm text-muted-foreground">No time on the clock for this period.</td></tr>}
              {rows.length > 0 && (
                <tr className="border-t-2 border-hairline bg-raised">
                  <td className="px-4 py-3 font-bold text-foreground">Total</td>
                  {!wide && days.map(day => {
                    const dayTotal = rows.reduce((s, r) => s + (r.days[day] ?? 0), 0)
                    return <td key={day} className="text-center px-2 py-3 font-bold tabular-nums">{dayTotal > 0 ? hoursText(dayTotal) : '—'}</td>
                  })}
                  <td className="text-right px-3 py-3 font-bold tabular-nums">{hoursText(totalReg)}</td>
                  <td className="text-right px-3 py-3 font-bold tabular-nums">{hoursText(totalOt)}</td>
                  <td className="text-right px-4 py-3 font-bold tabular-nums">{hoursText(totalReg + totalOt)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {cutsWeek && <p className="px-5 py-2.5 border-t border-hairline text-xs text-muted-foreground">These dates start or stop in the middle of a pay week, so overtime only counts the hours inside the dates. For payroll, use a whole pay week.</p>}
      </div>

      {/* Detailed entries */}
      <div className="rp-card overflow-hidden">
        <div className="px-5 py-3 border-b border-hairline">
          <h2 className="rp-card-title">Every Shift</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="rp-table w-full text-sm">
            <thead>
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Clock In</th>
                <th className="text-left px-4 py-2.5">Clock Out</th>
                <th className="text-right px-4 py-2.5">Break</th>
                <th className="text-right px-4 py-2.5">Hours</th>
                <th className="text-left px-4 py-2.5">Site</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className="border-t border-hairline">
                  <td className="px-4 py-3 text-foreground whitespace-nowrap">{nameOf.get(e.profile_id) ?? '—'}</td>
                  <td className="px-4 py-3 text-foreground whitespace-nowrap">{nyDateLabel(e.clock_in)}</td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums">{nyTime(e.clock_in)}</td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                    {!e.clock_out ? <span className="font-medium text-success">On the clock</span>
                      : e.auto_clocked_out_at ? <span className="text-danger">Never clocked out</span>
                      : nyTime(e.clock_out)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{e.break_minutes ? `${e.break_minutes}m` : ''}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{e.clock_out ? hoursText(e.total_minutes) : '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{e.con_jobs?.site_number ?? e.store_number ?? ''}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {e.needs_review ? <StatusPill tone="danger">Needs fixing</StatusPill>
                      : e.fix_requested_at ? <StatusPill tone="info">Correction sent</StatusPill>
                      : e.is_approved ? <StatusPill tone="success">Approved</StatusPill>
                      : e.clock_out ? <StatusPill tone="warning">Waiting</StatusPill>
                      : <StatusPill tone="neutral">Open</StatusPill>}
                    {!e.is_approved && e.clock_out && <Link href={`/time/approvals?edit=${e.id}`} className="ml-2 text-xs font-semibold text-brand hover:underline">Fix</Link>}
                  </td>
                </tr>
              ))}
              {!entries.length && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No time entries for this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
