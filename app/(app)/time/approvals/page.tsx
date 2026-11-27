import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/page-header'
import { StatusPill } from '@/components/ui/status-pill'
import { buttonVariants } from '@/components/ui/button'
import { FixFields, FormMessage } from '@/components/time/fix-form'
import { AUTO_OUT_HOURS, hoursSince, hoursText, isTimeManager, nyDateLabel, nyTime } from '@/lib/time-clock'
import { addTimeEntry, applyFixRequest, approveEntryForm, deleteTimeEntry, dismissFixRequest, fixTimeEntry } from '../actions'

type Row = {
  id: string; profile_id: string; clock_in: string; clock_out: string | null; total_minutes: number | null; break_minutes: number | null
  is_approved: boolean; manually_adjusted: boolean; adjustment_note: string | null; notes: string | null; needs_review: boolean
  review_reason: string | null; auto_clocked_out_at: string | null; source: string; store_number: string | null
  fix_requested_at: string | null; fix_requested_in: string | null; fix_requested_out: string | null; fix_requested_break: number | null; fix_request_note: string | null
  original_clock_in: string | null; original_clock_out: string | null
  profiles: { full_name: string } | null; con_jobs: { site_number: string | null } | null
}
const COLS = 'id, profile_id, clock_in, clock_out, total_minutes, break_minutes, is_approved, manually_adjusted, adjustment_note, notes, needs_review, review_reason, auto_clocked_out_at, source, store_number, fix_requested_at, fix_requested_in, fix_requested_out, fix_requested_break, fix_request_note, original_clock_in, original_clock_out, profiles!time_clock_entries_profile_id_fkey(full_name), con_jobs(site_number)'

