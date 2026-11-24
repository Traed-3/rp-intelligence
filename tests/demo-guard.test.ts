import { test, expect, vi, afterEach } from 'vitest'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

async function adminWithDemo(on: boolean) {
  vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', on ? '1' : '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key')
  vi.resetModules()
  // The shared test setup swaps the admin client for a fake; this test needs the real factory.
  const { createAdminClient } = await vi.importActual<typeof import('@/lib/supabase/admin')>('@/lib/supabase/admin')
  return createAdminClient()
}

test('public demo: account changes and uploads are blocked, reads still work', async () => {
  const a = await adminWithDemo(true)
  expect((await a.auth.admin.updateUserById('u', { password: 'x' })).error?.message).toMatch(/turned off in the demo/)
  expect((await a.auth.admin.createUser({ email: 'a@b.c' })).error?.message).toMatch(/turned off in the demo/)
  expect((await a.auth.admin.deleteUser('u')).error?.message).toMatch(/turned off in the demo/)
  expect((await a.storage.from('receipts').upload('x.txt', new Blob(['x']))).error?.message).toMatch(/uploads are turned off/)
  expect(typeof a.from('profiles').select).toBe('function')
  expect(typeof a.storage.from('receipts').createSignedUrl).toBe('function')
  expect(typeof a.auth.admin.listUsers).toBe('function')
})

test('outside the demo the admin client is untouched', async () => {
  const a = await adminWithDemo(false)
  expect(a.auth.admin.updateUserById.name).not.toBe('blocked')
})
