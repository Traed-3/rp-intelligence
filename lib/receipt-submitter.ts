/**
 * Who submitted an emailed receipt.
 *
 * A receipt that came in by email belongs to the person who sent the email
 * (a tech mailing const.receipt.rp), not to the office user who keyed it in.
 * Match the From address to an employee; when nobody matches, keep the
 * sender's own name and email instead of falling back to the logged-in user.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type Submitter = {
  /** profiles.id when the sender has an app login, else null */
  profileId: string | null
  name: string | null
  email: string | null
}

/** "Jesse Franks <jessefranks.rp@gmail.com>" → { name, email } */
export function parseFromHeader(from: string | null | undefined): { name: string | null; email: string | null } {
  const raw = (from ?? '').trim()
  if (!raw) return { name: null, email: null }
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() }
  return raw.includes('@') ? { name: null, email: raw.toLowerCase() } : { name: raw, email: null }
}

const SAFE_EMAIL = /^[^\s"'(),%*\\<>]+@[^\s"'(),%*\\<>]+\.[a-z]{2,}$/

export async function resolveSubmitter(
  admin: SupabaseClient,
  companyId: string,
  senderEmail: string | null | undefined,
  senderName?: string | null,
): Promise<Submitter> {
  const fallbackName = senderName?.trim() || null
  const raw = senderEmail?.trim().toLowerCase() || null
  // The address comes from an email header (untrusted). Only look up plain
  // addresses, and escape ilike wildcards so it can only match literally.
  if (!raw || !SAFE_EMAIL.test(raw)) return { profileId: null, name: fallbackName ?? raw, email: raw }
  const email = raw
  const pat = email.replace(/[\\%_]/g, (c) => `\\${c}`)

  // 1. App login with that email
  const { data: prof } = await admin.from('profiles')
    .select('id, full_name').eq('company_id', companyId).ilike('email', pat).limit(1).maybeSingle()
  if (prof) return { profileId: prof.id, name: prof.full_name ?? fallbackName, email }

  // 2. HR record (work or personal email), linked to a profile when it has one
  let { data: hr } = await admin.from('hr_employees')
    .select('full_name, profile_id').eq('company_id', companyId).ilike('email', pat).limit(1).maybeSingle()
  if (!hr) ({ data: hr } = await admin.from('hr_employees')
    .select('full_name, profile_id').eq('company_id', companyId).ilike('personal_email', pat).limit(1).maybeSingle())
  if (hr) return { profileId: hr.profile_id ?? null, name: hr.full_name ?? fallbackName, email }

  // 3. Construction contact
  const { data: cc } = await admin.from('con_contacts')
    .select('name').eq('company_id', companyId).ilike('email', pat).limit(1).maybeSingle()
  if (cc) return { profileId: null, name: cc.name ?? fallbackName, email }

  // 4. No match: keep what the email said
  return { profileId: null, name: fallbackName ?? email, email }
}

/** Name to show for an expense/tool row: the email sender when recorded, else the profile. */
export function submitterLabel(row: { submitter_name?: string | null; submitter_email?: string | null; profiles?: { full_name?: string | null } | null }): string | null {
  return row.submitter_name || row.profiles?.full_name || row.submitter_email || null
}
