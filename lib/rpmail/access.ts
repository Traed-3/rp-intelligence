import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isLockedRole } from '@/lib/role-access'
import { UserError } from './gmail'

// RPMail: who may see what. Everything here is per person, never per role.
//   * RPMail is on for someone only when they have an enabled row in rpmail_users.
//   * A mailbox is theirs to open only when they have a row in rpmail_access for it.
// Every API route goes through `me()` and `mailboxFor()`; nothing reads a mailbox by id alone.

export type Me = { id: string; company_id: string; role: string; name: string; email: string; enabled: boolean; mailAddress: string | null }

export type Mailbox = {
  id: string; company_id: string; address: string; name: string; kind: 'personal' | 'shared'; owner_id: string | null
  crew_reads: boolean; token_secret_id: string | null; scope: string | null; connected_at: string | null
  history_id: string | null; sync: SyncState; last_sync_at: string | null; last_error: string | null
}
export type SyncState = { todo?: string[]; total?: number; started?: string; full_done?: string }

export class Forbidden extends Error {}

/** Only an owner hands out shared mailboxes or turns RPMail on for someone else. */
export const isMailAdmin = (role: string | null | undefined) => role === 'owner'

export async function me(): Promise<Me | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: p } = await admin.from('profiles').select('id, company_id, role, full_name, email, is_active').eq('id', user.id).maybeSingle()
  if (!p || p.is_active === false) return null
  const { data: u } = await admin.from('rpmail_users').select('enabled, mail_address').eq('profile_id', user.id).maybeSingle()
  return { id: p.id, company_id: p.company_id, role: p.role ?? '', name: p.full_name ?? '', email: (p.email ?? user.email ?? '').toLowerCase(),
    enabled: !!u?.enabled, mailAddress: u?.mail_address ?? null }
}

/** The signed-in person, with RPMail turned on. Throws otherwise. */
export async function requireMe(): Promise<Me> {
  const m = await me()
  if (!m) throw new Forbidden('Sign in first.')
  if (!m.enabled) throw new Forbidden('RPMail is not turned on for your login.')
  return m
}

const BOX_COLS = 'id, company_id, address, name, kind, owner_id, crew_reads, token_secret_id, scope, connected_at, history_id, sync, last_sync_at, last_error'

/** The mailboxes this person may open: their own first, then shared ones by name. */
export async function myMailboxes(who: Pick<Me, 'id' | 'company_id' | 'role'>): Promise<Mailbox[]> {
  const admin = createAdminClient()
  const { data: acc } = await admin.from('rpmail_access').select('mailbox_id').eq('profile_id', who.id)
  const ids = (acc ?? []).map(a => a.mailbox_id as string)
  if (!ids.length) return []
  const { data } = await admin.from('rpmail_mailboxes').select(BOX_COLS).in('id', ids).eq('company_id', who.company_id)
  return ((data ?? []) as Mailbox[]).filter(b => roleStillAllows(who.role, b)).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'personal' ? -1 : 1))
}

/** One mailbox, only if this person has been given it. This is the check every mail request passes through. */
export async function mailboxFor(who: Pick<Me, 'id' | 'company_id' | 'role'>, mailboxId: unknown): Promise<Mailbox> {
  if (typeof mailboxId !== 'string' || !/^[0-9a-f-]{36}$/.test(mailboxId)) throw new Forbidden('No such mailbox.')
  const admin = createAdminClient()
  const { data: a } = await admin.from('rpmail_access').select('mailbox_id').eq('profile_id', who.id).eq('mailbox_id', mailboxId).maybeSingle()
  if (!a) throw new Forbidden('That mailbox is not on your login.')
  const { data } = await admin.from('rpmail_mailboxes').select(BOX_COLS).eq('id', mailboxId).eq('company_id', who.company_id).maybeSingle()
  if (!data || !roleStillAllows(who.role, data as Mailbox)) throw new Forbidden('No such mailbox.')
  return data as Mailbox
}

/** Checked on every read as well as when access is given: someone moved to a tech or shop role loses the pricing mailboxes at once. */
const roleStillAllows = (role: string | null | undefined, box: Pick<Mailbox, 'kind' | 'crew_reads'>) =>
  box.kind === 'personal' || box.crew_reads || !isLockedRole(role)

/** The Gmail address a person's own mailbox must be: the one an owner set for them, else their login email. */
export function personalAddress(who: Pick<Me, 'email' | 'mailAddress'>): string | null {
  const a = (who.mailAddress || who.email || '').trim().toLowerCase()
  return /^[^@\s]+@(gmail|googlemail)\.com$/.test(a) ? a : null
}

/** Make (or find) the row for a person's own mailbox and give them access to it. Not connected to Google yet. */
export async function ensurePersonalMailbox(who: Me): Promise<Mailbox | null> {
  const address = personalAddress(who)
  if (!address) return null
  const admin = createAdminClient()
  const { data: existing } = await admin.from('rpmail_mailboxes').select(BOX_COLS).eq('address', address).maybeSingle()
  let box = existing as Mailbox | null
  if (box && !(box.kind === 'personal' && box.owner_id === who.id)) {
    // The address is already a shared mailbox or someone else's: never hand it over from here.
    throw new UserError(`${address} is already set up as another mailbox. Ask Trae to sort it out in Settings.`)
  }
  if (!box) {
    // A person has one mailbox of their own. If their address changed, the old one (and its sign-in) goes.
    await admin.from('rpmail_mailboxes').delete().eq('owner_id', who.id).eq('kind', 'personal')
    const { data: made, error } = await admin.from('rpmail_mailboxes')
      .insert({ company_id: who.company_id, address, name: 'My email', kind: 'personal', owner_id: who.id }).select(BOX_COLS).single()
    if (error) throw new Error('Could not set up your mailbox.')
    box = made as Mailbox
  }
  await admin.from('rpmail_access').upsert({ mailbox_id: box.id, profile_id: who.id, granted_by: who.id }, { onConflict: 'mailbox_id,profile_id', ignoreDuplicates: true })
  return box
}

/**
 * May this person be given this shared mailbox? Techs, mechanics and shop logins only get mailboxes the crew already
 * reads (no customer pricing goes through those). Everyone else can be given any shared mailbox.
 */
export function mayGrant(role: string | null | undefined, box: Pick<Mailbox, 'kind' | 'crew_reads'>): boolean {
  if (box.kind !== 'shared') return false
  return box.crew_reads || !isLockedRole(role)
}

/** Addresses that customer pricing may never be sent to or from (mailboxes the crew reads). */
export async function noPricingAddresses(companyId: string): Promise<Set<string>> {
  const { data } = await createAdminClient().from('rpmail_mailboxes').select('address').eq('company_id', companyId).eq('crew_reads', true)
  return new Set(['econstruction.rp@gmail.com', ...(data ?? []).map(d => (d.address as string).toLowerCase())])
}
