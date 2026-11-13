'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { VALID_LANDING_PAGES, DEFAULT_LANDING_PAGE } from '@/lib/landing-pages'
import { MODULE_KEYS, type ModuleKey } from '@/lib/modules'
import { validateNewPassword } from '@/lib/password-rules'
import { canManageUser, canAssignRole } from '@/lib/user-admin-rules'

async function getProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  return data
}

/** Current role of someone in the caller's company, or null if they are not found. */
async function targetRoleOf(userId: string, companyId: string | null): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin.from('profiles').select('role').eq('id', userId).eq('company_id', companyId).maybeSingle()
  return data?.role ?? null
}

// ── Edit user profile ─────────────────────────────────────────────────────────

export async function editUser(
  userId: string,
  data: { full_name: string; email: string; phone?: string; job_title?: string }
): Promise<{ error?: string }> {
  const profile = await getProfile()
  if (!profile || !['owner', 'manager'].includes(profile.role)) {
    return { error: 'Access denied.' }
  }
  if (!canManageUser(profile.role, await targetRoleOf(userId, profile.company_id))) {
    return { error: "Only an owner can edit an owner's account." }
  }
  const admin = createAdminClient()
  if (data.email) {
    const { error: authError } = await admin.auth.admin.updateUserById(userId, {
      email: data.email.trim().toLowerCase(),
    })
    if (authError) return { error: authError.message }
  }
  const { error: profileError } = await admin.from('profiles').update({
    full_name: data.full_name.trim(),
    email:     data.email.trim().toLowerCase(),
    phone:     data.phone?.trim() || null,
    job_title: data.job_title?.trim() || null,
  }).eq('id', userId).eq('company_id', profile.company_id)
  if (profileError) return { error: profileError.message }
  revalidatePath('/settings/users')
  return {}
}

// ── Delete user — owner only ──────────────────────────────────────────────────

export async function deleteUser(userId: string): Promise<{ error?: string }> {
  const profile = await getProfile()
  if (!profile || profile.role !== 'owner') return { error: 'Only owners can delete users.' }
  if (userId === profile.id) return { error: 'You cannot delete your own account.' }

  const admin = createAdminClient()
  // Only people on this company's list can be removed from here.
  const { data: target } = await admin.from('profiles').select('id').eq('id', userId).eq('company_id', profile.company_id).maybeSingle()
  if (!target) return { error: 'User not found.' }

  // Delete from Supabase Auth — cascades to profiles table automatically
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) return { error: error.message }

  revalidatePath('/settings/users')
  return {}
}

// ── Set a user's password ─────────────────────────────────────────────────────
// For people who sign in with the email + password form instead of Google. The password goes straight to
// Supabase Auth and is never stored, returned or logged by the app.
// `temporary` (the default) makes the person choose their own password at their next sign-in (profiles.must_change_password).
export async function setUserPassword(userId: string, password: string, temporary = true): Promise<{ error?: string }> {
  const profile = await getProfile()
  if (!profile || !['owner', 'manager'].includes(profile.role)) return { error: 'Access denied.' }

  const problem = validateNewPassword(password)
  if (problem) return { error: problem }

  const admin = createAdminClient()
  // Same company scoping every other action here uses.
  const { data: target } = await admin.from('profiles').select('id, role')
    .eq('id', userId).eq('company_id', profile.company_id).maybeSingle()
  if (!target) return { error: 'User not found.' }
  // A manager must not be able to set an owner's password and then sign in as that owner.
  if (!canManageUser(profile.role, target.role)) return { error: "Only an owner can set an owner's password." }

  const { error } = await admin.auth.admin.updateUserById(userId, { password })
  if (error) return { error: error.message }
  revalidatePath('/settings/users')

  await admin.from('profiles').update({ must_change_password: !!temporary }).eq('id', userId).eq('company_id', profile.company_id)
  console.log(`[users] ${temporary ? 'temporary ' : ''}password set for ${userId} by ${profile.id}`)   // ids only, never the password
  return {}
}

export async function updateUserRole(userId: string, newRole: string) {
  const profile = await getProfile()
  if (!profile || !['owner', 'manager'].includes(profile.role)) return
  if (userId === profile.id) return  // can't change own role

  const validRoles = ['owner', 'manager', 'shop_manager', 'shop_employee', 'mechanic', 'service_tech', 'construction_tech', 'construction_manager', 'construction_admin', 'parts_manager', 'estimator', 'office_staff', 'viewer', 'field_surveyor']
  if (!validRoles.includes(newRole)) return
  if (!canAssignRole(profile.role, newRole)) return   // only an owner can hand out owner

  const admin = createAdminClient()
  // Field Survey Only logins land on the survey list; moving someone off that role clears that landing page.
  const { data: before } = await admin.from('profiles').select('role, default_landing_page').eq('id', userId).eq('company_id', profile.company_id).maybeSingle()
  if (!canManageUser(profile.role, before?.role)) return   // and a manager cannot change an existing owner's role
  const patch: Record<string, unknown> = { role: newRole }
  if (newRole === 'field_surveyor') patch.default_landing_page = '/construction/surveys'
  else if (before?.role === 'field_surveyor' && before.default_landing_page === '/construction/surveys') patch.default_landing_page = null
  await admin.from('profiles').update(patch)
    .eq('id', userId)
    .eq('company_id', profile.company_id)

  revalidatePath('/settings/users')
}

