import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canReadConstruction, canWriteConstruction } from '@/lib/construction'

export type BillingProfile = { id: string; company_id: string; role: string; canWrite: boolean }

/**
 * Who can see and write quotes/invoices. Billing is shared by Construction and
 * Service, so: the Construction allowlist (Trae's logins) plus the office roles
 * that bill service work. Techs never see money documents.
 */
import { BILLING_READ_ROLES, BILLING_WRITE_ROLES } from '@/lib/billing'
export { BILLING_READ_ROLES, BILLING_WRITE_ROLES }

type P = { id?: string | null; role?: string | null } | null | undefined
export function canReadBilling(p: P)  { return canReadConstruction(p) || (!!p?.role && (BILLING_READ_ROLES as readonly string[]).includes(p.role)) }
export function canWriteBilling(p: P) { return canWriteConstruction(p) || (!!p?.role && (BILLING_WRITE_ROLES as readonly string[]).includes(p.role)) }

export async function requireBilling(): Promise<BillingProfile> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile || !canReadBilling(profile)) redirect('/dashboard')
  return { id: profile.id, company_id: profile.company_id, role: profile.role, canWrite: canWriteBilling(profile) }
}

/** Non-redirecting variant for server actions. */
export async function getBillingProfile(): Promise<BillingProfile | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await createAdminClient().from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile || !canReadBilling(profile)) return null
  return { id: profile.id, company_id: profile.company_id, role: profile.role, canWrite: canWriteBilling(profile) }
}
