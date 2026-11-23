import { createAdminClient } from '@/lib/supabase/admin'

// RPMail: Gmail API calls for one connected mailbox. Server only.
// The Google sign-in (refresh token) lives in Supabase Vault and is read through rpmail_token_get, which only the
// service role may call. Tokens are never logged and never sent to the browser.

// Full use of the mailbox (read, mark read, archive, spam, trash, drafts, send). It does not allow permanent delete.
export const G_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'

// A stand-in Google for testing on a developer's own machine. Ignored in production.
const dev = process.env.NODE_ENV !== 'production'
const GMAIL_BASE = (dev && process.env.RPMAIL_DEV_GMAIL_BASE) || 'https://gmail.googleapis.com/gmail/v1/users/me/'
const TOKEN_URL = (dev && process.env.RPMAIL_DEV_TOKEN_URL) || 'https://oauth2.googleapis.com/token'
export const AUTH_URL = (dev && process.env.RPMAIL_DEV_AUTH_URL) || 'https://accounts.google.com/o/oauth2/v2/auth'

export function googleClient(): { id: string; secret: string } | null {
  const id = (process.env.RPMAIL_GOOGLE_CLIENT_ID ?? '').trim()
  const secret = (process.env.RPMAIL_GOOGLE_CLIENT_SECRET ?? '').trim()
  return id && secret ? { id, secret } : null
}

/** Thrown when a mailbox has no working Google sign-in. The page shows the Connect screen. */
export class NotConnected extends Error {}
/** Something the person can fix; the message is shown to them as written. */
export class UserError extends Error {}

type Tok = { token: string; exp: number }
const cache = new Map<string, Tok>()

async function postForm(url: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok || data.error) throw new Error(`Google said: ${String(data.error_description ?? data.error ?? res.status)}`)
  return data
}

export async function exchangeCode(code: string, redirectUri: string) {
  const c = googleClient()
  if (!c) throw new UserError('Sign in with Google is not set up yet.')
  return postForm(TOKEN_URL, { code, client_id: c.id, client_secret: c.secret, redirect_uri: redirectUri, grant_type: 'authorization_code' })
}

export function rememberAccess(mailboxId: string, token: string, expiresIn: number) {
  cache.set(mailboxId, { token, exp: Date.now() + expiresIn * 1000 })
}
export function forgetAccess(mailboxId: string) { cache.delete(mailboxId) }

export async function accessToken(mailboxId: string): Promise<string> {
  const t = cache.get(mailboxId)
  if (t && t.exp > Date.now() + 60_000) return t.token
  const c = googleClient()
  if (!c) throw new NotConnected('Sign in with Google is not set up yet.')
  const { data: refresh, error } = await createAdminClient().rpc('rpmail_token_get', { p_mailbox: mailboxId })
  if (error) throw new Error('Could not read the sign-in for this mailbox.')
  if (!refresh) throw new NotConnected('This mailbox is not connected. Sign in with Google.')
  let d: Record<string, unknown>
  try {
    d = await postForm(TOKEN_URL, { client_id: c.id, client_secret: c.secret, refresh_token: refresh as string, grant_type: 'refresh_token' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/expired or revoked|invalid_grant/i.test(msg)) throw new NotConnected('The Google sign-in for this mailbox has ended. Sign in again.')
    throw e
  }
  rememberAccess(mailboxId, String(d.access_token), Number(d.expires_in ?? 3000))
  return String(d.access_token)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Google allows each mailbox only so many requests a second. Loading a whole mailbox must stay well under that, or
// Google slows everything down and refuses the message a person is trying to open at the same moment.
const nextSlot = new Map<string, number>()
/** Wait for this mailbox's next free slot. Used by the bulk loader only; a person's own clicks never wait. */
export async function pace(mailboxId: string, perSecond = 18): Promise<void> {
  const now = Date.now(), at = Math.max(now, nextSlot.get(mailboxId) ?? 0)
  nextSlot.set(mailboxId, at + 1000 / perSecond)
  if (at > now) await sleep(at - now)
}
/** Google saying "slow down" rather than "no". */
export class Busy extends Error {}

type Opts = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; params?: Record<string, string | string[]>; body?: unknown; token?: string
  /** How many times to ask before giving up (6 unless said). 1 = ask once, for a call that has a fall-back. */
  tries?: number }

/** One Gmail call. Returns null for "not found". Waits and retries when Google says slow down. */
export async function gmail<T = Record<string, unknown>>(mailboxId: string, path: string, opts: Opts = {}): Promise<T | null> {
  const url = new URL(GMAIL_BASE + path)
  for (const [k, v] of Object.entries(opts.params ?? {})) for (const x of Array.isArray(v) ? v : [v]) url.searchParams.append(k, x)
  const tries = opts.tries ?? 6
  for (let attempt = 0; attempt < tries; attempt++) {
    const token = opts.token ?? await accessToken(mailboxId)
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    })
    if (res.ok) return (res.status === 204 ? {} : await res.json().catch(() => ({}))) as T
    if (res.status === 404) return null
    const err = await res.json().catch(() => ({})) as { error?: { message?: string; errors?: { reason?: string }[] } }
    const reason = (err.error?.errors ?? []).map(e => e.reason ?? '').join(',')
    if (res.status === 401 && attempt === 0 && !opts.token) { forgetAccess(mailboxId); continue }
    if (res.status === 401) throw new NotConnected('The Google sign-in for this mailbox has ended. Sign in again.')
    // What Google refused and why, so a slow or failing mailbox can be diagnosed. No ids, addresses, tokens or mail text.
    console.warn('rpmail gmail', res.status, reason || '-', (opts.method ?? 'GET') + ' ' + path.replace(/[0-9a-f]{10,}/gi, ':id').replace(/attachments\/.+$/, 'attachments/:att'), 'try ' + (attempt + 1))
    const slowDown = res.status === 429 || (res.status === 403 && /ateLimit|quota/i.test(reason))
    if ((slowDown || res.status >= 500) && attempt < tries - 1) {
      await sleep(Math.min(8000, 600 * 2 ** attempt) + Math.random() * 300)
      continue
    }
    if (slowDown) throw new Busy('Gmail is busy with this mailbox right now. Try again in a moment.')
    if (res.status === 403) throw new UserError('Google refused: this sign-in does not allow that. Sign in again from the mailbox.')
    throw new Error(`Gmail said ${res.status}: ${(err.error?.message ?? '').slice(0, 200)}`)
  }
  throw new Error('Gmail kept refusing ' + path.split('?')[0])
}

/** Run `fn` over `items`, a few at a time. Gmail allows only so many requests a second per mailbox. */
export async function pooled<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]) }
  }))
  return out
}

export const b64url = (s: string) => Buffer.from(s, 'base64url')

export type GPart = { partId?: string; mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { size?: number; data?: string; attachmentId?: string }; parts?: GPart[] }
export type GMessage = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GPart; historyId?: string }

export const headerMap = (p: GPart | undefined) => {
  const h: Record<string, string> = {}
  for (const x of p?.headers ?? []) { const k = x.name.toLowerCase(); if (!(k in h)) h[k] = (x.value ?? '').replace(/[\r\n]+\s*/g, ' ') }
  return h
}

export const isHidden = (labels: string[] | undefined) => (labels ?? []).some(l => l === 'SPAM' || l === 'TRASH' || l === 'DRAFT' || l === 'CHAT')
