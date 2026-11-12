import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { buildPlate, buildSignals, businessDaysSince, dueDelta, KIND_CLASS, KIND_LABEL, type TaskRow, type TaskKind } from '@/lib/my-plate'
import { packingSlipSiteKey } from '@/lib/construction-dashboard'
import { addTask, completeTask, completeTasks, dropTask, reopenTask, setDue, setPriority, snoozeTask, waitTask, answerTask, resolvePriceLine, draftOrderEmail, markOrderSent } from './actions'
import { ORDER_VENDORS, mailtoHref, type OrderDraft, type OrderVendorKey } from '@/lib/order-email'
import { CopyButton } from '@/components/plate/copy-button'
import { BulkBar } from '@/components/plate/bulk-bar'
import { WORK_ORDER_DOCS_BUCKET } from '@/lib/svc-gmail-sync'

type TicketRef = { date?: string; subject?: string; paths: string[] }
type TicketUrls = Map<string, string>
const ticketRefs = (t: TaskRow): TicketRef[] => {
  const v = (t.action as { tickets?: unknown } | null)?.tickets
  return Array.isArray(v) ? (v as TicketRef[]).filter(r => Array.isArray(r?.paths)) : []
}

export const dynamic = 'force-dynamic'

const fmt = (iso: string | null) => iso ? new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : ''

/** Starsky's asks come in with a detail that starts "SD " (Action Board convention, 11/12/26). */
const fromStarsky = (t: TaskRow) => /^SD\b/.test(t.detail ?? '')
const isOverdue = (t: TaskRow, today: string) => t.status !== 'done' && (dueDelta(t, today) ?? 0) > 0
const isPermit = (t: TaskRow) => /\bpermit|\bTCP\b|\bPNF\b/i.test(t.title)

type Filters = { kind: TaskKind | null; sd: boolean; over: boolean }
/** Chip link that keeps the other filters as they are. */
const filterHref = (f: Filters) => {
  const q = new URLSearchParams()
  if (f.kind) q.set('kind', f.kind)
  if (f.sd) q.set('from', 'sd')
  if (f.over) q.set('due', 'over')
  const s = q.toString()
  return s ? `/my?${s}` : '/my'
}