const span = (r: { clock_in: string; clock_out: string | null }) => `${nyTime(r.clock_in)} to ${r.clock_out ? nyTime(r.clock_out) : 'still on the clock'}`
const site = (r: Row) => r.con_jobs?.site_number ?? r.store_number ?? null

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string; edit?: string; add?: string }> }) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin.from('profiles').select('company_id, role').eq('id', user!.id).single()
  if (!profile || !isTimeManager(profile.role)) redirect('/dashboard')
  const canDelete = ['owner', 'manager'].includes(profile.role)

  const base = () => admin.from('time_clock_entries').select(COLS).eq('company_id', profile.company_id)
  const [{ data: openRaw }, { data: fixRaw }, { data: pendingRaw }, { data: people }] = await Promise.all([
    base().is('clock_out', null).order('clock_in').limit(100),
    base().not('clock_out', 'is', null).or('needs_review.eq.true,fix_requested_at.not.is.null').order('clock_in', { ascending: false }).limit(100),
    base().eq('is_approved', false).eq('needs_review', false).is('fix_requested_at', null).not('clock_out', 'is', null).order('clock_in', { ascending: false }).limit(1000),
    admin.from('profiles').select('id, full_name').eq('company_id', profile.company_id).eq('is_active', true).order('full_name'),
  ])
  const open = (openRaw ?? []) as unknown as Row[]
  const fix = (fixRaw ?? []) as unknown as Row[]
  const pending = (pendingRaw ?? []) as unknown as Row[]

  // Waiting-for-approval entries, one block per person.
  const byPerson = new Map<string, { name: string; rows: Row[]; mins: number }>()
  for (const r of pending) {
    const g = byPerson.get(r.profile_id) ?? { name: r.profiles?.full_name ?? 'Unknown', rows: [], mins: 0 }
    g.rows.push(r); g.mins += r.total_minutes ?? 0
    byPerson.set(r.profile_id, g)
  }
  const groups = [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name))

  const FixBox = ({ r, label = 'Fix the time', useRequest = false }: { r: Row; label?: string; useRequest?: boolean }) => (
    <details className="mt-3 rounded-lg border border-hairline bg-raised" open={sp.edit === r.id}>
      <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-semibold text-foreground">{label}</summary>
      <div className="border-t border-hairline p-4">
        <form action={fixTimeEntry}>
          <input type="hidden" name="id" value={r.id} />
          <FixFields
            clockIn={useRequest && r.fix_requested_in ? r.fix_requested_in : r.clock_in}
            clockOut={useRequest && r.fix_requested_out ? r.fix_requested_out : r.auto_clocked_out_at ? null : r.clock_out}
            breakMinutes={useRequest && r.fix_requested_break != null ? r.fix_requested_break : r.break_minutes}
            notePlaceholder="Why it changed: forgot to clock out, left at 5:15 per Ernie"
          />
          <button type="submit" className={buttonVariants({ className: 'mt-3' })}>Save the fix</button>
        </form>
        {canDelete && (
          <form action={deleteTimeEntry} className="mt-4 flex flex-wrap items-center gap-3 border-t border-hairline pt-3">
            <input type="hidden" name="id" value={r.id} />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" name="sure" className="size-4" /> This entry is a double or a mistake
            </label>
            <button type="submit" className={buttonVariants({ variant: 'destructive', size: 'sm' })}>Delete entry</button>
          </form>
        )}
      </div>
    </details>
  )

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Fix & Approve Time"
        description="Catch a missed clock-out, correct a shift, add a missed day, then approve it for payroll."
        crumbs={[{ label: 'Time Entries', href: '/time' }, { label: 'Fix & Approve' }]}
        actions={<Link href="/reports/payroll" className={buttonVariants({ variant: 'outline' })}>Payroll report</Link>}
      />
      <FormMessage done={sp.done} error={sp.error} />

      {/* ── Still on the clock ── */}
      {open.length > 0 && (
        <section className="mb-8">
          <h2 className="rp-card-title mb-2">On the clock now ({open.length})</h2>
          <div className="rp-card divide-y divide-hairline">
            {open.map(r => {
              const hrs = hoursSince(r.clock_in)
              const long = hrs >= 12
              return (
                <div key={r.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-foreground">{r.profiles?.full_name ?? 'Unknown'}{site(r) && <span className="ml-2 text-sm font-normal text-muted-foreground">{site(r)}</span>}</p>
                      <p className="text-sm text-muted-foreground">Clocked in {nyDateLabel(r.clock_in)} at {nyTime(r.clock_in)}</p>
                    </div>
                    <StatusPill tone={long ? 'danger' : 'success'} dot>{hrs.toFixed(1)} hours{long ? ', probably forgot' : ''}</StatusPill>
                  </div>
                  {long && <p className="mt-1 text-xs text-muted-foreground">The clock stops itself at {AUTO_OUT_HOURS} hours. Enter the real clock-out here to close it now.</p>}
                  {long && <FixBox r={r} label="Enter the clock-out" />}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Needs fixing ── */}
      <section className="mb-8">
        <h2 className="rp-card-title mb-2">Needs fixing ({fix.length})</h2>
        {fix.length === 0 ? (
          <div className="rp-card px-5 py-6 text-sm text-muted-foreground">Nothing to fix. A shift lands here when someone never clocked out, sends in a correction, or the hours do not add up.</div>
        ) : (
          <div className="rp-card divide-y divide-hairline">
            {fix.map(r => (
              <div key={r.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{r.profiles?.full_name ?? 'Unknown'}{site(r) && <span className="ml-2 text-sm font-normal text-muted-foreground">{site(r)}</span>}</p>
                    <p className="text-sm text-muted-foreground">
                      {nyDateLabel(r.clock_in, { year: true })} · {r.auto_clocked_out_at ? `clocked in ${nyTime(r.clock_in)}, never clocked out` : span(r)}
                      {' · '}<span className="font-medium text-foreground">{hoursText(r.total_minutes)} hrs on file</span>
                    </p>
                  </div>
                  <StatusPill tone={r.auto_clocked_out_at ? 'danger' : r.fix_requested_at ? 'info' : 'warning'}>
                    {r.auto_clocked_out_at ? 'Never clocked out' : r.fix_requested_at ? 'Correction sent in' : 'Check the hours'}
                  </StatusPill>
                </div>
                {r.review_reason && <p className="mt-2 text-sm text-foreground">{r.review_reason}</p>}
                {r.notes && <p className="mt-1 text-xs text-muted-foreground">{r.notes}</p>}

                {r.fix_requested_at && r.fix_requested_in && r.fix_requested_out && (
                  <div className="mt-3 rounded-lg border border-info/30 bg-info/10 p-3">
                    <p className="text-sm text-foreground">
                      <span className="font-semibold">{r.profiles?.full_name?.split(' ')[0] ?? 'They'} says:</span>{' '}
                      {nyDateLabel(r.fix_requested_in)}, {nyTime(r.fix_requested_in)} to {nyTime(r.fix_requested_out)}
                      {r.fix_requested_break ? `, ${r.fix_requested_break} min break` : ''}
                    </p>
                    {r.fix_request_note && <p className="mt-1 text-sm text-muted-foreground">&ldquo;{r.fix_request_note}&rdquo;</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <form action={applyFixRequest}><input type="hidden" name="id" value={r.id} /><button type="submit" className={buttonVariants({ variant: 'success', size: 'sm' })}>Use these times</button></form>
                      <form action={dismissFixRequest}><input type="hidden" name="id" value={r.id} /><button type="submit" className={buttonVariants({ variant: 'outline', size: 'sm' })}>Leave it as it was</button></form>
                    </div>
                  </div>
                )}
                <FixBox r={r} label={r.fix_requested_at ? 'Enter different times' : 'Fix the time'} useRequest />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Add a missed day ── */}
      <section className="mb-8">
        <details className="rp-card" open={sp.add === '1'}>
          <summary className="cursor-pointer select-none px-5 py-3.5 font-semibold text-foreground">Add a day someone never clocked in for</summary>
          <form action={addTimeEntry} className="border-t border-hairline p-5">
            <label className="block mb-3 max-w-sm">
              <span className="rp-label">Employee</span>
              <select name="profile_id" required defaultValue="" className="rp-input mt-1">
                <option value="" disabled>Pick a person</option>
                {(people ?? []).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </label>
            <FixFields notePlaceholder="Why it is added by hand: phone was dead, worked 7 to 5 at SU-8001" />
            <button type="submit" className={buttonVariants({ className: 'mt-3' })}>Add the time</button>
          </form>
        </details>
      </section>

      {/* ── Waiting for approval ── */}
      <section>
        <h2 className="rp-card-title mb-2">Waiting for approval ({pending.length})</h2>
        {groups.length === 0 ? (
          <div className="rp-card px-5 py-6 text-sm text-muted-foreground">All caught up. Nothing is waiting for approval.</div>
        ) : groups.map(g => (
          <details key={g.name} className="rp-card mb-3" open={groups.length <= 3 || g.rows.some(r => r.id === sp.edit)}>
            <summary className="cursor-pointer select-none px-5 py-3.5 flex items-center justify-between gap-3">
              <span className="font-semibold text-foreground">{g.name}</span>
              <span className="text-sm text-muted-foreground tabular-nums">{g.rows.length} shift{g.rows.length === 1 ? '' : 's'} · {hoursText(g.mins)} hrs</span>
            </summary>
            <div className="divide-y divide-hairline border-t border-hairline">
              {g.rows.map(r => {
                return (
                  <div key={r.id} id={r.id} className="px-5 py-3.5 scroll-mt-24">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {nyDateLabel(r.clock_in)} · {span(r)}{r.break_minutes ? ` · ${r.break_minutes} min break` : ''}
                          {site(r) && <span className="ml-2 text-muted-foreground font-normal">{site(r)}</span>}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <span className="font-semibold text-foreground tabular-nums">{hoursText(r.total_minutes)} hrs</span>
                          {r.source === 'truck_log' && ' · from the truck log'}{r.source === 'manager' && ' · added by hand'}
                          {r.original_clock_in && r.source !== 'truck_log' && ` · was ${nyTime(r.original_clock_in)} to ${r.original_clock_out ? nyTime(r.original_clock_out) : 'open'}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {sp.edit !== r.id && <Link href={`/time/approvals?edit=${r.id}#${r.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Fix</Link>}
                        <form action={approveEntryForm}><input type="hidden" name="id" value={r.id} /><button type="submit" className={buttonVariants({ variant: 'success', size: 'sm' })}>Approve</button></form>
                      </div>
                    </div>
                    {sp.edit === r.id && <FixBox r={r} />}
                  </div>
                )
              })}
            </div>
          </details>
        ))}
        {pending.length > 0 && <p className="mt-3 text-xs text-muted-foreground">To approve a whole pay week at once, open the Payroll report, pick the week and press Approve All.</p>}
      </section>
    </div>
  )
}
