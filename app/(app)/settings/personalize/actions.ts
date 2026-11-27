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
  const admin = createAdminClient()
  // The clock-out reminder is set on the Time Clock page, not here: a layout save or reset must not wipe it.
  const { data: now } = await admin.from('profiles').select('ui_prefs').eq('id', user.id).maybeSingle()
  const keep = parsePrefs(now?.ui_prefs).clock_reminder
  const prefs = { ...(formData.get('reset') ? {} : parsePrefs({ ...(raw as object), clock_reminder: undefined })), ...(keep ? { clock_reminder: keep } : {}) }

  await admin.from('profiles').update({ ui_prefs: prefs }).eq('id', user.id)
  revalidatePath('/', 'layout')
}
