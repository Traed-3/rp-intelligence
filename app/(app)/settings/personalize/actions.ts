'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parsePrefs } from '@/lib/ui-prefs'

/** Saves the signed-in person's own layout choices. It can only ever touch their own row. */
export async function savePrefs(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  let raw: unknown = {}
  try { raw = JSON.parse(String(formData.get('prefs') ?? '{}')) } catch { raw = {} }
  const prefs = formData.get('reset') ? {} : parsePrefs(raw)

  const admin = createAdminClient()
  await admin.from('profiles').update({ ui_prefs: prefs }).eq('id', user.id)
  revalidatePath('/', 'layout')
}
