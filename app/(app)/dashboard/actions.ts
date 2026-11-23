'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { allowedDashboardCards, DASHBOARD_CARDS } from '@/lib/nav-items'
import { hasComplianceGrant } from '@/lib/compliance-guard'
import { loadUiPrefs } from '@/lib/ui-prefs'

const KNOWN = new Set<string>(DASHBOARD_CARDS.map(c => c.key))

/**
 * Saves the order a person dragged their Dashboard squares into (Trae, 11/23/26). Only ever touches their own row, and only
 * the order: hidden cards stay hidden and keep their place after the visible ones, and every other choice (menu, phone bar,
 * square style) is kept as it was.
 */
export async function saveDashboardOrder(order: string[]): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !Array.isArray(order)) return { ok: false }

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile) return { ok: false }
  const [{ data: blocks }, complianceGranted, prefs] = await Promise.all([
    admin.from('profile_module_blocks').select('module').eq('profile_id', user.id),
    hasComplianceGrant(admin, profile.company_id, user.id),
    loadUiPrefs(admin, user.id),
  ])
  // Only cards this person may have, each once, in the order they dropped them.
  const allowed = new Set<string>(allowedDashboardCards({ role: profile.role, userId: user.id, blockedModules: (blocks ?? []).map(b => b.module), complianceGranted }).map(c => c.key))
  const moved = [...new Set(order.filter(k => typeof k === 'string' && KNOWN.has(k) && allowed.has(k)))]
  if (!moved.length) return { ok: false }
  const rest = (prefs.dashboard?.order ?? []).filter(k => !moved.includes(k))

  const next = { ...prefs, dashboard: { order: [...moved, ...rest], hidden: prefs.dashboard?.hidden ?? [] } }
  const { error } = await admin.from('profiles').update({ ui_prefs: next }).eq('id', user.id)
  if (error) return { ok: false }
  revalidatePath('/dashboard')
  revalidatePath('/settings/personalize')
  return { ok: true }
}
