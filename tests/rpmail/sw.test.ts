import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The notification handler that runs on each phone and computer (public/sw.js), run here against a stand-in device.
function device(canShow = true) {
  const handlers: Record<string, (e: unknown) => void> = {}
  const shown: { title: string; body?: string; icon?: string }[] = []
  const store = new Map<string, Map<string, Response>>()
  const caches = {
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map())
      const c = store.get(name)!
      return { put: async (k: string, r: Response) => { c.set(k, r) }, match: async (k: string) => c.get(k) }
    },
    keys: async () => [...store.keys()],
    delete: async (k: string) => store.delete(k),
    match: async () => undefined,
  }
  const self = {
    addEventListener: (name: string, fn: (e: unknown) => void) => { handlers[name] = fn },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
    registration: { showNotification: async (title: string, o: { body?: string; icon?: string }) => { if (!canShow) throw new Error('NotAllowedError'); shown.push({ title, ...o }) } },
    location: { origin: 'https://rpintelligence.app' },
  }
  new Function('self', 'caches', 'clients', readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8'))(self, caches, self.clients)
  const push = async (payload: unknown) => {
    let done: Promise<unknown> = Promise.resolve()
    handlers.push({ data: { json: () => { if (payload === undefined) throw new Error('no data'); return payload } }, waitUntil: (p: Promise<unknown>) => { done = p } })
    await done
  }
  const last = async () => { const r = await (await caches.open('rps-diag')).match('/__push-last'); return r ? await r.json() as { at: number; shown: boolean; title?: string; body?: string } : null }
  return { handlers, shown, store, push, last, caches }
}

describe('the notification handler on a device', () => {
  it('shows every notification it receives and writes down that it arrived, without keeping any of its words', async () => {
    const d = device()
    const before = Date.now()
    await d.push({ title: 'Pat (office)', body: 'Can you call me about the quote?', link: '/rpmail' })
    expect(d.shown).toEqual([expect.objectContaining({ title: 'Pat (office)', body: 'Can you call me about the quote?', icon: '/icon-192-v2.png' })])
    const l = await d.last()
    expect(l!.at).toBeGreaterThanOrEqual(before)
    expect(l).toEqual({ at: l!.at, shown: true })      // only the time and the outcome: no sender, no subject
  })

  it('still shows something when the notification arrives empty', async () => {
    const d = device()
    await d.push(undefined)
    expect(d.shown.length).toBe(1)
    expect(d.shown[0].title).toBe('RP Intelligence')
  })

  it('records that the device refused to show it, rather than failing silently', async () => {
    const d = device(false)
    await d.push({ title: 'x', body: 'y' })
    expect(d.shown).toEqual([])
    expect((await d.last())!.shown).toBe(false)
  })

  it('keeps that record when a new version of the handler takes over', async () => {
    const d = device()
    await d.push({ title: 'x', body: 'y' })
    await d.caches.open('old-junk')
    let done: Promise<unknown> = Promise.resolve()
    d.handlers.activate({ waitUntil: (p: Promise<unknown>) => { done = p } })
    await done
    expect([...d.store.keys()]).toEqual(['rps-diag'])
  })
})
