import { beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/rpmail/relay/route'
import { world, addPerson, addBox, type Person } from './fakes'
import { requireMe, mailboxFor } from '@/lib/rpmail/access'
import { gmail, NotConnected, UserError } from '@/lib/rpmail/gmail'
import { relayExchange, cleanRelay } from '@/lib/rpmail/relay'
import { sendMail } from '@/lib/rpmail/mail-ops'

// Proton mailboxes are answered by a helper on the Mac Studio. The website writes each Gmail-style question as a job, the
// helper collects jobs for the Proton addresses it serves and sends back the answers, and the website reads and deletes them.

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const SECRET = 'x'.repeat(40)
let ann: Person, proton: string, other: string

const helper = async (answer: (job: { path: string; params: Record<string, unknown> }) => { code: number; body: unknown }, addresses = ['ann@proton.me']) => {
  // The helper's loop, once: collect jobs, answer each.
  const r = await relayExchange({ addresses, wait: true }) as { jobs: { id: number; path: string; params: Record<string, unknown> }[] }
  const results = r.jobs.map(j => { const a = answer(j); return { job: j.id, seq: 0, last: true, code: a.code, data: JSON.stringify(a.body) } })
  await relayExchange({ addresses, results })
  return r.jobs.length
}

beforeEach(() => {
  process.env.RPMAIL_RELAY_SECRET = SECRET
  ann = addPerson(A, 'owner', 'Ann Owner', 'ann@gmail.com')
  proton = addBox(A, 'ann@proton.me', 'shared', [ann], { provider: 'proton', relay_seen_at: new Date().toISOString() })
  other = addBox(A, 'bob@proton.me', 'shared', [ann], { provider: 'proton', relay_seen_at: new Date().toISOString() })
  world.user = ann.id
})

describe('a Proton mailbox', () => {
  it('sends Gmail-style questions to the Mac helper instead of to Google, and returns its answer', async () => {
    const asked = gmail<{ emailAddress: string }>(proton, 'profile')
    let served = 0
    for (let i = 0; i < 20 && !served; i++) served = await helper(() => ({ code: 200, body: { emailAddress: 'ann@proton.me', historyId: '5' } }))
    expect(await asked).toEqual({ emailAddress: 'ann@proton.me', historyId: '5' })
    expect(world.gmail.calls).toEqual([])                                  // Google was never asked
    expect(world.db.t('rpmail_relay_jobs')).toEqual([])                    // the answer is gone once read
    expect(world.db.t('rpmail_relay_parts')).toEqual([])
  })

  it('turns the helper\'s answers into the same results Gmail gives: not found, not yet, busy', async () => {
    const run = async (code: number) => {
      const p = gmail(proton, 'messages/0000000100000002').then(v => v, e => e)
      for (let i = 0; i < 20; i++) if (await helper(() => ({ code, body: { error: { message: 'x' } } }))) break
      return p
    }
    expect(await run(404)).toBeNull()
    expect(await run(501)).toBeInstanceOf(UserError)
    expect(await run(401)).toBeInstanceOf(NotConnected)
    const late = await run(408)
    expect(late).toBeInstanceOf(UserError)
    expect(String(late.message)).toMatch(/too late, so it was not sent/)
  })

  it('hands a large message to the helper in pieces, and only to the helper that serves that mailbox', async () => {
    const raw = 'a'.repeat(400_000)
    const sent = gmail(proton, 'messages/send', { method: 'POST', body: { raw } })
    let r: { jobs: { id: number; body: { _parts?: number }; created_at?: string }[] } = { jobs: [] }
    for (let i = 0; i < 20 && !r.jobs.length; i++) r = await relayExchange({ addresses: ['ann@proton.me'], wait: true }) as typeof r
    const job = r.jobs[0]
    expect(job.body).toEqual({ _parts: 1 })                                 // the message itself is not in the job list
    expect(Date.now() - Date.parse(job.created_at!)).toBeLessThan(60_000)    // so the helper can refuse a late send
    expect(await relayExchange({ addresses: ['bob@proton.me'], body_of: { job: job.id, seq: 0 } })).toEqual({ data: null })
    const piece = await relayExchange({ addresses: ['ann@proton.me'], body_of: { job: job.id, seq: 0 } }) as { data: string }
    expect(JSON.parse(piece.data)).toEqual({ raw })
    await relayExchange({ addresses: ['ann@proton.me'], results: [{ job: job.id, seq: 0, last: true, code: 200, data: '{}' }] })
    expect(await sent).toEqual({})                                          // the answer pieces only, not the message
    expect(world.db.t('rpmail_relay_parts')).toEqual([])                    // and every piece is gone afterwards
    expect(world.db.t('rpmail_relay_jobs')).toEqual([])
  })

  it('sends from a Proton mailbox only through the helper, as that mailbox, after the person confirmed', async () => {
    const who = await requireMe()
    await expect(sendMail(who, { mailbox: proton, to: 'zed@example.com', subject: 'Hi', body: 'Hello' })).rejects.toThrow(/confirm/)
    expect(world.db.t('rpmail_relay_jobs')).toEqual([])                     // nothing reached the Mac
    const going = sendMail(who, { mailbox: proton, to: 'zed@example.com', subject: 'Hi', body: 'Hello', confirmed: true })
    type Job = { id: number; path: string; body: { raw: string } }
    let job: Job | undefined
    for (let i = 0; i < 40 && !job; i++) job = (await relayExchange({ addresses: ['ann@proton.me'], wait: true }) as unknown as { jobs: Job[] }).jobs[0]
    expect(job!.path).toBe('messages/send')
    const message = Buffer.from(job!.body.raw, 'base64url').toString()
    expect(message).toMatch(/^From: .*<ann@proton\.me>/m)
    expect(message).toMatch(/^To: zed@example\.com/m)
    await relayExchange({ addresses: ['ann@proton.me'], results: [{ job: job!.id, seq: 0, last: true, code: 200, data: '{}' }] })
    expect(await going).toMatchObject({ ok: true, sent: true, from: 'ann@proton.me' })
    expect(world.gmail.calls).toEqual([])
  })

  it('says the Mac Studio is not answering when the helper has not been heard from', async () => {
    world.db.t('rpmail_mailboxes').find(b => b.id === proton)!.relay_seen_at = new Date(Date.now() - 600_000).toISOString()
    await expect(gmail(proton, 'profile')).rejects.toThrow(/Mac Studio is not answering/)
  })

  it('only gives a helper work for the Proton addresses it names, and takes answers only for those', async () => {
    const p1 = gmail(proton, 'profile').catch(e => e), p2 = gmail(other, 'profile').catch(e => e)
    await new Promise(r => setTimeout(r, 150))
    const r = await relayExchange({ addresses: ['ann@proton.me'], wait: true }) as { jobs: { id: number; address: string }[] }
    expect(r.jobs.map(j => j.address)).toEqual(['ann@proton.me'])
    const bobJob = world.db.t('rpmail_relay_jobs').find(j => j.address === 'bob@proton.me')!
    await relayExchange({ addresses: ['ann@proton.me'], results: [{ job: bobJob.id as number, seq: 0, last: true, code: 200, data: '{"evil":true}' }] })
    expect(world.db.t('rpmail_relay_jobs').find(j => j.id === bobJob.id)!.status).toBe('new')   // not accepted
    await relayExchange({ addresses: ['ann@proton.me'], results: r.jobs.map(j => ({ job: j.id, seq: 0, last: true, code: 200, data: '{"ok":1}' })) })
    expect(await p1).toEqual({ ok: 1 })
    await relayExchange({ addresses: ['bob@proton.me'], wait: true }).then(x => relayExchange({ addresses: ['bob@proton.me'], results: (x as { jobs: { id: number }[] }).jobs.map(j => ({ job: j.id, seq: 0, last: true, code: 200, data: '{"bob":1}' })) }))
    expect(await p2).toEqual({ bob: 1 })
  })

  it('puts a long answer back together from its parts', async () => {
    const p = gmail<{ text: string }>(proton, 'messages/0000000100000002')
    let r: { jobs: { id: number }[] } = { jobs: [] }
    for (let i = 0; i < 20 && !r.jobs.length; i++) r = await relayExchange({ addresses: ['ann@proton.me'], wait: true }) as typeof r
    const text = JSON.stringify({ text: 'y'.repeat(50) })
    await relayExchange({ addresses: ['ann@proton.me'], results: [{ job: r.jobs[0].id, seq: 0, last: false, code: 200, data: text.slice(0, 20) }] })
    await relayExchange({ addresses: ['ann@proton.me'], results: [{ job: r.jobs[0].id, seq: 1, last: true, code: 200, data: text.slice(20) }] })
    expect((await p)!.text).toBe('y'.repeat(50))
  })

  it('the helper\'s door refuses anyone without the secret', async () => {
    const call = (auth?: string) => POST(new NextRequest('https://rpintelligence.app/api/rpmail/relay', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify({ addresses: ['ann@proton.me'] }) }))
    expect((await call()).status).toBe(403)
    expect((await call('Bearer wrong')).status).toBe(403)
    expect((await call('Bearer ' + 'x'.repeat(39) + 'y')).status).toBe(403)
    expect((await call('Bearer ' + SECRET)).status).toBe(200)
    process.env.RPMAIL_RELAY_SECRET = ''
    expect((await call('Bearer ')).status).toBe(403)                       // no secret set: nobody gets in
  })

  it('clears jobs nobody collected', async () => {
    world.db.t('rpmail_relay_jobs').push({ id: 99, mailbox_id: proton, address: 'ann@proton.me', method: 'GET', path: 'profile', status: 'new', created_at: new Date(Date.now() - 600_000).toISOString() })
    await cleanRelay()
    expect(world.db.t('rpmail_relay_jobs').find(j => j.id === 99)).toBeUndefined()
  })

  it('still runs every access rule: a Proton mailbox the person was not given stays closed', async () => {
    const bob = addPerson(A, 'manager', 'Bob', 'bob@gmail.com')
    world.user = bob.id
    await expect(mailboxFor(await requireMe(), proton)).rejects.toThrow()
  })
})
