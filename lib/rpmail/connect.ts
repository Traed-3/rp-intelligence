import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { AUTH_URL, G_SCOPE, exchangeCode, forgetAccess, gmail, googleClient, rememberAccess, UserError } from './gmail'
import { ensurePersonalMailbox, isMailAdmin, mailboxFor, mayGrant, Forbidden, type Me, type Mailbox } from './access'
import { logActivity } from './activity'
import { contentRules } from './company'
import { isLockedRole } from '@/lib/role-access'

// RPMail: turning it on, "Sign in with Google" for a mailbox, and the owner's settings (shared mailboxes, who gets what).

const UUID = /^[0-9a-f-]{36}$/
const GMAIL_ADDR = /^[^@\s<>,;]+@(gmail|googlemail)\.com$/

/** A person turns RPMail on or off for their own login. Off also signs their own mailbox out of Google here. */
export async function setEnabled(who: Me, on: boolean) {
  const admin = createAdminClient()
  await admin.from('rpmail_users').upsert({ profile_id: who.id, enabled: on, enabled_by: who.id, enabled_at: new Date().toISOString() }, { onConflict: 'profile_id' })
  if (on) await ensurePersonalMailbox({ ...who, enabled: true })
  else {
    const { data: own } = await admin.from('rpmail_mailboxes').select('id').eq('owner_id', who.id).eq('kind', 'personal')
    for (const b of own ?? []) await signOutMailbox(b.id as string)
  }
  await logActivity(who, on ? 'rpmail_on' : 'rpmail_off', { detail: 'for themselves' })
  return { ok: true, enabled: on }
}

async function signOutMailbox(mailboxId: string) {
  const admin = createAdminClient()
  const { data: token } = await admin.rpc('rpmail_token_get', { p_mailbox: mailboxId })
  if (token) {
    // Tell Google the sign-in is finished with. If Google cannot be reached the local copy is still removed.
    await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: token as string }) }).catch(() => null)
  }
  await admin.rpc('rpmail_token_clear', { p_mailbox: mailboxId })
  forgetAccess(mailboxId)
}

async function mailboxToConnect(who: Me, mailboxId: unknown): Promise<Mailbox> {
  if (typeof mailboxId !== 'string' || !UUID.test(mailboxId)) throw new Forbidden('No such mailbox.')
  if (isMailAdmin(who.role)) {
    const { data } = await createAdminClient().from('rpmail_mailboxes').select('*').eq('id', mailboxId).eq('company_id', who.company_id).eq('kind', 'shared').maybeSingle()
    if (data) return data as Mailbox
  }
  if (!who.enabled) throw new Forbidden('RPMail is not turned on for your login.')
  return mailboxFor(who, mailboxId)
}

/** Disconnect: a person for their own mailbox, an owner for a shared one. Removes the sign-in and the index. */
export async function disconnect(who: Me, p: { mailbox?: unknown }) {
  const box = await mailboxToConnect(who, p.mailbox)
  if (box.kind === 'shared' && !isMailAdmin(who.role)) throw new Forbidden('Only an owner can disconnect a shared mailbox.')
  if (box.kind === 'personal' && box.owner_id !== who.id) throw new Forbidden('That is not your mailbox.')
  await signOutMailbox(box.id)
  await logActivity(who, 'sign_out', { box })
  return { ok: true }
}

export function redirectUri(requestOrigin: string): string {
  const origin = process.env.NODE_ENV === 'production' ? (process.env.RPMAIL_APP_ORIGIN || 'https://rpintelligence.app') : requestOrigin
  return origin.replace(/\/$/, '') + '/api/rpmail/oauth/callback'
}

/** Where to send the browser to sign in with Google for one mailbox. */
export async function oauthStart(who: Me, mailboxId: unknown, requestOrigin: string): Promise<string> {
  const c = googleClient()
  if (!c) throw new UserError('Sign in with Google is not set up yet. Trae has one Google step left to do.')
  const box = await mailboxToConnect(who, mailboxId)
  const admin = createAdminClient()
  const state = randomBytes(24).toString('base64url')
  await admin.from('rpmail_oauth_states').delete().lt('created_at', new Date(Date.now() - 15 * 60_000).toISOString())
  const { error } = await admin.from('rpmail_oauth_states').insert({ state, profile_id: who.id, mailbox_id: box.id })
  if (error) throw new Error('Could not start the sign-in.')
  return AUTH_URL + '?' + new URLSearchParams({ client_id: c.id, redirect_uri: redirectUri(requestOrigin), response_type: 'code', scope: G_SCOPE,
    access_type: 'offline', prompt: 'consent', login_hint: box.address, state })
}

