import { timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { Busy, NotConnected, UserError } from './gmail'

// RPMail: Proton mailboxes. Proton mail is only reachable through Proton Bridge on the Mac Studio, which the website cannot
// call. So a helper on that Mac (~/rpmail-relay) calls the website instead: it asks for work, answers each Gmail-style
// question from Bridge, and sends the answer back. To the rest of RPMail a Proton mailbox looks exactly like a Gmail one:
// `gmail()` hands its calls here instead of to Google.
//
// The helper proves itself with a shared secret (RPMAIL_RELAY_SECRET here, the Keychain on the Mac), and it is only ever
// given work for Proton mailboxes whose address it names. Answers can hold message text, so each is deleted as soon as
// it is read, and anything left over is cleared within minutes.

const providers = new Map<string, { proton: boolean; at: number }>()
/** Is this a Proton mailbox (answered by the Mac helper)? Remembered for a minute. */
export async function isRelayBox(mailboxId: string): Promise<boolean> {
  const hit = providers.get(mailboxId)
  if (hit && Date.now() - hit.at < 60_000) return hit.proton
  const { data } = await createAdminClient().from('rpmail_mailboxes').select('provider').eq('id', mailboxId).maybeSingle()
  const proton = data?.provider === 'proton'
  providers.set(mailboxId, { proton, at: Date.now() })
  return proton
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const PART = 3_000_000

/** One Gmail-style call answered by the Mac helper. Same results as `gmail()`: the answer, null for "not found", or an error. */
// 15 seconds at most: a background round has about 14 seconds per mailbox, so one slow answer must not use up a whole round.
export async function relayCall<T>(mailboxId: string, method: string, path: string, params: Record<string, string | string[]>, body: unknown, waitMs = 15_000): Promise<T | null> {
  const admin = createAdminClient()
  const { data: box } = await admin.from('rpmail_mailboxes').select('address, relay_seen_at').eq('id', mailboxId).maybeSingle()
  if (!box) throw new UserError('No such mailbox.')
  const seen = box.relay_seen_at ? Date.parse(box.relay_seen_at as string) : 0
  if (Date.now() - seen > 120_000) throw new NotConnected('The Mac Studio is not answering. Proton mail only comes through while the Mac Studio is on and its RPMail helper is running.')
  const { data: job, error } = await admin.from('rpmail_relay_jobs').insert({ mailbox_id: mailboxId, address: box.address, method, path, params, body: body ?? null }).select('id').single()
  if (error || !job) throw new Error('Could not ask the Mac Studio.')
  try {
    const until = Date.now() + waitMs
    for (let wait = 100; Date.now() < until; wait = Math.min(wait + 50, 400)) {
      await sleep(wait)
      const { data: j } = await admin.from('rpmail_relay_jobs').select('status, code, parts').eq('id', job.id).maybeSingle()
      if (!j || j.status !== 'done') continue
      const { data: parts } = await admin.from('rpmail_relay_parts').select('seq, data').eq('job_id', job.id).order('seq')
      const text = (parts ?? []).map(p => p.data as string).join('')
      const code = Number(j.code)
      if (code === 404) return null
      const json = text ? JSON.parse(text) as T & { error?: { message?: string } } : ({} as T & { error?: { message?: string } })
      if (code >= 200 && code < 300) return json
      const msg = json?.error?.message ?? ''
      if (code === 429) throw new Busy('Proton is busy with this mailbox right now. Try again in a moment.')
      if (code === 401) throw new NotConnected('The Mac Studio cannot sign in to Proton Bridge. Check that Proton Bridge is open on the Mac Studio.')
      if (code === 501) throw new UserError('That does not work for Proton mailboxes yet.')
      if (code === 400) throw new UserError(msg || 'Proton refused that.')
      throw new Error(`The Mac Studio said ${code}: ${msg.slice(0, 200)}`)
    }
    throw new Busy('The Mac Studio is taking too long to answer. Try again in a moment.')
  } finally {
    // The answer can hold message text: gone as soon as it has been read (parts first, then the job).
    await admin.from('rpmail_relay_parts').delete().eq('job_id', job.id)
    await admin.from('rpmail_relay_jobs').delete().eq('id', job.id)
  }
}

/** Is this the Mac helper? Compares the secret without leaking how much of it matched. */
export function relayAllowed(given: string | null): boolean {
  const want = process.env.RPMAIL_RELAY_SECRET ?? ''
  if (want.length < 32 || !given) return false
  const a = Buffer.from(given), b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}

type Result = { job: number; seq: number; last: boolean; code: number; data: string }
type Pull = { addresses?: unknown; results?: unknown; wait?: unknown }

/**
 * The Mac helper's one door. It says which Proton addresses it serves, hands back answers (in parts of up to 3 MB),
 * and, when it asks to wait, gets the next jobs for those addresses as they arrive (up to 20 seconds).
 */
export async function relayExchange(p: Pull) {
  const admin = createAdminClient()
  const addresses = (Array.isArray(p.addresses) ? p.addresses : []).map(a => String(a).trim().toLowerCase()).filter(a => /^[^@\s]+@[^@\s]+$/.test(a)).slice(0, 10)
  if (!addresses.length) throw new UserError('Say which addresses this helper serves.')
  const { data: boxes } = await admin.from('rpmail_mailboxes').select('id, address').eq('provider', 'proton').in('address', addresses)
  const mine = new Set((boxes ?? []).map(b => b.id as string))
  if (mine.size) await admin.from('rpmail_mailboxes').update({ relay_seen_at: new Date().toISOString() }).in('id', [...mine])

  // Answers: only for jobs that belong to one of this helper's mailboxes and are still waiting.
  const results = (Array.isArray(p.results) ? p.results : []) as Result[]
  for (const r of results.slice(0, 50)) {
    const id = Number(r?.job), seq = Number(r?.seq)
    if (!Number.isInteger(id) || !Number.isInteger(seq) || seq < 0 || seq > 40 || typeof r.data !== 'string' || r.data.length > PART + 100) continue
    const { data: j } = await admin.from('rpmail_relay_jobs').select('mailbox_id, status').eq('id', id).maybeSingle()
    if (!j || !mine.has(j.mailbox_id as string) || j.status !== 'taken') continue
    await admin.from('rpmail_relay_parts').upsert({ job_id: id, seq, data: r.data }, { onConflict: 'job_id,seq' })
    if (r.last) await admin.from('rpmail_relay_jobs').update({ status: 'done', code: Math.trunc(Number(r.code) || 500), parts: seq + 1, done_at: new Date().toISOString() }).eq('id', id)
  }

  if (p.wait !== true || !mine.size) return { jobs: [] }
  // Held open 15 seconds at most, well inside the 60-second limit even when the database is slow.
  const until = Date.now() + 15_000
  while (Date.now() < until) {
    const { data: fresh } = await admin.from('rpmail_relay_jobs').select('id').eq('status', 'new').in('mailbox_id', [...mine]).order('id').limit(20)
    if (fresh?.length) {
      // Claimed in one step, so two helpers (or two calls) never take the same job.
      const { data: taken } = await admin.from('rpmail_relay_jobs').update({ status: 'taken', taken_at: new Date().toISOString() })
        .in('id', fresh.map(f => f.id)).eq('status', 'new').select('id, address, method, path, params, body')
      if (taken?.length) return { jobs: taken }
    }
    await sleep(250)
  }
  return { jobs: [] }
}

/** Jobs nobody collected (the website gave up, or the helper went away): cleared after five minutes. */
export async function cleanRelay() {
  await createAdminClient().from('rpmail_relay_jobs').delete().lt('created_at', new Date(Date.now() - 300_000).toISOString())
}
