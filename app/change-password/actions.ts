'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { validateNewPassword } from '@/lib/password-rules'

export type ChangeState = { error?: string } | null

/** First sign-in after an owner/manager set a temporary password: the person picks their own. Never stored or logged by the app. */
export async function changeOwnPassword(_s: ChangeState, formData: FormData): Promise<ChangeState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Only for someone who was handed a temporary password and has not replaced it yet. Without this, anyone holding a
  // signed-in session could set a new password without knowing the current one.
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('is_active, must_change_password').eq('id', user.id).maybeSingle()
  if (!profile?.is_active || !profile.must_change_password) redirect('/')

  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')
  const problem = validateNewPassword(password)
  if (problem) return { error: problem }
  if (password !== confirm) return { error: 'The two passwords do not match.' }

  // Refuse the temporary password they just signed in with: it has to be one only they know.
  const probe = await supabase.auth.signInWithPassword({ email: user.email ?? '', password })
  if (!probe.error) return { error: 'Pick a new password, not the temporary one you were given.' }

  const { error } = await admin.auth.admin.updateUserById(user.id, { password })
  if (error) return { error: error.message }
  await admin.from('profiles').update({ must_change_password: false }).eq('id', user.id)
  console.log(`[users] ${user.id} chose their own password`)   // id only, never the password
  redirect('/')
}