/** Google sends the person back here. Returns the page to show next. */
export async function oauthFinish(who: Me, q: URLSearchParams, requestOrigin: string): Promise<string> {
  const admin = createAdminClient()
  const state = q.get('state') ?? ''
  const { data: st } = await admin.from('rpmail_oauth_states').select('state, profile_id, mailbox_id, created_at').eq('state', state).maybeSingle()
  if (st) await admin.from('rpmail_oauth_states').delete().eq('state', state)
  if (!st || st.profile_id !== who.id || Date.now() - Date.parse(st.created_at as string) > 15 * 60_000) {
    throw new UserError('That sign-in link is old. Start again from the mailbox.')
  }
  const box = await mailboxToConnect(who, st.mailbox_id)
  const back = box.kind === 'shared' && isMailAdmin(who.role) ? '/settings/rpmail' : '/rpmail'
  try {
    if (q.get('error') || !q.get('code')) throw new UserError(`Google sign-in was cancelled (${(q.get('error') || 'no code').slice(0, 60)}).`)
    const d = await exchangeCode(q.get('code')!, redirectUri(requestOrigin))
    if (!String(d.scope ?? '').split(' ').includes(G_SCOPE)) throw new UserError('Google did not grant permission for the mail. Start again and leave the box ticked.')
    const access = String(d.access_token ?? '')
    const prof = await gmail<{ emailAddress?: string; historyId?: string }>(box.id, 'profile', { token: access })
    const signedInAs = (prof?.emailAddress ?? '').toLowerCase()
    if (signedInAs !== box.address) throw new UserError(`You signed in as ${signedInAs || 'another account'}, but this mailbox is ${box.address}. Start again and pick that account.`)
    if (!d.refresh_token) throw new UserError('Google did not return a lasting sign-in. Start again.')
    const { error } = await admin.rpc('rpmail_token_set', { p_mailbox: box.id, p_token: String(d.refresh_token) })
    if (error) throw new Error('The sign-in could not be saved.')
    await admin.from('rpmail_messages').delete().eq('mailbox_id', box.id)
    await admin.from('rpmail_mailboxes').update({ scope: 'modify', connected_by: who.id, connected_at: new Date().toISOString(), history_id: null, sync: {}, last_error: null }).eq('id', box.id)
    rememberAccess(box.id, access, Number(d.expires_in ?? 3000))
    await logActivity(who, 'sign_in', { box })
    return `${back}?connected=${box.id}`
  } catch (e) {
    const msg = e instanceof UserError ? e.message : 'The sign-in did not finish. Try again.'
    return `${back}?connect_error=${encodeURIComponent(msg)}`
  }
}

// ── Owner settings ────────────────────────────────────────────────────────────────────────────────────────────
function requireAdmin(who: Me) { if (!isMailAdmin(who.role)) throw new Forbidden('Only an owner can change RPMail settings.') }

