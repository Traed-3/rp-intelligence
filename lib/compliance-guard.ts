import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canReadCompliance, canWriteCompliance } from '@/lib/compliance'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Is this person on the DQF "Who else can use DQF & Certs" list? */
export async function hasComplianceGrant(admin: SupabaseClient, companyId: string | null | undefined, profileId: string): Promise<boolean> {
  if (!companyId) return false
  const { data } = await admin.from('hr_compliance_settings').select('access_profile_ids').eq('company_id', companyId).maybeSingle()
  return ((data?.access_profile_ids ?? []) as string[]).includes(profileId)
}

export type ComplianceProfile = { id: string; company_id: string; role: string; canWrite: boolean }

/** Server-side guard for /compliance pages: redirects away anyone without the role or with the module blocked. */
export async function requireCompliance(): Promise<ComplianceProfile> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  const granted = await hasComplianceGrant(admin, profile?.company_id, user.id)
  if (!profile || !canReadCompliance(profile, granted)) redirect('/dashboard')
  const { data: block } = await admin.from('profile_module_blocks').select('module').eq('profile_id', user.id).eq('module', 'compliance').maybeSingle()
  if (block) redirect('/dashboard')

  return { ...(profile as { id: string; company_id: string; role: string }), canWrite: canWriteCompliance(profile, granted) }
}

/** Same check for server actions / route handlers — returns null instead of redirecting. */
export async function complianceCaller(write = false): Promise<ComplianceProfile | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  const granted = await hasComplianceGrant(admin, profile?.company_id, user.id)
  if (!profile || !canReadCompliance(profile, granted)) return null
  if (write && !canWriteCompliance(profile, granted)) return null
  const { data: block } = await admin.from('profile_module_blocks').select('module').eq('profile_id', user.id).eq('module', 'compliance').maybeSingle()
  if (block) return null
  return { ...(profile as { id: string; company_id: string; role: string }), canWrite: canWriteCompliance(profile, granted) }
}