export async function updateDefaultLandingPage(userId: string, page: string) {
  const profile = await getProfile()
  if (!profile || !['owner', 'manager'].includes(profile.role)) return

  // Store NULL for the default choice rather than the literal path — keeps
  // "/dashboard" as the one true fallback if that route ever moves.
  const value = page === DEFAULT_LANDING_PAGE || !VALID_LANDING_PAGES.includes(page as any) ? null : page

  const admin = createAdminClient()
  await admin.from('profiles').update({ default_landing_page: value })
    .eq('id', userId)
    .eq('company_id', profile.company_id)

  revalidatePath('/settings/users')
}

export async function toggleUserActive(userId: string, isActive: boolean) {
  const profile = await getProfile()
  if (!profile || !['owner', 'manager'].includes(profile.role)) return
  if (userId === profile.id) return  // can't deactivate yourself
  if (!canManageUser(profile.role, await targetRoleOf(userId, profile.company_id))) return   // managers cannot deactivate an owner

  const admin = createAdminClient()
  await admin.from('profiles').update({ is_active: isActive })
    .eq('id', userId)
    .eq('company_id', profile.company_id)

  revalidatePath('/settings/users')
}

// ── Per-module access overrides ───────────────────────────────────────────────

/** Replaces this user's full set of blocked modules with `blockedKeys`. */
export async function setUserModuleBlocks(userId: string, blockedKeys: string[]) {
  const profile = await getProfile()
  if (!profile || !['owner', 'manager'].includes(profile.role)) return
  if (userId === profile.id) return  // can't block your own access — Settings would still be reachable, but no reason to allow it

  const admin = createAdminClient()

  // Confirm this user actually belongs to the caller's company before
  // touching their blocks — same scoping every other action here uses.
  const { data: target } = await admin.from('profiles').select('id, role').eq('id', userId).eq('company_id', profile.company_id).maybeSingle()
  if (!target || !canManageUser(profile.role, target.role)) return

  const valid = blockedKeys.filter((k): k is ModuleKey => (MODULE_KEYS as readonly string[]).includes(k))

  await admin.from('profile_module_blocks').delete().eq('profile_id', userId)
  if (valid.length) {
    await admin.from('profile_module_blocks').insert(valid.map(module => ({ profile_id: userId, module })))
  }

  revalidatePath('/settings/users')
}

type CreateEmployeeState = { error?: string; success?: boolean } | null

export async function createEmployee(
  _state: CreateEmployeeState,
  formData: FormData
): Promise<CreateEmployeeState> {
  const profile = await getProfile()
  if (!profile || !['owner', 'manager'].includes(profile.role)) {
    return { error: 'You do not have permission to add employees.' }
  }

  const fullName = (formData.get('full_name') as string)?.trim()
  const email    = (formData.get('email') as string)?.trim().toLowerCase()
  const role     = (formData.get('role') as string)?.trim()

  if (!fullName || !email) return { error: 'Name and email are required.' }

  const validRoles = ['owner', 'manager', 'shop_manager', 'shop_employee', 'mechanic', 'service_tech', 'construction_tech', 'construction_manager', 'construction_admin', 'parts_manager', 'estimator', 'office_staff', 'viewer', 'field_surveyor']
  if (!validRoles.includes(role)) return { error: 'Invalid role.' }
  if (!canAssignRole(profile.role, role)) return { error: 'Only an owner can add another owner.' }

  const admin = createAdminClient()

  // Check if a profile with this email already exists in the company
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .eq('company_id', profile.company_id)
    .eq('email', email)
    .maybeSingle()

  if (existing) return { error: 'An employee with that email already exists.' }

  // Create the auth user via admin API (email_confirm = true so they don't need to verify)
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (authError || !authData.user) {
    // If user already exists in auth (different company), surface a clear message
    if (authError?.message?.includes('already been registered')) {
      return { error: 'That email already has a login. Look for them in the list below (they may be inactive).' }
    }
    return { error: authError?.message ?? 'Failed to create user account.' }
  }

  // Create the profile row
  const { error: profileError } = await admin.from('profiles').insert({
    id: profile.company_id ? authData.user.id : authData.user.id,
    company_id: profile.company_id,
    full_name: fullName,
    email,
    role,
    is_active: true,
    ...(role === 'field_surveyor' ? { default_landing_page: '/construction/surveys' } : {}),
  })

  if (profileError) {
    // Rollback the auth user if profile creation fails
    await admin.auth.admin.deleteUser(authData.user.id)
    return { error: profileError.message }
  }

  revalidatePath('/settings/users')
  return { success: true }
}
