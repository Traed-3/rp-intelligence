// Maintenance & Fleet, Repair Tickets, Shop & Time Clock.
// The ticket look-ups and the four ticket changes are the original Ask RPS tools, moved here unchanged in behaviour.

import { generateTicketNumber } from '@/lib/gmail-parser'
import { canWriteTickets } from '../access'
import { type AssistantCtx, type ToolDef, out, str, term, today, addDays } from '../types'

const TERMINAL = ['completed', 'closed', 'deferred']

async function findTicketRow(ctx: AssistantCtx, ticketNumber: unknown) {
  const { data } = await ctx.admin.from('repair_tickets')
    .select('id, ticket_number, title, status, due_date, assigned_to, asset_id')
    .eq('company_id', ctx.companyId).ilike('ticket_number', term(ticketNumber, 30)).maybeSingle()
  return data
}

const preview = (what: string) => `READY (needs confirmation): ${what}. Ask the user to confirm, then call again with confirm:true.`

export const maintenanceTools: ToolDef[] = [
  {
    name: 'find_ticket', area: 'tickets',
    description: 'Search open repair tickets (shop / fleet repairs) by ticket number, asset unit number, or words in the title.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Ticket number (e.g. 61026P16), asset unit (e.g. T20), or title words' } }, required: ['query'] },
    async run(input, ctx) {
      const q = term(input.query)
      if (!q) return 'Give me a ticket number, unit number or a few words from the title.'
      const select = 'ticket_number, title, status, priority, due_date, assets(unit_number), profiles!repair_tickets_assigned_to_fkey(full_name)'
      const { data } = await ctx.admin.from('repair_tickets').select(select)
        .eq('company_id', ctx.companyId).or(`ticket_number.ilike.%${q}%,title.ilike.%${q}%`)
        .not('status', 'in', `(${TERMINAL.join(',')})`).order('updated_at', { ascending: false }).limit(8)
      let rows: any[] = data ?? []
      if (!rows.length) {
        const { data: byAsset } = await ctx.admin.from('repair_tickets')
          .select('ticket_number, title, status, priority, due_date, assets!inner(unit_number), profiles!repair_tickets_assigned_to_fkey(full_name)')
          .eq('company_id', ctx.companyId).ilike('assets.unit_number', q)
          .not('status', 'in', `(${TERMINAL.join(',')})`).order('updated_at', { ascending: false }).limit(8)
        rows = byAsset ?? []
      }
      return out(rows.map((t: any) => ({ ticket: t.ticket_number, title: t.title, status: t.status, priority: t.priority, due: t.due_date, asset: t.assets?.unit_number, assigned: t.profiles?.full_name ?? 'Unassigned' })))
    },
  },
  {
    name: 'list_overdue_tickets', area: 'tickets',
    description: 'List open repair tickets that are past their due date.',
    input_schema: { type: 'object', properties: {} },
    async run(_input, ctx) {
      const { data } = await ctx.admin.from('repair_tickets')
        .select('ticket_number, title, due_date, assets(unit_number)')
        .eq('company_id', ctx.companyId).not('status', 'in', `(${TERMINAL.join(',')})`)
        .not('due_date', 'is', null).lt('due_date', today()).order('due_date').limit(25)
      return out((data ?? []).map((t: any) => ({ ticket: t.ticket_number, title: t.title, due: t.due_date, asset: t.assets?.unit_number })))
    },
  },
  {
    name: 'whos_clocked_in', area: 'shop',
    description: 'List employees who are clocked in right now and what they are doing.',
    input_schema: { type: 'object', properties: {} },
    async run(_input, ctx) {
      const { data } = await ctx.admin.from('employee_statuses')
        .select('clock_status, current_status, profiles!employee_statuses_profile_id_fkey(full_name)')
        .eq('clock_status', 'clocked_in').eq('company_id', ctx.companyId)
      return out((data ?? []).map((s: any) => ({ name: s.profiles?.full_name, status: s.current_status })))
    },
  },
  {
    name: 'get_asset', area: 'assets',
    description: 'Details for one truck, trailer or piece of equipment by unit number: status, mileage, who drives it, maintenance due dates and its open repair tickets.',
    input_schema: { type: 'object', properties: { unit_number: { type: 'string' } }, required: ['unit_number'] },
    async run(input, ctx) {
      const { data: asset } = await ctx.admin.from('assets')
        .select('id, unit_number, name, status, current_mileage, next_oil_change_mileage, next_brake_inspection_date, next_tire_inspection_date, inspection_due_date, registration_due_date, profiles!assets_assigned_profile_id_fkey(full_name)')
        .eq('company_id', ctx.companyId).ilike('unit_number', term(input.unit_number, 20)).maybeSingle()
      if (!asset) return `No asset found with unit number "${str(input.unit_number, 20)}".`
      const { data: tix } = await ctx.admin.from('repair_tickets')
        .select('ticket_number, title, status').eq('company_id', ctx.companyId).eq('asset_id', asset.id)
        .not('status', 'in', `(${TERMINAL.join(',')})`).limit(10)
      const { id, profiles, ...rest } = asset as any
      return out({ ...rest, assigned_driver: profiles?.full_name ?? null, link: `/assets/${id}`, open_tickets: tix ?? [] })
    },
  },
  {
    name: 'maintenance_due', area: 'assets',
    description: 'Fleet maintenance that is overdue or coming due: state inspections, registrations, brake and tire inspections (by date) and oil changes (by mileage).',
    input_schema: { type: 'object', properties: { within_days: { type: 'number', description: 'How far ahead to look. Default 30.' } } },
    async run(input, ctx) {
      const until = addDays(today(), Math.min(120, Math.max(0, Number(input.within_days) || 30)))
      const { data } = await ctx.admin.from('assets')
        .select('unit_number, name, status, current_mileage, next_oil_change_mileage, next_brake_inspection_date, next_tire_inspection_date, inspection_due_date, registration_due_date')
        .eq('company_id', ctx.companyId).neq('status', 'retired').limit(300)
      const items: { unit: string; item: string; due: string }[] = []
      const dateItems: [string, string][] = [['inspection_due_date', 'State inspection'], ['registration_due_date', 'Registration'], ['next_brake_inspection_date', 'Brake inspection'], ['next_tire_inspection_date', 'Tire inspection']]
      for (const a of (data ?? []) as any[]) {
        for (const [col, label] of dateItems) if (a[col] && a[col] <= until) items.push({ unit: a.unit_number, item: label, due: a[col] })
        if (a.next_oil_change_mileage && a.current_mileage != null && a.current_mileage >= a.next_oil_change_mileage - 500)
          items.push({ unit: a.unit_number, item: 'Oil change', due: `${a.current_mileage} of ${a.next_oil_change_mileage} miles` })
      }
      items.sort((x, y) => x.due.localeCompare(y.due))
      return out({ today: today(), looked_through: until, items: items.slice(0, 40), more: Math.max(0, items.length - 40) })
    },
  },

  // ── Changes (owners, managers and shop managers only; always previewed first) ──
  {
    name: 'set_ticket_due_date', area: 'tickets', writes: true, allowed: canWriteTickets,
    description: 'Set or change the due date on a repair ticket. Call once without confirm to preview, then again with confirm:true after the user agrees.',
    input_schema: { type: 'object', properties: { ticket_number: { type: 'string' }, due_date: { type: 'string', description: 'YYYY-MM-DD' }, confirm: { type: 'boolean' } }, required: ['ticket_number', 'due_date'] },
    async run(input, ctx) {
      const due = str(input.due_date, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return 'The due date must be YYYY-MM-DD.'
      const t = await findTicketRow(ctx, input.ticket_number)
      if (!t) return `No ticket found numbered "${str(input.ticket_number, 30)}".`
      if (input.confirm !== true) return preview(`set ${t.ticket_number} ("${t.title}") due date to ${due}`)
      const { error } = await ctx.admin.from('repair_tickets').update({ due_date: due }).eq('id', t.id).eq('company_id', ctx.companyId)
      return error ? `That did not save: ${error.message}` : `Done: ${t.ticket_number} due date set to ${due}.`
    },
  },
  {
    name: 'assign_ticket', area: 'tickets', writes: true, allowed: canWriteTickets,
    description: 'Assign a repair ticket to a person by name. Requires confirm:true to apply.',
    input_schema: { type: 'object', properties: { ticket_number: { type: 'string' }, assignee_name: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['ticket_number', 'assignee_name'] },
    async run(input, ctx) {
      const t = await findTicketRow(ctx, input.ticket_number)
      if (!t) return `No ticket found numbered "${str(input.ticket_number, 30)}".`
      const name = term(input.assignee_name, 40)
      const { data: people } = await ctx.admin.from('profiles').select('id, full_name')
        .eq('company_id', ctx.companyId).eq('is_active', true).ilike('full_name', `%${name}%`).limit(5)
      if (!people?.length) return `No active employee matches "${name}".`
      if (people.length > 1) return `Multiple people match "${name}": ${people.map(p => p.full_name).join(', ')}. Ask which one.`
      const person = people[0]
      if (input.confirm !== true) return preview(`assign ${t.ticket_number} ("${t.title}") to ${person.full_name}`)
      const updates: Record<string, unknown> = { assigned_to: person.id }
      if (['new', 'open'].includes(t.status)) updates.status = 'assigned'
      const { error } = await ctx.admin.from('repair_tickets').update(updates).eq('id', t.id).eq('company_id', ctx.companyId)
      if (error) return `That did not save: ${error.message}`
      await ctx.admin.from('repair_ticket_assignments').update({ is_active: false }).eq('ticket_id', t.id)
      await ctx.admin.from('repair_ticket_assignments').insert({ ticket_id: t.id, profile_id: person.id, assigned_by: ctx.userId })
      return `Done: ${t.ticket_number} assigned to ${person.full_name}.`
    },
  },
  {
    name: 'complete_ticket', area: 'tickets', writes: true, allowed: canWriteTickets,
    description: 'Mark a repair ticket as completed. Requires confirm:true to apply.',
    input_schema: { type: 'object', properties: { ticket_number: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['ticket_number'] },
    async run(input, ctx) {
      const t = await findTicketRow(ctx, input.ticket_number)
      if (!t) return `No ticket found numbered "${str(input.ticket_number, 30)}".`
      if (input.confirm !== true) return preview(`mark ${t.ticket_number} ("${t.title}") as Completed`)
      const { error } = await ctx.admin.from('repair_tickets').update({ status: 'completed', date_completed: today(), completed_by: ctx.userId }).eq('id', t.id).eq('company_id', ctx.companyId)
      return error ? `That did not save: ${error.message}` : `Done: ${t.ticket_number} marked Completed.`
    },
  },
  {
    name: 'create_ticket', area: 'tickets', writes: true, allowed: canWriteTickets,
    description: 'Create a new repair ticket on an asset. Requires confirm:true to apply.',
    input_schema: { type: 'object', properties: { unit_number: { type: 'string' }, title: { type: 'string' }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical', 'safety'] }, confirm: { type: 'boolean' } }, required: ['unit_number', 'title'] },
    async run(input, ctx) {
      const { data: asset } = await ctx.admin.from('assets').select('id, unit_number')
        .eq('company_id', ctx.companyId).ilike('unit_number', term(input.unit_number, 20)).maybeSingle()
      if (!asset) return `No asset found with unit number "${str(input.unit_number, 20)}".`
      const title = str(input.title, 200)
      if (!title) return 'The ticket needs a title.'
      const priority = ['low', 'normal', 'high', 'critical', 'safety'].includes(String(input.priority)) ? String(input.priority) : 'normal'
      if (input.confirm !== true) return preview(`create a ${priority}-priority ticket on ${asset.unit_number}: "${title}"`)
      const now = new Date()
      const prefix = `${now.getMonth() + 1}${now.getDate()}${now.getFullYear().toString().slice(-2)}`
      const { data: existing } = await ctx.admin.from('repair_tickets').select('ticket_number')
        .eq('company_id', ctx.companyId).ilike('ticket_number', `${prefix}%`)
      const number = generateTicketNumber(now, asset.unit_number, (existing ?? []).map((e: any) => e.ticket_number))
      const { data: created, error } = await ctx.admin.from('repair_tickets').insert({
        company_id: ctx.companyId, asset_id: asset.id, ticket_number: number, title,
        priority, status: 'open', source: 'assistant', created_by: ctx.userId,
      }).select('ticket_number').single()
      return error ? `That did not save: ${error.message}` : `Done: created ticket ${created?.ticket_number} on ${asset.unit_number}.`
    },
  },
]
