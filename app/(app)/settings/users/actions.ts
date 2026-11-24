'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { VALID_LANDING_PAGES, DEFAULT_LANDING_PAGE } from '@/lib/landing-pages'
import { MODULE_KEYS, type ModuleKey } from '@/lib/modules'
import { validateNewPassword, generatePassword } from '@/lib/password-rules'
import {
  buildInviteEmail, validateInviteContent, DEFAULT_INVITE_SUBJECT, DEFAULT_INVITE_INTRO, DEFAULT_WHATS_NEW, type InviteContent,
} from '@/lib/invite-email'
import { sendInviteEmail } from '@/lib/email'
import { canManageUser, canAssignRole } from '@/lib/user-admin-rules'
import { dropPricingMailboxes } from '@/lib/rpmail/access'

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

// ── Invite email ──────────────────────────────────────────────────────────────
// One click on a person's row emails them a "come sign in" note: the company's invite wording (Invite message, saved on
// companies.invite_email; the standard text when never saved), the sign-in link and, for anyone who has not signed in
// yet, a fresh temporary password. The password goes to Supabase Auth and into that one email; the app never stores,
// returns or logs it. Each send is recorded in activity_log (ids and flags only) so the Users page shows "invite sent".

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://rpintelligence.app'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type InviteResult = { ok?: true; error?: string; passwordChanged?: boolean }

function cleanContent(input: Partial<InviteContent> | null | undefined): InviteContent {
  return {
    subject: typeof input?.subject === 'string' ? input.subject : DEFAULT_INVITE_SUBJECT,
    intro: typeof input?.intro === 'string' ? input.intro : DEFAULT_INVITE_INTRO,
    whatsNew: typeof input?.whatsNew === 'string' ? input.whatsNew : DEFAULT_WHATS_NEW,
  }
}

/** The wording every invite uses: what was saved under Invite message, or the standard text. */
async function companyInviteContent(companyId: string | null): Promise<InviteContent> {
  if (!companyId) return cleanContent(null)
  const admin = createAdminClient()
  const { data } = await admin.from('companies').select('invite_email').eq('id', companyId).maybeSingle()
  return cleanContent((data?.invite_email ?? null) as Partial<InviteContent> | null)
}

async function senderOf(profileId: string) {
  const admin = createAdminClient()
  const { data } = await admin.from('profiles').select('full_name, job_title, email').eq('id', profileId).maybeSingle()
  return { name: data?.full_name ?? '', title: data?.job_title ?? null, email: data?.email ?? null }
}

/**
 * Settings > Users > Invite message: saves the wording for every invite after this. `null` goes back to the standard text.
 * Owners only: owners' invites (to other owners too) carry real passwords under the owner's name, so a manager must not be
 * able to put words in them.
 */
export async function saveInviteMessage(input: InviteContent | null): Promise<{ ok?: true; error?: string }> {
  const profile = await getProfile()
  if (!profile || profile.role !== 'owner') return { error: 'Only an owner can change the invite message.' }
  let value: InviteContent | null = null
  if (input) {
    value = cleanContent(input)
    const problem = validateInviteContent(value)
    if (problem) return { error: problem }
  }
  const admin = createAdminClient()
  const { error } = await admin.from('companies').update({ invite_email: value }).eq('id', profile.company_id)
  if (error) return { error: error.message }
  revalidatePath('/settings/users')
  return { ok: true }
}

/**
 * Sends one person their invite. With no options it does the usual thing: a new temporary password for someone who has
 * never signed in, and no password change for someone who has. `newPassword: true` gives everyone a new one.
 */
