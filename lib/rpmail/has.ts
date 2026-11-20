import type { SupabaseClient } from '@supabase/supabase-js'

/** Does this person get the RPMail menu entry? Only if they turned RPMail on, or have their own linked one. */
export async function hasRpmail(admin: SupabaseClient, profileId: string): Promise<boolean> {
  const [{ data: link }, { data: on }] = await Promise.all([
    admin.from('rpmail_links').select('profile_id').eq('profile_id', profileId).maybeSingle(),
    admin.from('rpmail_users').select('enabled').eq('profile_id', profileId).maybeSingle(),
  ])
  return !!link || !!on?.enabled
}
