import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasComplianceGrant } from '@/lib/compliance-guard'
import { isSurveyOnly } from '@/lib/field-surveys'
import { toolsFor, toApiTools, runTool } from '@/lib/assistant/registry'
import { systemPrompt, pageNote } from '@/lib/assistant/prompt'
import type { AssistantCtx } from '@/lib/assistant/types'
import { IS_DEMO } from '@/lib/demo'

// A question can take several look-ups in a row; give it room.
export const maxDuration = 120

// Claude Opus 5.5 by default; ASSISTANT_MODEL in Vercel overrides it without a code change.
const MODEL = process.env.ASSISTANT_MODEL || 'claude-opus-5-5'
// If the model declines a request on safety grounds, the API re-runs it on this one inside the same call.
const FALLBACK_MODEL = process.env.ASSISTANT_FALLBACK_MODEL || 'claude-opus-4-8'
const MAX_ROUNDS = 10
const MAX_HISTORY = 30          // messages kept from the conversation the browser sends
const MAX_MESSAGE_CHARS = 4000

export async function POST(request: NextRequest) {
  if (IS_DEMO && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'Ask RP (the AI assistant) is turned off in this public demo. In the real app it answers questions about your jobs, trucks and tickets.' }, { status: 503 })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'The assistant is not configured yet (missing ANTHROPIC_API_KEY).' }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role, full_name, is_active').eq('id', user.id).single()
  if (!profile?.company_id || profile.is_active === false) return NextResponse.json({ error: 'No company on file.' }, { status: 403 })
  if (isSurveyOnly(profile.role)) return NextResponse.json({ error: 'Ask RPS is not part of this login.' }, { status: 403 })

  const [{ data: blocks }, complianceGranted] = await Promise.all([
    admin.from('profile_module_blocks').select('module').eq('profile_id', user.id),
    hasComplianceGrant(admin, profile.company_id, user.id),
  ])

  const body = await request.json().catch(() => ({}))
  const page = typeof body.page === 'string' && body.page.startsWith('/') ? body.page.slice(0, 200) : null

  const ctx: AssistantCtx = {
    admin, companyId: profile.company_id, userId: profile.id, role: profile.role ?? 'viewer',
    fullName: profile.full_name ?? '', blockedModules: (blocks ?? []).map(b => b.module), complianceGranted, page,
  }

  // Only plain user / assistant text from the browser; trimmed so an old, long chat cannot grow without limit.
  const incoming = Array.isArray(body.messages) ? body.messages : []
  const history: Anthropic.Beta.BetaMessageParam[] = incoming
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, MAX_MESSAGE_CHARS) }))
  while (history.length && history[0].role !== 'user') history.shift()
  if (!history.length || history[history.length - 1].role !== 'user') return NextResponse.json({ error: 'No message.' }, { status: 400 })

  const tools = toolsFor(ctx)
  const apiTools = toApiTools(tools)
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    // Stable for this person, so it is cached across their questions.
    { type: 'text', text: systemPrompt(ctx, tools), cache_control: { type: 'ephemeral' } },
    // Changes every question (date, open page), so it sits after the cache point.
    { type: 'text', text: await pageNote(ctx) },
  ]

  const client = new Anthropic()
  const messages = [...history]
  const actions: string[] = []
  const looked: string[] = []

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 8000,
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-06-01'],
        fallbacks: [{ model: FALLBACK_MODEL }],
        system,
        tools: apiTools,
        messages,
      })

      if (response.stop_reason === 'refusal') {
        return NextResponse.json({ reply: "Sorry, I can't help with that one. Try asking it another way.", actions, looked })
      }
      if (response.stop_reason !== 'tool_use') {
        const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('\n').trim()
        const cut = response.stop_reason === 'max_tokens' ? '\n\n(That answer ran long and was cut off. Ask me to continue.)' : ''
        return NextResponse.json({ reply: (text || '(no reply)') + cut, actions, looked })
      }

      // Pass the model's turn back unchanged, then answer every tool call in one message.
      messages.push({ role: 'assistant', content: response.content })
      const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
      const results = await Promise.all(calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const result = await runTool(call.name, call.input, ctx)
        if (result.startsWith('Done:')) actions.push(result)
        looked.push(call.name)
        return { type: 'tool_result', tool_use_id: call.id, content: result.slice(0, 40_000) }
      }))
      messages.push({ role: 'user', content: results })
    }
    return NextResponse.json({ reply: "Sorry, I couldn't finish that in time. Try asking a narrower question.", actions, looked })
  } catch (e) {
    console.error('[assistant]', e)
    if (e instanceof Anthropic.RateLimitError) return NextResponse.json({ error: 'Ask RPS is busy right now. Try again in a minute.' }, { status: 429 })
    // The API answers an empty prepaid balance with a plain 400; say what it is so the owner knows to add credit.
    if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message))
      return NextResponse.json({ error: 'Ask RPS is paused: the company\'s Anthropic API credit has run out. An owner needs to add credit (console.anthropic.com → Billing).' }, { status: 503 })
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: `Ask RPS could not answer (${e.status ?? 'error'}). Try again.` }, { status: 502 })
    return NextResponse.json({ error: 'Assistant error. Try again.' }, { status: 500 })
  }
}
