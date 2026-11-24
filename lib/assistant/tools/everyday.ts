// Calendar and My Plate.

import { loadConstructionCalendar, loadMaintenanceCalendar } from '@/lib/calendar-events'
import { buildPlate, type TaskRow } from '@/lib/my-plate'
import { canUseArea } from '../access'
import { type ToolDef, out, today, addDays } from '../types'

const iso = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null)

export const everydayTools: ToolDef[] = [
  {
    name: 'calendar_events', area: 'calendar',
    description: 'What is on the company calendar for a date range: scheduled construction work and time off (for construction roles), and fleet due dates (state inspection, registration, brake and tire inspections). Defaults to the next 7 days.',
    input_schema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } } },
    async run(input, ctx) {
      const from = iso(input.from) ?? today()
      const to = iso(input.to) ?? addDays(from, 7)
      const [con, fleet] = await Promise.all([
        canUseArea(ctx, 'construction') ? loadConstructionCalendar(ctx.admin, ctx.companyId, from, to) : Promise.resolve([]),
        canUseArea(ctx, 'assets') ? loadMaintenanceCalendar(ctx.admin, ctx.companyId, from, to) : Promise.resolve([]),
      ])
      const events = [...con, ...fleet].sort((a, b) => a.date.localeCompare(b.date))
      return out({ from, to, events: events.slice(0, 80).map(e => ({ date: e.date, kind: e.category, title: e.title, detail: e.subtitle ?? null, link: e.href })) })
    },
  },
  {
    name: 'my_plate', area: 'plate',
    description: "The signed-in person's own My Plate: what to do now (overdue, due today, hot), what is next, and what they are waiting on someone else for.",
    input_schema: { type: 'object', properties: {} },
    async run(_input, ctx) {
      const { data } = await ctx.admin.from('con_tasks')
        .select('id, title, detail, kind, site_number, job_id, quote_id, priority, due_date, status, action, answer, waiting_on, waiting_since, snoozed_until, source, source_key, created_at, done_at, my_note')
        .eq('company_id', ctx.companyId).eq('owner_id', ctx.userId).in('status', ['open', 'waiting', 'done'])
        .order('created_at', { ascending: false }).limit(400)
      const plate = buildPlate((data ?? []) as TaskRow[], today())
      const row = (t: TaskRow) => ({ title: t.title, detail: t.detail ? t.detail.slice(0, 140) : null, kind: t.kind, site: t.site_number, due: t.due_date, hot: t.priority === 1, waiting_on: t.waiting_on, since: t.waiting_since, my_note: t.my_note ?? null })
      return out({
        now: plate.now.slice(0, 15).map(row), now_count: plate.now.length,
        next: plate.next.slice(0, 10).map(row), next_count: plate.next.length,
        waiting: plate.waiting.slice(0, 10).map(row), waiting_count: plate.waiting.length,
        done_today: plate.doneToday.length, link: '/my',
      })
    },
  },
]
