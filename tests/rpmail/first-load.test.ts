import { beforeEach, describe, expect, it, vi } from 'vitest'
import { world, addPerson, addBox, type Person } from './fakes'
import { requireMe, mailboxFor, type Me } from '@/lib/rpmail/access'
import { syncMailbox } from '@/lib/rpmail/sync'

// Found on a real mailbox (2026-11-23): the first load of a mailbox used up Google's allowance, so a message opened at the
// same time hung for half a minute, and messages Google refused were skipped for good. Now the first load stops at the
// first "slow down" and tries those messages again on the next round.

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
let ann: Person, me: Me, box: string

beforeEach(async () => {
  ann = addPerson(A, 'owner', 'Ann Owner', 'ann@gmail.com')
  box = addBox(A, 'ann@gmail.com', 'personal', [ann])
  for (let i = 0; i < 12; i++) world.gmail.add('ann@gmail.com', { from: `p${i}@vendor.com`, subject: 'Message ' + i, body: 'hello' })
  world.user = ann.id
  me = await requireMe()
})

describe('the first load of a mailbox', () => {
  it('stops at Google\'s first "slow down", says it is busy, and loses nothing', async () => {
    const real = world.gmail.fetch
    let refuse = 4                                       // Google refuses the next few message reads, then lets them through
    vi.stubGlobal('fetch', async (u: string | URL | Request, i?: RequestInit) => {
      if (/\/messages\/[0-9a-f]+\?/.test(String(u)) && refuse > 0) { refuse--; return new Response(JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }), { status: 403 }) }
      return real(u, i)
    })
    const first = await syncMailbox(await mailboxFor(me, box))
    expect(first).toMatchObject({ done: false, busy: true })
    expect(first.left).toBeGreaterThan(0)
    vi.stubGlobal('fetch', real)
    let r = first
    for (let n = 0; n < 10 && !r.done; n++) r = await syncMailbox(await mailboxFor(me, box))
    expect(r.done).toBe(true)
    expect(world.db.t('rpmail_messages').filter(m => m.mailbox_id === box).length).toBe(12)    // every message made it in
  })
})
