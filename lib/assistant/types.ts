import type Anthropic from '@anthropic-ai/sdk'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { AssistantArea, AssistantWho } from './access'

/** Everything a look-up gets to work with. `admin` bypasses row security, so every query MUST filter on companyId. */
export type AssistantCtx = AssistantWho & {
  admin: ReturnType<typeof createAdminClient>
  companyId: string
  fullName: string
  /** The page the person had open when they asked ("this job" = the job on that page). */
  page: string | null
}

export type ToolDef = {
  /** Unique across every area. */
  name: string
  area: AssistantArea
  description: string
  input_schema: Anthropic.Tool['input_schema']
  /** Extra check on top of the area (for example: only roles that may change tickets). */
  allowed?: (ctx: AssistantCtx) => boolean
  /** Changes something. These always preview first and need confirm:true. */
  writes?: boolean
  run: (input: Record<string, unknown>, ctx: AssistantCtx) => Promise<string>
}

/** The answer a look-up gives back. Rows are trimmed so a big list never floods the conversation. */
export const out = (v: unknown) => JSON.stringify(v)

/** Read a text input, trimmed and capped. */
export const str = (v: unknown, max = 80) => String(v ?? '').trim().slice(0, max)

/** Text that goes into a PostgREST filter (ilike / or): plain words, numbers and a few marks only. */
export const term = (v: unknown, max = 60) => String(v ?? '').replace(/[^\w\s.&'#/-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** A number input between lo and hi, or the fallback. */
export const num = (v: unknown, fallback: number, lo = 1, hi = 50) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
export const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Site numbers are typed many ways (SU-5015, su5015, 5015). Returns the forms worth searching for. */
export function siteVariants(raw: unknown): string[] {
  const t = term(raw, 20).toUpperCase().replace(/\s+/g, '')
  if (!t) return []
  const bare = t.replace(/^[A-Z]+-?/, '')
  const set = new Set([t, bare])
  const m = t.match(/^([A-Z]+)-?(\d.*)$/)
  if (m) { set.add(`${m[1]}-${m[2]}`); set.add(`${m[1]}${m[2]}`) }
  return [...set].filter(Boolean)
}
