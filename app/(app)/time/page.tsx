import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/page-header'
import { StatusPill } from '@/components/ui/status-pill'
import { buttonVariants } from '@/components/ui/button'
import { FixFields, FormMessage } from '@/components/time/fix-form'
import { PAYROLL_ROLES, addDaysTo, hoursText, isTimeManager, nyDateLabel, nyDay, nyRange, nyTime } from '@/lib/time-clock'
import { requestTimeFix } from './actions'

type Row = {
  id: string; profile_id: string; clock_in: string; clock_out: string | null; total_minutes: number | null; break_minutes: number | null
  is_approved: boolean; manually_adjusted: boolean; needs_review: boolean; review_reason: string | null; auto_clocked_out_at: string | null
  source: string; store_number: string | null; fix_requested_at: string | null
  profiles: { full_name: string } | null; con_jobs: { site_number: string | null } | null
}

export default async function TimeEntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; approved?: string; done?: string; error?: string; fix?: string }>
}) {
  const sp = await searchParams
  const { employee: empFilter, approved: approvedFilter } = sp

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id, role, id').eq('id', user!.id).single()

  const isManager = isTimeManager(profile?.role)
  const seesPayroll = PAYROLL_ROLES.includes(profile?.role ?? '')

  // Last 30 Eastern days
  const today = nyDay(new Date())
  const { from } = nyRange(addDaysTo(today, -30), today)

  let query = admin
    .from('time_clock_entries')
    .select('id, profile_id, clock_in, clock_out, total_minutes, break_minutes, is_approved, manually_adjusted, needs_review, review_reason, auto_clocked_out_at, source, store_number, fix_requested_at, profiles!time_clock_entries_profile_id_fkey(full_name), con_jobs(site_number)')
    .eq('company_id', profile!.company_id)
    .gte('clock_in', from)
    .order('clock_in', { ascending: false })
    .limit(isManager ? 600 : 100)

  // Non-managers can only see their own
  if (!isManager) query = query.eq('profile_id', profile!.id)
  else if (empFilter) query = query.eq('profile_id', empFilter)

  if (approvedFilter === 'pending') query = query.eq('is_approved', false).not('clock_out', 'is', null)
  if (approvedFilter === 'approved') query = query.eq('is_approved', true)
  if (approvedFilter === 'fix') query = query.or('needs_review.eq.true,fix_requested_at.not.is.null')

  const { data } = await query
  const entries = (data ?? []) as unknown as Row[]

  // Everyone who has time in the window, for the manager's picker.
  const { data: people } = isManager
    ? await admin.from('profiles').select('id, full_name').eq('company_id', profile!.company_id).eq('is_active', true).order('full_name')
    : { data: null }

  const pendingCount = entries.filter(e => !e.is_approved && e.clock_out && !e.needs_review).length
  const fixCount = entries.filter(e => e.needs_review || e.fix_requested_at).length
  const cols = isManager ? 8 : 7
  const href = (o: { approved?: string; employee?: string }) => {
    const q = new URLSearchParams()
    const a = o.approved ?? approvedFilter ?? '', e = o.employee ?? empFilter ?? ''
    if (a) q.set('approved', a)
    if (e) q.set('employee', e)
    return `/time${q.size ? `?${q}` : ''}`
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Time Entries"
        description={isManager ? 'Last 30 days, everyone.' : 'Your last 30 days. If a shift is wrong, press "My time is wrong" on it.'}
        actions={<>
          {isManager && (fixCount > 0 || pendingCount > 0) && (
            <Link href="/time/approvals" className={buttonVariants({ variant: fixCount > 0 ? 'default' : 'outline' })}>
              {fixCount > 0 ? `${fixCount} to fix` : `${pendingCount} to approve`}
            </Link>
          )}
          {isManager && fixCount === 0 && pendingCount === 0 && <Link href="/time/approvals" className={buttonVariants({ variant: 'outline' })}>Fix &amp; Approve</Link>}
          {seesPayroll && <Link href="/reports/payroll" className={buttonVariants({ variant: 'outline' })}>Payroll report</Link>}
        </>}
      />
      <FormMessage done={sp.done} error={sp.error} />

      {/* Filters */}
      {isManager && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          {[
            { value: '', label: 'All' },
            { value: 'fix', label: 'Needs fixing' },
            { value: 'pending', label: 'Waiting for approval' },
            { value: 'approved', label: 'Approved' },
          ].map(f => (
            <Link key={f.value} href={href({ approved: f.value })} className="rp-chip" aria-current={(approvedFilter ?? '') === f.value ? 'true' : undefined}>{f.label}</Link>
          ))}
          <form action="/time" className="ml-auto flex items-center gap-2">
            {approvedFilter && <input type="hidden" name="approved" value={approvedFilter} />}
            <select name="employee" defaultValue={empFilter ?? ''} className="rp-input w-auto" aria-label="Employee">
              <option value="">Everyone</option>
              {(people ?? []).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
            <button type="submit" className={buttonVariants({ variant: 'outline', size: 'sm' })}>Show</button>
          </form>
        </div>
      )}

      <div className="rp-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="rp-table w-full text-sm">
            <thead>
              <tr>
                {isManager && <th className="text-left px-4 py-2.5">Employee</th>}
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
              {entries.map(e => {
                const mine = e.profile_id === profile!.id
                const canAsk = mine && !!e.clock_out && !e.is_approved
                return [
                  <tr key={e.id} className="border-t border-hairline">
                    {isManager && <td className="px-4 py-3 text-foreground whitespace-nowrap">{e.profiles?.full_name ?? '—'}</td>}
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">{nyDateLabel(e.clock_in)}</td>
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap">{nyTime(e.clock_in)}</td>
                    <td className="px-4 py-3 tabular-nums whitespace-nowrap">
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
                      {e.manually_adjusted && e.source !== 'truck_log' && <span className="ml-1.5 text-xs text-muted-foreground" title="Changed by a manager">edited</span>}
                      {isManager && !e.is_approved && e.clock_out && <Link href={`/time/approvals?edit=${e.id}`} className="ml-2 text-xs font-semibold text-brand hover:underline">Fix</Link>}
                    </td>
                  </tr>,
                  (e.needs_review && e.review_reason) || canAsk ? (
                    <tr key={e.id + ':more'}>
                      <td colSpan={cols} className="px-4 pb-3">
                        {e.needs_review && e.review_reason && <p className="text-xs text-danger">{e.review_reason}</p>}
                        {canAsk && (
                          <details className="mt-1" open={sp.fix === e.id}>
                            <summary className="cursor-pointer select-none text-xs font-semibold text-brand">{e.fix_requested_at ? 'Change what I sent in' : 'My time is wrong'}</summary>
                            <form action={requestTimeFix} className="mt-2 rounded-lg border border-hairline bg-raised p-4">
                              <input type="hidden" name="id" value={e.id} />
                              <FixFields clockIn={e.clock_in} clockOut={e.auto_clocked_out_at ? null : e.clock_out} breakMinutes={e.break_minutes}
                                noteLabel="What happened" notePlaceholder="Forgot to clock out, left the shop at 5:15" />
                              <button type="submit" className={buttonVariants({ className: 'mt-3', size: 'sm' })}>Send to my manager</button>
                            </form>
                          </details>
                        )}
                      </td>
                    </tr>
                  ) : null,
                ]
              })}
              {!entries.length && (
                <tr><td colSpan={cols} className="px-4 py-8 text-center text-sm text-muted-foreground">No time entries found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
