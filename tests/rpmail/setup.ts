import { beforeEach, vi } from 'vitest'
import { world, FakeDb, FakeGmail } from './fakes'

process.env.RPMAIL_GOOGLE_CLIENT_ID = 'test-client'
process.env.RPMAIL_GOOGLE_CLIENT_SECRET = 'test-secret'

// The two doors to the outside world are replaced for every test.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => world.db.client }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: world.user ? { id: world.user, email: '' } : null } }) } }) }))

beforeEach(() => {
  world.db = new FakeDb(); world.gmail = new FakeGmail(); world.user = null
  vi.stubGlobal('fetch', world.gmail.fetch)
})