export async function adminState(who: Me) {
  requireAdmin(who)
  const admin = createAdminClient()
  const content = await contentRules(who.company_id)
  const [{ data: people }, { data: users }, { data: boxes }, { data: access }, { data: links }] = await Promise.all([
    admin.from('profiles').select('id, full_name, email, role, is_active').eq('company_id', who.company_id).order('full_name'),
    admin.from('rpmail_users').select('profile_id, enabled, mail_address'),
    admin.from('rpmail_mailboxes').select('id, address, name, kind, owner_id, crew_reads, token_secret_id, connected_at, last_sync_at, last_error').eq('company_id', who.company_id).order('name'),
    admin.from('rpmail_access').select('mailbox_id, profile_id, can_send, can_delete'),
    admin.from('rpmail_links').select('profile_id'),
  ])
  const u = new Map((users ?? []).map(x => [x.profile_id as string, x]))
  const own = new Map((boxes ?? []).filter(b => b.kind === 'personal').map(b => [b.owner_id as string, b]))
  const local = new Set((links ?? []).map(l => l.profile_id as string))
  const shared = (boxes ?? []).filter(b => b.kind === 'shared')
  const sharedIds = new Set(shared.map(b => b.id as string))
  return {
    googleReady: !!googleClient(), content,
    shared: shared.map(b => ({ id: b.id, address: b.address, name: b.name, crew_reads: b.crew_reads, connected: !!b.token_secret_id, connected_at: b.connected_at, last_error: b.last_error })),
    people: (people ?? []).filter(p => p.is_active !== false).map(p => ({
      id: p.id, name: p.full_name ?? '', email: p.email ?? '', role: p.role ?? '', locked: isLockedRole(p.role), hasLocal: local.has(p.id),
      enabled: !!u.get(p.id)?.enabled, mail_address: u.get(p.id)?.mail_address ?? null,
      own: own.get(p.id) ? { address: own.get(p.id)!.address, connected: !!own.get(p.id)!.token_secret_id } : null,
      shared: (access ?? []).filter(a => a.profile_id === p.id && sharedIds.has(a.mailbox_id as string)).map(a => a.mailbox_id as string),
      // What they may do in each one: read only, read and send, or everything. An owner always has everything.
      levels: Object.fromEntries((access ?? []).filter(a => a.profile_id === p.id && sharedIds.has(a.mailbox_id as string))
        .map(a => [a.mailbox_id as string, isMailAdmin(p.role) ? 'full' : levelOf(a)])),
    })),
  }
}

export type AccessLevel = 'read' | 'send' | 'full'
const levelOf = (a: { can_send?: unknown; can_delete?: unknown }): AccessLevel => a.can_send === false ? 'read' : a.can_delete === false ? 'send' : 'full'
const LEVEL_TEXT: Record<AccessLevel, string> = { read: 'read only', send: 'read and send', full: 'read, send and delete' }

async function personInCompany(who: Me, profileId: unknown) {
  if (typeof profileId !== 'string' || !UUID.test(profileId)) throw new UserError('No such person.')
  const { data } = await createAdminClient().from('profiles').select('id, role, full_name').eq('id', profileId).eq('company_id', who.company_id).maybeSingle()
  if (!data) throw new UserError('No such person.')
  return data as { id: string; role: string | null; full_name: string | null }
}

/** Owner turns RPMail on or off for someone, or sets the Gmail address their own mailbox uses. */
export async function adminSetUser(who: Me, p: { profile?: unknown; enabled?: unknown; mail_address?: unknown }) {
  requireAdmin(who)
  const person = await personInCompany(who, p.profile)
  const admin = createAdminClient()
  const patch: Record<string, unknown> = { profile_id: person.id }
  if (typeof p.enabled === 'boolean') { patch.enabled = p.enabled; patch.enabled_by = who.id; patch.enabled_at = new Date().toISOString() }
  if (p.mail_address !== undefined) {
    const a = String(p.mail_address ?? '').trim().toLowerCase()
    if (a && !GMAIL_ADDR.test(a)) throw new UserError('That has to be a Gmail address (it is the mailbox they sign in to with Google).')
    patch.mail_address = a || null
  }
  const { data: existing } = await admin.from('rpmail_users').select('profile_id').eq('profile_id', person.id).maybeSingle()
  if (existing) await admin.from('rpmail_users').update(patch).eq('profile_id', person.id)
  else await admin.from('rpmail_users').insert({ enabled: false, ...patch })
  if (typeof p.enabled === 'boolean') await logActivity(who, p.enabled ? 'rpmail_on' : 'rpmail_off', { target: person.id })
  return { ok: true }
}