export async function sendUserInvite(userId: string, opts: { newPassword?: boolean } = {}): Promise<InviteResult> {
  const profile = await getProfile()
  if (!profile || !['owner', 'manager'].includes(profile.role)) return { error: 'Access denied.' }
  if (userId === profile.id) return { error: 'Use "Send me a test" under Invite message to see the email yourself.' }
  // Check email is set up BEFORE touching anyone's password.
  if (!process.env.RESEND_API_KEY) return { error: 'Email is not set up on this server (RESEND_API_KEY is missing). Nothing was changed.' }

  const content = await companyInviteContent(profile.company_id)
  const contentProblem = validateInviteContent(content)
  if (contentProblem) return { error: `Fix the invite message first: ${contentProblem}` }

  const admin = createAdminClient()
  const { data: target } = await admin.from('profiles').select('id, role, email, full_name, is_active')
    .eq('id', userId).eq('company_id', profile.company_id).maybeSingle()
  if (!target) return { error: 'User not found.' }
  if (!canManageUser(profile.role, target.role)) return { error: 'Only an owner can invite an owner.' }
  if (!target.is_active) return { error: `${target.full_name} is disabled. Press Activate first.` }
  const to = String(target.email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(to)) return { error: `${target.full_name} has no usable email address. Fix it with Edit first.` }

  const { data: authUser } = await admin.auth.admin.getUserById(userId)
  const hasSignedIn = !!authUser?.user?.last_sign_in_at
  let password: string | null = null
  if (opts.newPassword ?? !hasSignedIn) {
    password = generatePassword()
    const { error } = await admin.auth.admin.updateUserById(userId, { password })
    if (error) return { error: error.message }
    await admin.from('profiles').update({ must_change_password: true }).eq('id', userId).eq('company_id', profile.company_id)
  }

  const sender = await senderOf(profile.id)
  const mail = buildInviteEmail({
    content,
    recipient: { fullName: target.full_name ?? '', email: to, password },
    sender,
    loginUrl: `${APP_URL}/login`,
    logoUrl: `${APP_URL}/logo-full-v4.png`,
  })
  const sent = await sendInviteEmail({ to, subject: mail.subject, html: mail.html, text: mail.text, replyTo: sender.email })
  if (!sent.ok) {
    console.log(`[users] invite email to ${userId} failed (password ${password ? 'changed' : 'unchanged'}): ${sent.error}`)
    return {
      error: `The email did not go: ${sent.error}${password ? ' Their password was changed, so press Send invite again (it makes a new one) or use Password.' : ''}`,
      passwordChanged: !!password,
    }
  }

  await admin.from('activity_log').insert({
    company_id: profile.company_id,
    actor_id: profile.id,
    action: 'user_invite_sent',
    entity_type: 'profile',
    entity_id: userId,
    details: { to, new_password: !!password, email_id: sent.id },   // never the password
  })
  console.log(`[users] invite sent to ${userId} by ${profile.id}${password ? ' with a temporary password' : ''}`)
  return { ok: true, passwordChanged: !!password }
}

/**
 * Sends the invite to the person pressing the button, with a sample password, so they can see it before it goes out.
 * Uses the wording passed in (what is on screen, saved or not), else the saved wording. Changes nothing.
 */
export async function sendInviteTest(input?: InviteContent): Promise<{ ok?: true; to?: string; error?: string }> {
  const profile = await getProfile()
  if (!profile || !['owner', 'manager'].includes(profile.role)) return { error: 'Access denied.' }
  const content = input ? cleanContent(input) : await companyInviteContent(profile.company_id)
  const contentProblem = validateInviteContent(content)
  if (contentProblem) return { error: contentProblem }

  const sender = await senderOf(profile.id)
  const to = String(sender.email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(to)) return { error: 'Your own profile has no email address to send the test to.' }
  const mail = buildInviteEmail({
    content,
    recipient: { fullName: sender.name, email: to, password: 'Sample-Pass7' },
    sender,
    loginUrl: `${APP_URL}/login`,
    logoUrl: `${APP_URL}/logo-full-v4.png`,
  })
  const sent = await sendInviteEmail({ to, subject: `[Test] ${mail.subject}`, html: mail.html, text: mail.text, replyTo: sender.email })
  if (!sent.ok) return { error: `The test did not go: ${sent.error}` }
  return { ok: true, to }
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
  if (!before) return   // not a person in this company
  if (!canManageUser(profile.role, before.role)) return   // and a manager cannot change an existing owner's role
  const patch: Record<string, unknown> = { role: newRole }
  if (newRole === 'field_surveyor') patch.default_landing_page = '/construction/surveys'
  else if (before?.role === 'field_surveyor' && before.default_landing_page === '/construction/surveys') patch.default_landing_page = null
  const { error: roleError } = await admin.from('profiles').update(patch)
    .eq('id', userId)
    .eq('company_id', profile.company_id)
  // RPMail: a tech or shop login keeps only mailboxes the crew reads (no customer pricing).
  if (!roleError) await dropPricingMailboxes(userId, newRole, profile.company_id)

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