export default async function MyPlatePage({ searchParams }: { searchParams: Promise<{ kind?: string; from?: string; due?: string }> }) {
  const { kind: kindParam, from: fromParam, due: dueParam } = await searchParams
  const kindFilter = kindParam && kindParam in KIND_LABEL ? kindParam as TaskKind : null
  const filters: Filters = { kind: kindFilter, sd: fromParam === 'sd', over: dueParam === 'over' }
  const profile = await requireConstruction()
  const admin = createAdminClient()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const since120 = new Date(Date.now() - 120 * 86_400_000).toISOString()

  const [{ data: rows }, { data: needed }, { data: bids }, { data: stale }, { data: quoting }, { data: quoted }, { data: slips }] = await Promise.all([
    admin.from('con_tasks').select('*').eq('owner_id', profile.id).neq('status', 'dropped').or(`status.neq.done,done_at.gte.${today}T00:00:00`).order('created_at'),
    admin.from('con_quote_line_items').select('id, description, quote_id, con_quotes!inner(quote_number, site_number, status, company_id)').eq('price_flag', 'price_needed').eq('con_quotes.status', 'draft').eq('con_quotes.company_id', profile.company_id),
    admin.from('con_quotes').select('id, quote_number, site_number, bid_due').eq('company_id', profile.company_id).eq('status', 'draft').not('bid_due', 'is', null).lte('bid_due', new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)),
    admin.from('con_job_materials').select('description, ordered_date, created_at, job_id, con_jobs!inner(site_number, company_id)').eq('status', 'ordered').eq('con_jobs.company_id', profile.company_id).lt('created_at', new Date(Date.now() - 10 * 86_400_000).toISOString()),
    admin.from('con_jobs').select('id, site_number, work_order_number, status_detail').eq('company_id', profile.company_id).eq('stage', 'quoting').not('status_detail', 'ilike', '%waiting%').not('status_detail', 'ilike', '%sent to%'),
    admin.from('con_quotes').select('job_id').eq('company_id', profile.company_id).not('job_id', 'is', null),
    admin.from('billing_inbox_documents').select('subject, body_preview, status, note, thread_replies').eq('company_id', profile.company_id).eq('kind', 'packing_slip').eq('status', 'new').gte('received_at', since120),
  ])

  const tasks = (rows ?? []) as TaskRow[]
  // Type filter (Trae 10/30): chips above the lists; counts are open + waiting rows of each kind.
  // "From Starsky" and "Overdue" (Trae 11/12, like the Action Board) narrow the list; the type chips count inside that view.
  const live = tasks.filter(t => t.status === 'open' || t.status === 'waiting')
  const sdCount = live.filter(fromStarsky).length
  const overCount = live.filter(t => isOverdue(t, today)).length
  const scoped = tasks.filter(t => (!filters.sd || fromStarsky(t)) && (!filters.over || isOverdue(t, today)))
  const kindCounts = new Map<TaskKind, number>()
  for (const t of scoped) if (t.status === 'open' || t.status === 'waiting') kindCounts.set(t.kind, (kindCounts.get(t.kind) ?? 0) + 1)
  const plate = buildPlate(kindFilter ? scoped.filter(t => t.kind === kindFilter) : scoped, today)
  // Crew ticket scans the daily job routine attached to a row (action.tickets) -> signed links, one batch call.
  const ticketPaths = [...new Set(tasks.filter(t => t.status !== 'done').flatMap(t => ticketRefs(t).flatMap(r => r.paths)))]
  const { data: signed } = ticketPaths.length
    ? await admin.storage.from(WORK_ORDER_DOCS_BUCKET).createSignedUrls(ticketPaths, 60 * 60)
    : { data: [] }
  const ticketUrls: TicketUrls = new Map((signed ?? []).filter(s => s.signedUrl && s.path).map(s => [s.path as string, s.signedUrl as string] as [string, string]))
  const quotedJobs = new Set((quoted ?? []).map(q => q.job_id))
  const unmatchedSlips = (slips ?? []).filter(s => {
    const replies = ((s.thread_replies ?? []) as { text?: string }[]).map(x => x.text ?? '')
    const stock = /\bstock\b/i.test(`${s.subject ?? ''} ${s.body_preview ?? ''} ${s.note ?? ''} ${replies.join(' ')}`)
    return !s.note && !stock && !packingSlipSiteKey(s.subject ?? '', s.body_preview, replies)
  }).length
  const signals = buildSignals({
    neededLines: (needed ?? []).map(l => { const q = l.con_quotes as unknown as { quote_number: string; site_number: string | null }; return { quote_number: q.quote_number, quote_id: l.quote_id, line_id: l.id, site_number: q.site_number, description: l.description } }),
    bidsDue: (bids ?? []).map(b => ({ quote_number: b.quote_number, quote_id: b.id, site_number: b.site_number, bid_due: b.bid_due as string })),
    staleOrders: (stale ?? []).map(m => ({ site_number: (m.con_jobs as unknown as { site_number: string }).site_number, description: m.description ?? '', ordered_date: m.ordered_date, job_id: m.job_id })),
    quotingNoQuote: (quoting ?? []).filter(j => !quotedJobs.has(j.id) && /^\d{5}$|^(SU|IP)-/i.test(j.site_number ?? '')).slice(0, 12),
    unmatchedSlips,
    existingKeys: new Set(tasks.map(t => t.source_key).filter((k): k is string => !!k)),
  }, today)

  const openCount = plate.now.length + plate.next.length
  const allCount = [...kindCounts.values()].reduce((a, b) => a + b, 0)
  const chip = (on: boolean) => `px-3 py-1.5 rounded-full border text-[13px] font-semibold transition-colors ${on ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border text-foreground hover:bg-blue-50'}`

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto overflow-x-hidden">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b-[3px] border-blue-700 pb-3 mb-5">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold uppercase tracking-wide text-blue-700 leading-none">My Plate</h1>
          <p className="text-sm text-muted-foreground mt-1.5">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' })} · top card is the next thing to do</p>
        </div>
        <div className="flex flex-wrap gap-2 font-mono text-xs">
          <span className="px-2 py-1 rounded border border-border bg-card"><b className="tabular-nums">{openCount}</b> your move</span>
          <span className="px-2 py-1 rounded border border-border bg-card"><b className="tabular-nums">{plate.waiting.length}</b> waiting</span>
          {overCount > 0 && <span className="px-2 py-1 rounded border border-red-200 bg-red-50 text-red-700"><b className="tabular-nums">{overCount}</b> overdue</span>}
          <span className="px-2 py-1 rounded border border-border bg-card"><b className="tabular-nums">{plate.doneToday.length}</b> done today</span>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 mb-3" role="group" aria-label="Filter">
        <Link href={filterHref({ ...filters, sd: false, over: false })} className={chip(!filters.sd && !filters.over)}>Everything open</Link>
        <Link href={filterHref({ ...filters, sd: !filters.sd })} className={chip(filters.sd)}>From Starsky <span className="tabular-nums opacity-70">{sdCount}</span></Link>
        <Link href={filterHref({ ...filters, over: !filters.over })} className={chip(filters.over)}>Overdue <span className="tabular-nums opacity-70">{overCount}</span></Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Link href={filterHref({ ...filters, kind: null })} className={`px-2.5 py-1 rounded-full border ${!kindFilter ? 'bg-foreground text-background border-foreground' : 'border-gray-300 text-gray-600 bg-card hover:bg-gray-50'}`}>All types {allCount}</Link>
          {(Object.keys(KIND_LABEL) as TaskKind[]).filter(k => kindCounts.get(k)).map(k => (
            <Link key={k} href={filterHref({ ...filters, kind: k })} className={`px-2.5 py-1 rounded-full border ${kindFilter === k ? 'ring-2 ring-offset-1 ring-gray-900 ' : ''}${KIND_CLASS[k]}`}>{KIND_LABEL[k]} {kindCounts.get(k)}</Link>
          ))}
        </div>
        <form id="plate-bulk" action={completeTasks} />
        <BulkBar formId="plate-bulk" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-7 min-w-0">
          <Lane title="Your move" hint="needs an answer or action from you" count={openCount} empty="Nothing on you right now. Add what is on your mind.">
            {plate.now.map(t => <TaskCard key={t.id} t={t} today={today} urls={ticketUrls} />)}
            {plate.now.length > 0 && plate.next.length > 0 && (
              <li className="flex items-center gap-3 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" aria-hidden>
                <span>Then, in order</span><span className="h-px flex-1 bg-border" />
              </li>
            )}
            {plate.next.map(t => <TaskCard key={t.id} t={t} today={today} urls={ticketUrls} />)}
          </Lane>

          <Lane title="Waiting on" hint="we sent it, no answer yet · longest wait first" count={plate.waiting.length} empty="Nobody owes you anything right now.">
            {plate.waiting.map(t => <TaskCard key={t.id} t={t} today={today} urls={ticketUrls} waiting />)}
          </Lane>

          {plate.snoozed.length > 0 && (
            <Folded title="Snoozed" count={plate.snoozed.length}>
              {plate.snoozed.map(t => <TaskCard key={t.id} t={t} today={today} urls={ticketUrls} />)}
            </Folded>
          )}

          {plate.doneToday.length > 0 && (
            <Folded title="Done today" count={plate.doneToday.length}>
              {plate.doneToday.map(t => (
                <li key={t.id} className="rounded-lg border border-border border-l-[6px] border-l-emerald-600 bg-card px-3 py-2.5 flex items-center gap-3 opacity-70">
                  <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {t.site_number && <SiteTag site={t.site_number} />}
                    <span className="font-semibold text-sm text-foreground min-w-0">{t.title}</span>
                    <Pill tone="done">Done{t.done_at ? ` ${new Date(t.done_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}` : ''}</Pill>
                  </div>
                  <form action={reopenTask.bind(null, t.id)}><button className="px-3 py-1.5 rounded-md border border-border bg-gray-50 text-[13px] font-semibold text-foreground hover:bg-gray-100">Reopen</button></form>
                </li>
              ))}
            </Folded>
          )}
        </div>

        <aside className="space-y-6 min-w-0">
          <section className="space-y-2.5">
            <LaneHeading title="Add to my plate" />
            <form action={addTask} className="rounded-lg border border-border border-l-[6px] border-l-blue-700 bg-card p-3 space-y-2 text-sm">
              <input name="title" required placeholder="What needs doing" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5" />
              <div className="grid grid-cols-2 gap-2">
                <input name="site_number" placeholder="Site (40013, SU-8605)" className="min-w-0 rounded-md border border-gray-300 px-2.5 py-1.5" />
                <input name="due_date" type="date" className="min-w-0 rounded-md border border-gray-300 px-2.5 py-1.5" />
                <select name="kind" defaultValue="followup" className="min-w-0 rounded-md border border-gray-300 px-2 py-1.5">
                  {(Object.keys(KIND_LABEL) as TaskKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
                <select name="priority" defaultValue="2" className="min-w-0 rounded-md border border-gray-300 px-2 py-1.5">
                  <option value="1">Hot</option><option value="2">Normal</option><option value="3">Low</option>
                </select>
              </div>
              <textarea name="detail" rows={2} placeholder="Detail, numbers, who to call (start with SD if Starsky asked)" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5" />
              <button className="w-full rounded-md bg-primary text-primary-foreground py-1.5 text-sm font-semibold hover:bg-primary/90">Add</button>
            </form>
          </section>

          <section className="space-y-2.5">
            <LaneHeading title="Signals" count={signals.length} hint="the data says you owe these" />
            {signals.length === 0 ? <p className="rounded-lg border border-dashed border-border bg-card p-3 text-sm text-muted-foreground">Nothing the data can see that is not already on the plate.</p> : (
              <ul className="flex flex-col gap-2">
                {signals.map(s => (
                  <li key={s.key} className="rounded-lg border border-border border-l-[6px] border-l-purple-500 bg-card px-3 py-2 text-xs flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {s.site_number && <SiteTag site={s.site_number} />}
                        <span className={`px-1.5 py-0.5 rounded-full border text-[10px] ${KIND_CLASS[s.kind]}`}>{KIND_LABEL[s.kind]}</span>
                      </div>
                      <div className="text-foreground">{s.href ? <Link href={s.href} className="hover:underline">{s.title}</Link> : s.title}</div>
                    </div>
                    <form action={addTask} className="shrink-0">
                      <input type="hidden" name="title" value={s.title} /><input type="hidden" name="kind" value={s.kind} /><input type="hidden" name="site_number" value={s.site_number ?? ''} /><input type="hidden" name="source_key" value={s.key} /><input type="hidden" name="detail" value={s.href ? `See ${s.href}` : ''} />{s.action && <input type="hidden" name="action" value={JSON.stringify(s.action)} />}
                      <button className="px-2 py-1 rounded-md border border-border bg-gray-50 font-semibold text-blue-700 hover:bg-blue-50 whitespace-nowrap">+ plate</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

function LaneHeading({ title, count, hint }: { title: string; count?: number; hint?: string }) {
  return (
    <h2 className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-lg font-bold uppercase tracking-wide text-blue-700">
      {title}
      {count !== undefined && <span className="rounded-md bg-blue-50 px-2 text-sm tabular-nums">{count}</span>}
      {hint && <small className="text-xs font-medium normal-case tracking-normal text-muted-foreground">{hint}</small>}
    </h2>
  )
}

/** A lane: blue heading with its count, then a stack of cards with space between them. */
function Lane({ title, hint, count, empty, children }: { title: string; hint: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <LaneHeading title={title} count={count} hint={hint} />
      {count === 0 ? <p className="rounded-lg border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">{empty}</p> : <ul className="flex flex-col gap-2.5">{children}</ul>}
    </section>
  )
}

/** A lane that starts closed (Snoozed, Done today). */
function Folded({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none select-none flex items-baseline gap-2.5 text-lg font-bold uppercase tracking-wide text-muted-foreground hover:text-blue-700">
        <span className="inline-block w-3 text-sm transition-transform group-open:rotate-90">▸</span>{title}
        <span className="rounded-md bg-gray-200/70 px-2 text-sm tabular-nums">{count}</span>
      </summary>
      <ul className="mt-2.5 flex flex-col gap-2.5">{children}</ul>
    </details>
  )
}

function SiteTag({ site }: { site: string }) {
  return <span className="font-mono text-[12.5px] leading-5 px-1.5 rounded bg-blue-50 text-blue-700 border border-blue-100 whitespace-nowrap">{site}</span>
}

const PILL = {
  over: 'bg-red-50 text-red-700 border-red-200',
  today: 'bg-amber-50 text-amber-800 border-amber-200',
  due: 'bg-blue-50 text-blue-700 border-blue-100',
  plain: 'bg-gray-50 text-muted-foreground border-border',
  sd: 'bg-violet-50 text-violet-700 border-violet-200',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
} as const
function Pill({ tone, title, children }: { tone: keyof typeof PILL; title?: string; children: React.ReactNode }) {
  return <span title={title} className={`px-2 py-0.5 rounded-full border text-xs font-semibold whitespace-nowrap ${PILL[tone]}`}>{children}</span>
}

/** Left stripe: red = hot or overdue, navy = waiting or a permit, amber = everything else. */
function stripe(t: TaskRow, today: string, waiting: boolean) {
  if (waiting || isPermit(t)) return 'border-l-blue-700'
  if (t.priority === 1 || isOverdue(t, today)) return 'border-l-red-600'
  return 'border-l-amber-400'
}

const ghost = 'px-2 py-1 rounded-md border border-border bg-card text-gray-600 hover:bg-gray-50'

function TaskCard({ t, today, urls, waiting = false }: { t: TaskRow; today: string; urls: TicketUrls; waiting?: boolean }) {
  const d = dueDelta(t, today)
  const waitDays = waiting && t.waiting_since ? businessDaysSince(t.waiting_since, today) : 0
  const a = (t.action ?? {}) as { type?: string }
  const richResolver = !waiting && t.status === 'open' && (a.type === 'quote_line_price' || a.type === 'order_email' || t.kind === 'order')
  const plainAnswer = !waiting && t.status === 'open' && !richResolver
  return (
    <li className={`rounded-lg border border-border border-l-[6px] ${stripe(t, today, waiting)} bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)] px-3 py-2.5 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5`}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          <input type="checkbox" name="ids" value={t.id} form="plate-bulk" aria-label="Select to complete" className="shrink-0" />
          {t.site_number && <SiteTag site={t.site_number} />}
          <span className="font-semibold text-[15px] leading-snug text-foreground min-w-0 [overflow-wrap:anywhere]">{t.title}</span>
        </div>
        {t.detail && <div className="text-[13.5px] leading-snug text-muted-foreground whitespace-pre-line [overflow-wrap:anywhere]">{t.detail}</div>}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className={`px-2 py-0.5 rounded-full border text-xs ${KIND_CLASS[t.kind]}`}>{KIND_LABEL[t.kind]}</span>
          {t.priority === 1 && <Pill tone="over">Hot</Pill>}
          {fromStarsky(t) && <Pill tone="sd">Starsky</Pill>}
          {waiting && t.waiting_on && <Pill tone="plain">{t.waiting_on}</Pill>}
          {waiting && t.waiting_since && <Pill tone={waitDays >= 5 ? 'over' : 'plain'} title={`since ${fmt(t.waiting_since)}`}>{waitDays === 0 ? 'today' : `${waitDays} business day${waitDays === 1 ? '' : 's'}`}{waitDays >= 5 ? ' · nudge' : ''}</Pill>}
          {d !== null && (d > 0
            ? <Pill tone="over">Follow up now ({fmt(t.due_date)})</Pill>
            : d === 0 ? <Pill tone="today">Due today</Pill> : <Pill tone="due">Due {fmt(t.due_date)}</Pill>)}
          {t.snoozed_until && t.snoozed_until > today && <Pill tone="plain">Snoozed to {fmt(t.snoozed_until)}</Pill>}
          {t.job_id && <Link href={`/construction/jobs/${t.job_id}`} className="text-xs text-blue-700 hover:underline">Job</Link>}
          {t.quote_id && <Link href={`/billing/quotes/${t.quote_id}`} className="text-xs text-blue-700 hover:underline">Quote</Link>}
        </div>
        <Tickets refs={ticketRefs(t)} urls={urls} />
        {richResolver && <Resolver t={t} />}
        <details className="group/more pt-0.5">
          <summary className="cursor-pointer list-none select-none inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">
            <span className="inline-block transition-transform group-open/more:rotate-90">▸</span>{plainAnswer ? 'Answer · snooze · more' : 'Snooze · more'}
          </summary>
          <div className="mt-2 space-y-2 rounded-md border border-border bg-gray-50/70 p-2 text-xs">
            {plainAnswer && <Resolver t={t} />}
            <div className="flex flex-wrap items-center gap-1.5">
              {waiting
                ? <form action={reopenTask.bind(null, t.id)}><button className={ghost}>Back to me</button></form>
                : <form action={waitTask.bind(null, t.id)} className="flex gap-1"><input name="who" placeholder="waiting on…" className="w-28 rounded-md border border-gray-300 bg-card px-1.5 py-1" /><button className={ghost}>Hand off</button></form>}
              <form action={snoozeTask.bind(null, t.id)}><input type="hidden" name="days" value="1" /><button className={ghost} title="Snooze 1 day">+1 day</button></form>
              <form action={snoozeTask.bind(null, t.id)}><input type="hidden" name="days" value="7" /><button className={ghost} title="Snooze a week">+1 week</button></form>
              <form action={setPriority.bind(null, t.id)}><input type="hidden" name="priority" value={t.priority === 1 ? '2' : '1'} /><button className={ghost} title="Toggle hot">{t.priority === 1 ? 'Not hot' : 'Make hot'}</button></form>
              <form action={setDue.bind(null, t.id)} className="flex gap-1"><input name="due_date" type="date" defaultValue={t.due_date ?? ''} aria-label="Due date" className="w-[8.5rem] rounded-md border border-gray-300 bg-card px-1 py-0.5" /><button className={ghost}>Set due</button></form>
              <form action={dropTask.bind(null, t.id)}><button className="px-2 py-1 rounded-md border border-border bg-card text-gray-500 hover:text-red-700 hover:bg-red-50" title="Drop it, not needed">Drop</button></form>
              <span className="text-[11px] text-gray-400">from {t.source}</span>
            </div>
          </div>
        </details>
      </div>
      <div className="flex sm:flex-col items-center sm:items-end gap-2 sm:col-start-2 sm:row-start-1">
        <form action={completeTask.bind(null, t.id)}><button className="px-4 py-1.5 rounded-md bg-emerald-600 border border-emerald-700 text-white text-[13px] font-semibold hover:bg-emerald-600/90">Done</button></form>
      </div>
    </li>
  )
}

/** The crew ticket(s) behind a question, so it can be answered without digging through the job folder. */
function Tickets({ refs, urls }: { refs: TicketRef[]; urls: TicketUrls }) {
  const shown = refs.map(r => ({ ...r, files: r.paths.map(p => ({ p, url: urls.get(p) })).filter((f): f is { p: string; url: string } => !!f.url) })).filter(r => r.files.length)
  if (!shown.length) return null
  return (
    <details className="mt-1.5 group">
      <summary className="cursor-pointer text-[11px] text-blue-600 hover:underline select-none">
        View ticket{shown.length > 1 ? `s (${shown.length})` : ''} · {shown.map(r => fmt(r.date ?? null)).filter(Boolean).join(', ')}
      </summary>
      <div className="mt-1.5 space-y-2">
        {shown.map((r, i) => (
          <div key={i}>
            <div className="text-[11px] text-gray-500">{fmt(r.date ?? null)}{r.subject ? ` · ${r.subject}` : ''}</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {r.files.map(f => /\.(jpe?g|png|gif|webp)$/i.test(f.p)
                ? <a key={f.p} href={f.url} target="_blank" rel="noopener" title="Open full size">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.url} alt={f.p.split('/').pop()} loading="lazy" className="h-40 max-w-full rounded border border-gray-200 object-contain bg-gray-50" />
                  </a>
                : <a key={f.p} href={f.url} target="_blank" rel="noopener" className="text-[11px] px-2 py-1 rounded border border-gray-300 text-blue-600 hover:bg-gray-50">{f.p.split('/').pop()}</a>)}
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}

/** The control that handles the need from the row: price a quote line, draft the order mail, or just answer and close. */
function Resolver({ t }: { t: TaskRow }) {
  const a = (t.action ?? {}) as { type?: string; vendor?: OrderVendorKey; draft?: OrderDraft; draft_status?: string; site_name?: string; address?: string; work_order?: string; takeoff?: string; items?: string; attachments?: { name: string }[]; survey_id?: string }
  const input = 'rounded border border-gray-300 px-1.5 py-0.5 text-[11px]'
  if (a.type === 'quote_line_price') {
    return (
      <form action={resolvePriceLine.bind(null, t.id)} className="mt-1.5 rounded-md border border-amber-200 bg-amber-50/60 p-2 text-[11px] space-y-1.5">
        <div className="font-semibold text-amber-900">Price it</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span>$</span><input name="unit_cost" required inputMode="decimal" placeholder="275" className={`${input} w-20`} />
          <span>per</span>
          <select name="unit" defaultValue="job" className={input}><option value="job">job</option><option value="day">day</option><option value="each">each</option><option value="hour">hour</option><option value="load">load</option></select>
          <input name="note" placeholder="where the number came from" className={`${input} w-44`} />
        </div>
        <label className="flex flex-wrap items-center gap-1.5"><input type="checkbox" name="add_to_catalog" defaultChecked /> save to RPS catalog as
          <input name="part_number" placeholder="WALK-BEHIND SAW" className={`${input} w-36`} />
          <select name="category" defaultValue="9" className={input}><option value="9">9 equipment</option><option value="10">10 disposables</option><option value="5">5 concrete / disposal</option><option value="11">11 sub</option><option value="12">12 permit</option></select>
        </label>
        <button className="px-2 py-0.5 rounded bg-amber-600 text-white hover:bg-amber-600/90">Apply to quote</button>
      </form>
    )
  }
  if (a.type === 'order_email' || t.kind === 'order') {
    const d = a.draft
    return (
      <div className="mt-1.5 rounded-md border border-emerald-200 bg-emerald-50/60 p-2 text-[11px] space-y-1.5">
        {d ? (
          <>
            <div className="font-semibold text-emerald-900">Order email drafted{a.draft_status === 'sent' ? ' · sent' : ''}</div>
            <div className="text-gray-700"><b>To</b> {d.to} · <b>Cc</b> {d.cc.join(', ')}</div>
            <div className="text-gray-700"><b>Subject</b> {d.subject}</div>
            {a.attachments?.length ? <div className="text-gray-700"><b>Attach</b> {a.attachments.map(x => x.name).join(', ')}{a.survey_id && <> · <a href={`/api/construction/surveys/${a.survey_id}/pdf`} target="_blank" rel="noopener" className="text-blue-600 hover:underline">open PDF</a></>} <span className="text-gray-400">(Proton push attaches it; mail link cannot)</span></div> : null}
            <pre className="whitespace-pre-wrap font-sans text-gray-700 bg-card rounded border border-emerald-100 p-2 max-h-48 overflow-auto">{d.body}</pre>
            <div className="flex flex-wrap items-center gap-1.5">
              <a href={mailtoHref(d)} className="px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-600/90">Open in mail</a>
              <CopyButton text={`To: ${d.to}\nCc: ${d.cc.join(', ')}\nSubject: ${d.subject}\n\n${d.body}`} label="Copy email" />
              <form action={markOrderSent.bind(null, t.id)} className="flex items-center gap-1"><input name="who" defaultValue="Shannon (PO#)" className={`${input} w-28`} /><button className="px-2 py-0.5 rounded border border-emerald-300 text-emerald-800 hover:bg-emerald-100">I sent it → waiting</button></form>
            </div>
            <details><summary className="cursor-pointer text-gray-500">Edit and redraft</summary><OrderForm t={t} a={a} input={input} /></details>
          </>
        ) : (
          <>
            <div className="font-semibold text-emerald-900">Draft the order email</div>
            <OrderForm t={t} a={a} input={input} />
          </>
        )}
      </div>
    )
  }
  return (
    <form action={answerTask.bind(null, t.id)} className="mt-1.5 flex items-center gap-1.5 text-[11px]">
      <input name="answer" placeholder="answer / what you did — closes the row" className={`${input} flex-1 min-w-0`} />
      <button className="px-2 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 whitespace-nowrap">Answer & close</button>
    </form>
  )
}

function OrderForm({ t, a, input }: { t: TaskRow; a: { vendor?: OrderVendorKey; site_name?: string; address?: string; work_order?: string; takeoff?: string; items?: string }; input: string }) {
  return (
    <form action={draftOrderEmail.bind(null, t.id)} className="mt-1 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <select name="vendor" defaultValue={a.vendor ?? 'icon'} className={input}>{(Object.keys(ORDER_VENDORS) as OrderVendorKey[]).map(k => <option key={k} value={k}>{ORDER_VENDORS[k].label}</option>)}</select>
        <input name="to" placeholder="to (blank = vendor default)" className={`${input} w-48`} />
        <input name="site" defaultValue={t.site_number ?? ''} placeholder="site" className={`${input} w-20`} />
        <input name="site_name" defaultValue={a.site_name ?? ''} placeholder="Global Exxon / Sunoco" className={`${input} w-32`} />
        <input name="address" defaultValue={a.address ?? ''} placeholder="address" className={`${input} w-56`} />
        <input name="work_order" defaultValue={a.work_order ?? ''} placeholder="WOT…" className={`${input} w-28`} />
        <input name="takeoff" defaultValue={a.takeoff ?? ''} placeholder="take-off / quote #" className={`${input} w-32`} />
      </div>
      <textarea name="items" rows={4} defaultValue={a.items ?? ''} placeholder={'(4) IRF 5B3.5x3.2AC - Icon SplitRepair Flange Fitting Kit … - $459.00 each\n(2) IAC FASTFUSE - … - $109.00 each'} className="w-full rounded border border-gray-300 px-1.5 py-1 text-[11px] font-mono" />
      <div className="flex flex-wrap items-center gap-1.5">
        <input name="note" placeholder="extra line (optional)" className={`${input} w-64`} />
        <label className="flex items-center gap-1"><input type="checkbox" name="ask_po" value="on" defaultChecked /> ask Shannon for a PO#</label>
        <button className="px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-600/90">Draft it</button>
      </div>
    </form>
  )
}