/** Owner adds or edits a shared mailbox. Turning "the crew reads this" off takes it away from tech and shop logins. */
export async function adminSaveShared(who: Me, p: { id?: unknown; address?: unknown; name?: unknown; crew_reads?: unknown }) {
  requireAdmin(who)
  const admin = createAdminClient()
  const name = String(p.name ?? '').trim().slice(0, 60)
  const crew = p.crew_reads === true
  if (!name) throw new UserError('Give the mailbox a name, for example Construction Dept.')
  if (typeof p.id === 'string' && UUID.test(p.id)) {
    const { data: box } = await admin.from('rpmail_mailboxes').select('id').eq('id', p.id).eq('company_id', who.company_id).eq('kind', 'shared').maybeSingle()
    if (!box) throw new UserError('No such shared mailbox.')
    await admin.from('rpmail_mailboxes').update({ name, crew_reads: crew }).eq('id', box.id)
    let removed = 0
    if (!crew) {
      const { data: acc } = await admin.from('rpmail_access').select('profile_id').eq('mailbox_id', box.id)
      const { data: roles } = await admin.from('profiles').select('id, role').in('id', (acc ?? []).map(a => a.profile_id as string))
      const out = (roles ?? []).filter(r => isLockedRole(r.role)).map(r => r.id as string)
      if (out.length) { await admin.from('rpmail_access').delete().eq('mailbox_id', box.id).in('profile_id', out); removed = out.length }
    }
    return { ok: true, removed }
  }
  const address = String(p.address ?? '').trim().toLowerCase()
  if (!GMAIL_ADDR.test(address)) throw new UserError('Type the full Gmail address of the shared mailbox.')
  const { data: clash } = await admin.from('rpmail_mailboxes').select('id, kind').eq('address', address).maybeSingle()
  if (clash) throw new UserError(clash.kind === 'shared' ? 'That mailbox is already on the list.' : 'That address is already connected as someone\'s own mailbox.')
  const { error } = await admin.from('rpmail_mailboxes').insert({ company_id: who.company_id, address, name, kind: 'shared', crew_reads: crew })
  if (error) throw new Error('Could not add the mailbox.')
  await logActivity(who, 'mailbox_add', { detail: `${name} (${address})${crew ? ', the crew reads it' : ''}` })
  return { ok: true, removed: 0 }
}

/** Owner removes a shared mailbox from RPMail: its sign-in, its index and everyone's access. Gmail itself is untouched. */
export async function adminDeleteShared(who: Me, p: { id?: unknown }) {
  requireAdmin(who)
  const admin = createAdminClient()
  const { data: box } = await admin.from('rpmail_mailboxes').select('id, address').eq('id', String(p.id ?? '')).eq('company_id', who.company_id).eq('kind', 'shared').maybeSingle()
  if (!box) throw new UserError('No such shared mailbox.')
  await signOutMailbox(box.id as string)
  await admin.from('rpmail_mailboxes').delete().eq('id', box.id)
  await logActivity(who, 'mailbox_remove', { box: { id: box.id as string, address: box.address as string } })
  return { ok: true }
}

/**
 * Owner gives one shared mailbox to one person, changes what they may do in it, or takes it away.
 * `level`: 'read' (read only), 'send' (read and send), 'full' (read, send and delete; the default).
 */
export async function adminGrant(who: Me, p: { mailbox?: unknown; profile?: unknown; on?: unknown; level?: unknown }) {
  requireAdmin(who)
  const person = await personInCompany(who, p.profile)
  const admin = createAdminClient()
  const { data: box } = await admin.from('rpmail_mailboxes').select('id, kind, crew_reads, name, address').eq('id', String(p.mailbox ?? '')).eq('company_id', who.company_id).maybeSingle()
  if (!box || box.kind !== 'shared') throw new UserError('No such shared mailbox.')
  const logBox = { id: box.id as string, address: box.address as string }
  if (p.on === false) {
    await admin.from('rpmail_access').delete().eq('mailbox_id', box.id).eq('profile_id', person.id)
    await logActivity(who, 'access', { box: logBox, target: person.id, detail: 'taken away' })
    return { ok: true }
  }
  if (!mayGrant(person.role, box as Pick<Mailbox, 'kind' | 'crew_reads'>)) {
    throw new UserError(`${person.full_name ?? 'That person'} is a tech or shop login. They can only be given a mailbox marked "the crew reads this", because the others carry customer pricing.`)
  }
  const level: AccessLevel = p.level === 'read' || p.level === 'send' ? p.level : 'full'
  await admin.from('rpmail_access').upsert({ mailbox_id: box.id, profile_id: person.id, granted_by: who.id, can_send: level !== 'read', can_delete: level === 'full' }, { onConflict: 'mailbox_id,profile_id' })
  await logActivity(who, 'access', { box: logBox, target: person.id, detail: LEVEL_TEXT[level] })
  return { ok: true, level }
}
