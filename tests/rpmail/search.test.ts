import { beforeEach, describe, expect, it } from 'vitest'
import { world, addPerson, addBox, type Person } from './fakes'
import { requireMe, mailboxFor, type Me } from '@/lib/rpmail/access'
import { syncMailbox } from '@/lib/rpmail/sync'
import { searchAll, searchAllFurther } from '@/lib/rpmail/search'

// One search over every mailbox a person has (Trae, 11/25/26): mail filed into a folder of another mailbox (an Anthropic
// email Proton filed under RPS, so it was Work mail) is found, and each result says which mailbox and folder it is in.

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
let ann: Person, bob: Person, me: Me, mine: string, work: string

beforeEach(async () => {
  ann = addPerson(A, 'owner', 'Ann Owner', 'ann@gmail.com'); bob = addPerson(A, 'manager', 'Bob Manager', 'bob@gmail.com')
  mine = addBox(A, 'ann@gmail.com', 'personal', [ann])
  work = addBox(A, 'work@gmail.com', 'shared', [ann])
  addBox(A, 'bob@gmail.com', 'personal', [bob])
  const folder = world.gmail.addLabel('work@gmail.com', 'RPS/Claude Anthropic')
  world.gmail.add('work@gmail.com', { from: 'no-reply@mail.anthropic.com', subject: 'Your secure link to Claude is here', labelIds: [folder.id, 'UNREAD'] })
  world.gmail.add('ann@gmail.com', { from: 'billing@anthropic.com', subject: 'Your receipt from Anthropic' })
  world.gmail.add('bob@gmail.com', { from: 'no-reply@mail.anthropic.com', subject: 'Bob anthropic private' })
  world.user = ann.id
  me = await requireMe()
  for (const b of [mine, work]) await syncMailbox(await mailboxFor(me, b))
})

describe('search every mailbox', () => {
  it('finds mail in every mailbox the person has, and says which mailbox and which folder', async () => {
    const r = await searchAll(me, { q: 'anthropic' })
    const got = r.messages.map(m => ({ box: m.mailbox_id, subject: m.subject, where: m.where }))
    expect(got).toEqual(expect.arrayContaining([
      { box: work, subject: 'Your secure link to Claude is here', where: 'RPS / Claude Anthropic' },   // filed away, not in any inbox
      { box: mine, subject: 'Your receipt from Anthropic', where: 'Inbox' },
    ]))
    expect(got).toHaveLength(2)
    expect(r.messages.some(m => m.subject.startsWith('Bob'))).toBe(false)                              // never someone else's mailbox
  })

  it('needs every word to match, and at least two letters', async () => {
    expect((await searchAll(me, { q: 'secure claude' })).messages.map(m => m.subject)).toEqual(['Your secure link to Claude is here'])
    expect((await searchAll(me, { q: 'secure receipt' })).messages).toEqual([])
    await expect(searchAll(me, { q: 'a' })).rejects.toThrow(/Type something/)
    await expect(searchAll(me, { q: '%%' })).rejects.toThrow(/Type something/)
  })

  it('looks further back by asking each mailbox itself, and only the person\'s own', async () => {
    // Older mail RPMail never loaded: only the mailbox itself knows about it.
    world.gmail.add('work@gmail.com', { from: 'old@vendor.com', subject: 'Drop tube order from 2024', labelIds: [], date: Date.now() - 400 * 86_400_000 })
    world.gmail.fresh.set('work@gmail.com', [])
    expect((await searchAll(me, { q: 'drop tube' })).messages).toEqual([])
    const r = await searchAllFurther(me, { q: 'drop tube' })
    expect(r.messages.map(m => [m.mailbox_id, m.subject])).toEqual([[work, 'Drop tube order from 2024']])
    expect(r.missed).toEqual([])
    expect(world.gmail.calls.filter(c => c.account === 'bob@gmail.com')).toEqual([])
  })
})
