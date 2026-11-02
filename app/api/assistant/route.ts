import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateTicketNumber } from '@/lib/gmail-parser'

export const maxDuration = 60

const MODEL = 'claude-sonnet-4-6'
const WRITE_ROLES = ['owner', 'manager', 'shop_manager']
const TERMINAL = ['completed', 'closed', 'deferred']

type Ctx = {
  admin: ReturnType<typeof createAdminClient>
  companyId: string
  role: string
  userId: string
  canWrite: boolean
}

const tools: Anthropic.Tool[] = [
  {
    name: 'find_ticket',
    description: 'Search repair tickets by ticket number, asset unit number, or keywords in the title. Use this to locate the ticket the user means before acting on it.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Ticket number (e.g. 61026P16), asset unit (e.g. T20), or title keywords' } }, required: ['query'] },
  },
  {
    name: 'list_overdue',
    description: 'List open tickets that are past their due date.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'whos_clocked_in',
    description: 'List employees currently clocked in and their status.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_asset',
    description: 'Get details and recent open tickets for an asset by its unit number.',
    input_schema: { type: 'object', properties: { unit_number: { type: 'string' } }, required: ['unit_number'] },
  },
  {
    name: 'set_ticket_due_date',
    description: 'Set or change the due date on a ticket. Requires confirm:true to actually apply — call once without confirm to preview, then again with confirm:true after the user agrees.',
    input_schema: { type: 'object', properties: { ticket_number: { type: 'string' }, due_date: { type: 'string', description: 'YYYY-MM-DD' }, confirm: { type: 'boolean' } }, required: ['ticket_number', 'due_date'] },
  },
  {
    name: 'assign_ticket',
    description: 'Assign a ticket to a person by name. Requires confirm:true to apply.',
    input_schema: { type: 'object', properties: { ticket_number: { type: 'string' }, assignee_name: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['ticket_number', 'assignee_name'] },
  },
  {
    name: 'complete_ticket',
    description: 'Mark a ticket as completed. Requires confirm:true to apply.',
    input_schema: { type: 'object', properties: { ticket_number: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['ticket_number'] },
  },
  {
    name: 'create_ticket',
    description: 'Create a new repair ticket on an asset. Requires confirm:true to apply.',
    input_schema: { type: 'object', properties: { unit_number: { type: 'string' }, title: { type: 'string' }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical', 'safety'] }, confirm: { type: 'boolean' } }, required: ['unit_number', 'title'] },
  },
]

async function findTicketRow(ctx: Ctx, ticketNumber: string) {
  const { data } = await ctx.admin.from('repair_tickets')
    .select('id, ticket_number, title, status, due_date, assigned_to, asset_id')
    .eq('company_id', ctx.companyId).ilike('ticket_number', ticketNumber).maybeSingle()
  return data
}

async function executeTool(name: string, input: any, ctx: Ctx): Promise<string> {
  const a = ctx.admin
  const needWrite = ['set_ticket_due_date', 'assign_ticket', 'complete_ticket', 'create_ticket'].includes(name)
  if (needWrite && !ctx.canWrite) return `Permission denied: only owners and managers can make changes. The current user is a "${ctx.role}".`

  switch (name) {
    case 'find_ticket': {
      const q = String(input.query ?? '').trim()
      const { data } = await a.from('repair_tickets')
        .select('ticket_number, title, status, due_date, assets(unit_number), profiles!repair_tickets_assigned_to_fkey(full_name)')
        .eq('company_id', ctx.companyId)
        .or(`ticket_number.ilike.%${q}%,title.ilike.%${q}%`)
        .not('status', 'in', `(${TERMINAL.join(',')})`)
        .order('updated_at', { ascending: false }).limit(8)
      let rows = data ?? []
      if (!rows.length) {
        const { data: byAsset } = await a.from('repair_tickets')
          .select('ticket_number, title, status, due_date, assets!inner(unit_number), profiles!repair_tickets_assigned_to_fkey(full_name)')
          .eq('company_id', ctx.companyId).ilike('assets.unit_number', q)
          .not('status', 'in', `(${TERMINAL.join(',')})`).order('updated_at', { ascending: false }).limit(8)
        rows = byAsset ?? []
      }
      return JSON.stringify(rows.map((t: any) => ({ ticket: t.ticket_number, title: t.title, status: t.status, due: t.due_date, asset: t.assets?.unit_number, assigned: t.profiles?.full_name ?? 'Unassigned' })))
    }
    case 'list_overdue': {
      const today = new Date().toISOString().split('T')[0]
      const { data } = await a.from('repair_tickets')
        .select('ticket_number, title, due_date, assets(unit_number)')
        .eq('company_id', ctx.companyId).not('status', 'in', `(${TERMINAL.join(',')})`)
        .not('due_date', 'is', null).lt('due_date', today).order('due_date').limit(25)
      return JSON.stringify((data ?? []).map((t: any) => ({ ticket: t.ticket_number, title: t.title, due: t.due_date, asset: t.assets?.unit_number })))
    }
    case 'whos_clocked_in': {
      const { data } = await a.from('employee_statuses')
        .select('clock_status, current_status, profiles(full_name)')
        .eq('clock_status', 'clocked_in')
      return JSON.stringify((data ?? []).map((s: any) => ({ name: s.profiles?.full_name, status: s.current_status })))
    }
    case 'get_asset': {
      const { data: asset } = await a.from('assets')
        .select('id, unit_number, name, status, current_mileage')
        .eq('company_id', ctx.companyId).ilike('unit_number', String(input.unit_number).trim()).maybeSingle()
      if (!asset) return `No asset found with unit number "${input.unit_number}".`
      const { data: tix } = await a.from('repair_tickets')
        .select('ticket_number, title, status').eq('asset_id', asset.id)
        .not('status', 'in', `(${TERMINAL.join(',')})`).limit(10)
      return JSON.stringify({ asset, open_tickets: tix ?? [] })
    }
    case 'set_ticket_due_date': {
      const t = await findTicketRow(ctx, input.ticket_number)
      if (!t) return `No ticket found numbered "${input.ticket_number}".`
      if (input.confirm !== true) return `READY (needs confirmation): set ${t.ticket_number} ("${t.title}") due date to ${input.due_date}. Ask the user to confirm, then call again with confirm:true.`
      await a.from('repair_tickets').update({ due_date: input.due_date }).eq('id', t.id)
      return `Done: ${t.ticket_number} due date set to ${input.due_date}.`
    }
    case 'assign_ticket': {
      const t = await findTicketRow(ctx, input.ticket_number)
      if (!t) return `No ticket found numbered "${input.ticket_number}".`
      const { data: people } = await a.from('profiles').select('id, full_name')
        .eq('company_id', ctx.companyId).eq('is_active', true).ilike('full_name', `%${input.assignee_name}%`).limit(5)
      if (!people?.length) return `No active employee matches "${input.assignee_name}".`
      if (people.length > 1) return `Multiple people match "${input.assignee_name}": ${people.map(p => p.full_name).join(', ')}. Ask which one.`
      const person = people[0]
      if (input.confirm !== true) return `READY (needs confirmation): assign ${t.ticket_number} ("${t.title}") to ${person.full_name}. Ask the user to confirm, then call again with confirm:true.`
      const updates: any = { assigned_to: person.id }
      if (['new', 'open'].includes(t.status)) updates.status = 'assigned'
      await a.from('repair_tickets').update(updates).eq('id', t.id)
      await a.from('repair_ticket_assignments').update({ is_active: false }).eq('ticket_id', t.id)
      await a.from('repair_ticket_assignments').insert({ ticket_id: t.id, profile_id: person.id, assigned_by: ctx.userId })
      return `Done: ${t.ticket_number} assigned to ${person.full_name}.`
    }
    case 'complete_ticket': {
      const t = await findTicketRow(ctx, input.ticket_number)
      if (!t) return `No ticket found numbered "${input.ticket_number}".`
      if (input.confirm !== true) return `READY (needs confirmation): mark ${t.ticket_number} ("${t.title}") as Completed. Ask the user to confirm, then call again with confirm:true.`
      await a.from('repair_tickets').update({ status: 'completed', date_completed: new Date().toISOString().split('T')[0], completed_by: ctx.userId }).eq('id', t.id)
      return `Done: ${t.ticket_number} marked Completed.`
    }
    case 'create_ticket': {
      const { data: asset } = await a.from('assets').select('id, unit_number')
        .eq('company_id', ctx.companyId).ilike('unit_number', String(input.unit_number).trim()).maybeSingle()
      if (!asset) return `No asset found with unit number "${input.unit_number}".`
      if (input.confirm !== true) return `READY (needs confirmation): create a ${input.priority ?? 'normal'}-priority ticket on ${asset.unit_number}: "${input.title}". Ask the user to confirm, then call again with confirm:true.`
      const now = new Date()
      const prefix = `${now.getMonth() + 1}${now.getDate()}${now.getFullYear().toString().slice(-2)}`
      const { data: existing } = await a.from('repair_tickets').select('ticket_number')
        .eq('company_id', ctx.companyId).ilike('ticket_number', `${prefix}%`)
      const num = generateTicketNumber(now, asset.unit_number, (existing ?? []).map((e: any) => e.ticket_number))
      const { data: created } = await a.from('repair_tickets').insert({
        company_id: ctx.companyId, asset_id: asset.id, ticket_number: num, title: input.title,
        priority: input.priority ?? 'normal', status: 'open', source: 'assistant', created_by: ctx.userId,
      }).select('ticket_number').single()
      return `Done: created ticket ${created?.ticket_number} on ${asset.unit_number}.`
    }
    default:
      return `Unknown tool: ${name}`
  }
}

function systemPrompt(ctx: Ctx): string {
  return `You are "Ask RPS", the built-in assistant for the RP Intelligence app — a fleet/shop operations tool for Rappahannock Petroleum.

The person talking to you is signed in with the role "${ctx.role}". Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.

YOUR JOB
- Answer "how do I…" questions about using the app, in plain, friendly language (the owner is not technical).
- Look things up (tickets, assets, what's overdue, who's clocked in) using your tools.
- Make changes when asked (set a due date, assign, complete, create a ticket) — but ONLY through the rules below.

HOW THE APP WORKS (use this to answer how-to questions)
- Tickets: open the Tickets page (or Dashboard → Open Tickets). Click a ticket to open it. The ticket detail page has the status buttons (Start Work, Waiting on Parts, Mark Complete, Reopen) and an edit page for the title, priority, asset, and due date.
- Change a due date: open the ticket → Edit → set "Due Date" → Save. (Or just ask me to do it.)
- Assign someone: on the Tickets list or Dashboard Open Tickets, click the "Assigned To" cell and pick a person. (Or ask me.)
- Completed = Closed (one status, "Completed"). The "Completed" filter on the Tickets page shows all finished tickets.
- Assets: the Assets page lists everything; click a row to see its history. Building/Facility assets are "Property" (no mileage/inspection).
- Maintenance due, reminders (registration / state inspection), and Misc Tasks all show on the Dashboard.
- Email sync: shop emails to the maintenance inbox auto-create tickets; unmatched ones land in Settings → Email Review.

MAKING CHANGES — STRICT RULES
1. Only owners and managers can make changes. If the user's role can't, say so politely.
2. ALWAYS confirm before changing anything. First find the exact ticket, tell the user precisely what you'll do, and ask them to confirm. Only after they say yes do you call the tool with confirm:true.
3. If a ticket/asset/person is ambiguous, ask which one — never guess.
4. Use real data from tools; never invent ticket numbers, dates, or names.

Keep replies short and clear. Use the person's own words for assets/tickets.`
}

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'The assistant is not configured yet (missing ANTHROPIC_API_KEY).' }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile?.company_id) return NextResponse.json({ error: 'No company on file.' }, { status: 403 })

  const ctx: Ctx = {
    admin, companyId: profile.company_id, role: profile.role ?? 'viewer', userId: profile.id,
    canWrite: WRITE_ROLES.includes(profile.role ?? ''),
  }

  const body = await request.json().catch(() => ({}))
  const incoming = Array.isArray(body.messages) ? body.messages : []
  // Keep only role/content the API expects
  const messages: Anthropic.MessageParam[] = incoming
    .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m: any) => ({ role: m.role, content: m.content }))

  if (!messages.length) return NextResponse.json({ error: 'No message.' }, { status: 400 })

  const client = new Anthropic()
  const actions: string[] = []

  try {
    for (let i = 0; i < 8; i++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        thinking: { type: 'adaptive' },
        system: [{ type: 'text', text: systemPrompt(ctx), cache_control: { type: 'ephemeral' } }],
        tools,
        messages,
      })
      if (response.stop_reason !== 'tool_use') {
        const text = response.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()
        return NextResponse.json({ reply: text || '(no reply)', actions })
      }
      messages.push({ role: 'assistant', content: response.content })
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        const out = await executeTool(block.name, block.input, ctx)
        if (out.startsWith('Done:')) actions.push(out)
        results.push({ type: 'tool_result', tool_use_id: block.id, content: out })
      }
      messages.push({ role: 'user', content: results })
    }
    return NextResponse.json({ reply: "Sorry — I couldn't finish that in time. Try rephrasing.", actions })
  } catch (e: any) {
    console.error('[assistant]', e)
    return NextResponse.json({ error: e.message ?? 'Assistant error' }, { status: 500 })
  }
}
