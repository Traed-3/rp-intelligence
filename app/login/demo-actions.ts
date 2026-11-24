'use server'

import { redirect } from 'next/navigation'
import { createClient as createSupabase } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '@/lib/supabase/keys'
import { DEMO_EMAIL, demoDatabaseIsSafe } from '@/lib/demo'

/**
 * "Try the demo" — signs the visitor in as the shared demo owner.
 * Before signing in it puts the demo login back the way it should be (password, active, owner, no blocks),
 * so one visitor fiddling with Settings can never lock the next one out.
 */
export async function signInToDemo(): Promise<{ error: string } | void> {
  const password = process.env.DEMO_USER_PASSWORD
  if (!demoDatabaseIsSafe() || !password) return { error: 'The demo is not available right now.' }

  // Raw service client on purpose: the demo guard in lib/supabase/admin.ts blocks password changes for everyone else.
  const raw = createSupabase(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: list } = await raw.auth.admin.listUsers({ page: 1, perPage: 200 })
  const demoUser = list?.users.find(u => u.email === DEMO_EMAIL)
  if (!demoUser) return { error: 'The demo is not available right now.' }
  await raw.auth.admin.updateUserById(demoUser.id, { password, email: DEMO_EMAIL, ban_duration: 'none' })
  await raw.from('profiles').update({ is_active: true, role: 'owner', must_change_password: false }).eq('id', demoUser.id)
  await raw.from('profile_module_blocks').delete().eq('profile_id', demoUser.id)

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password })
  if (error) return { error: 'Could not start the demo. Please try again.' }
  redirect('/')
}
