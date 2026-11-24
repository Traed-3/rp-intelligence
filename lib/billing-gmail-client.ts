/**
 * Gmail API client for the BILLING + INVENTORY module (Phase 5).
 *
 * The other two clients each own a fixed mailbox pair (gmail-client.ts =
 * maintenance.rps fleet inbox, svc-gmail-client.ts = rpdispatcher/rpinvoicing).
 * Billing needs to read *any* of the RPS inboxes that receive paperwork —
 * packing slips, vendor invoices, counter receipts, vendor quotes — so this
 * client resolves a refresh token per inbox at call time:
 *
 *   1. GMAIL_TOKEN_<INBOX>  (minted for that inbox with the GMAIL_CLIENT_ID app;
 *      see scripts/refresh-gmail-token.mjs for the OAuth Playground walkthrough)
 *   2. otherwise, a token the app already has for the same mailbox:
 *        rpinvoicing  → SVC_INVOICING_REFRESH_TOKEN (Service Dispatch client)
 *        maintenance  → GMAIL_REFRESH_TOKEN         (fleet client)
 *
 * Read-only scope is enough for everything here. Nothing is ever archived or
 * marked read from this client — the inbox stays exactly as the humans left it.
 */

export type BillingInbox = 'econstruction' | 'constructionreceipts' | 'rpinvoicing' | 'maintenance'

export const BILLING_INBOXES: ReadonlyArray<{ key: BillingInbox; email: string; purpose: string; envKey: string }> = [
  { key: 'econstruction',        email: 'econstruction.rp@gmail.com',    purpose: 'Construction dispatch — packing slips, vendor quotes, invoice workups', envKey: 'GMAIL_TOKEN_ECONSTRUCTION' },
  { key: 'constructionreceipts', email: 'constructionreceipts@gmail.com', purpose: 'Vendor receipts — cost updates',                                        envKey: 'GMAIL_TOKEN_CONSTRUCTIONRECEIPTS' },
  { key: 'rpinvoicing',          email: 'rpinvoicing@gmail.com',          purpose: 'Service invoicing — tech completions, ticket workups, and (via a Gmail auto-forward rule on const.inv.rp) every foreman field ticket', envKey: 'GMAIL_TOKEN_RPINVOICING' },
  { key: 'maintenance',          email: 'maintenance.rps@gmail.com',      purpose: 'Fleet maintenance — shop receipts',                                    envKey: 'GMAIL_TOKEN_MAINTENANCE' },
]

// const.inv.rp@gmail.com has Gmail's own "Forward a copy of incoming mail to
// rpinvoicing@gmail.com" rule turned on (confirmed in its Settings ->
// Forwarding, 2026-09-26) — so every foreman field ticket sent there already
// lands in rpinvoicing too, attachments and all, the instant it arrives. No
// separate const.inv.rp connection/token is needed for the field-ticket
// backfill; it reads rpinvoicing directly (see lib/field-ticket-gmail-match.ts).

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

type Creds = { refreshToken: string; clientId: string; clientSecret: string; via: string }

function credentialsFor(inbox: BillingInbox): Creds | null {
  const meta = BILLING_INBOXES.find(i => i.key === inbox)
  if (!meta) return null
  const direct = process.env[meta.envKey]
  if (direct && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET) {
    return { refreshToken: direct, clientId: process.env.GMAIL_CLIENT_ID, clientSecret: process.env.GMAIL_CLIENT_SECRET, via: meta.envKey }
  }
  if (inbox === 'rpinvoicing' && process.env.SVC_INVOICING_REFRESH_TOKEN && process.env.SVC_GMAIL_CLIENT_ID && process.env.SVC_GMAIL_CLIENT_SECRET) {
    return { refreshToken: process.env.SVC_INVOICING_REFRESH_TOKEN, clientId: process.env.SVC_GMAIL_CLIENT_ID, clientSecret: process.env.SVC_GMAIL_CLIENT_SECRET, via: 'SVC_INVOICING_REFRESH_TOKEN' }
  }
  if (inbox === 'maintenance' && process.env.GMAIL_REFRESH_TOKEN && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET) {
    return { refreshToken: process.env.GMAIL_REFRESH_TOKEN, clientId: process.env.GMAIL_CLIENT_ID, clientSecret: process.env.GMAIL_CLIENT_SECRET, via: 'GMAIL_REFRESH_TOKEN' }
  }
  return null
}

/** Which inboxes this deployment can actually read (for the Settings panel and the sync loop). */
export function inboxStatus() {
  return BILLING_INBOXES.map(i => {
    const c = credentialsFor(i.key)
    return { ...i, connected: !!c, via: c?.via ?? null }
  })
}

export function connectedInboxes(): BillingInbox[] {
  return inboxStatus().filter(i => i.connected).map(i => i.key)
}

// ── Token cache (per inbox, per process) ─────────────────────────────────────

const cached: Partial<Record<BillingInbox, { token: string; expires: number }>> = {}

export async function getAccessToken(inbox: BillingInbox): Promise<string> {
  const c = cached[inbox]
  if (c && Date.now() < c.expires - 300_000) return c.token
  const creds = credentialsFor(inbox)
  if (!creds) throw new Error(`No Gmail token for inbox "${inbox}" — set ${BILLING_INBOXES.find(i => i.key === inbox)?.envKey}`)

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refreshToken, client_id: creds.clientId, client_secret: creds.clientSecret }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Gmail token error (${inbox}): ${data.error} — ${data.error_description ?? ''}`)
  cached[inbox] = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 }
  return data.access_token
}

async function gmailFetch(inbox: BillingInbox, path: string, params?: Record<string, string>) {
  const token = await getAccessToken(inbox)
  const url = new URL(`${GMAIL_API}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Gmail API ${path} (${inbox}) failed: ${res.status} ${await res.text()}`)
  return res.json()
}

/** Message IDs matching a Gmail search query (newest first, as Gmail returns them). */
export async function listMessages(inbox: BillingInbox, query: string, maxResults = 50): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const params: Record<string, string> = { q: query, maxResults: String(Math.min(maxResults - ids.length, 100)) }
    if (pageToken) params.pageToken = pageToken
    const data = await gmailFetch(inbox, '/messages', params)
    if (data.messages) ids.push(...data.messages.map((m: { id: string }) => m.id))
    pageToken = data.nextPageToken
  } while (pageToken && ids.length < maxResults)
  return ids
}

/** Full message (headers + MIME tree; attachment bodies come separately). */
export async function getMessage(inbox: BillingInbox, id: string): Promise<GmailMessage> {
  return gmailFetch(inbox, `/messages/${id}`, { format: 'full' })
}

/** Headers + snippet only — a fraction of the Gmail quota cost of a full fetch (for read-only lookups). */
export async function getMessageMeta(inbox: BillingInbox, id: string): Promise<GmailMessage> {
  return gmailFetch(inbox, `/messages/${id}`, { format: 'metadata' })
}

/** Every message in a thread (headers + MIME tree), oldest first. */
export async function getThread(inbox: BillingInbox, threadId: string): Promise<{ id: string; messages: GmailMessage[] }> {
  const data = await gmailFetch(inbox, `/threads/${threadId}`, { format: 'full' })
  return { id: data.id, messages: (data.messages ?? []) as GmailMessage[] }
}

/** Attachment bytes. */
export async function getAttachment(inbox: BillingInbox, messageId: string, attachmentId: string): Promise<Buffer> {
  const data = await gmailFetch(inbox, `/messages/${messageId}/attachments/${attachmentId}`)
  return Buffer.from(data.data, 'base64url')
}

// ── MIME helpers ──────────────────────────────────────────────────────────────

export type GmailPart = { partId?: string; mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { attachmentId?: string; size?: number; data?: string }; parts?: GmailPart[] }
export type GmailMessage = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GmailPart }

export function header(msg: GmailMessage, name: string): string {
  const h = msg.payload?.headers?.find(x => x.name.toLowerCase() === name.toLowerCase())
  return h?.value ?? ''
}

/** "Peggy Smith <peggy@x.com>" → { name, email } */
export function parseAddress(raw: string): { name: string; email: string } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() }
  return { name: '', email: raw.trim().toLowerCase() }
}

/** Every real attachment in the MIME tree (skips inline signature images under 8 KB). */
export function listAttachments(msg: GmailMessage): { filename: string; mimeType: string; attachmentId: string; size: number }[] {
  const out: { filename: string; mimeType: string; attachmentId: string; size: number }[] = []
  const walk = (p?: GmailPart) => {
    if (!p) return
    if (p.filename && p.body?.attachmentId) {
      const size = p.body.size ?? 0
      const mime = (p.mimeType ?? '').toLowerCase()
      const tiny = mime.startsWith('image/') && size < 8_000
      if (!tiny) out.push({ filename: p.filename, mimeType: mime || 'application/octet-stream', attachmentId: p.body.attachmentId, size })
    }
    p.parts?.forEach(walk)
  }
  walk(msg.payload)
  return out
}

/** Plain-text body (first text/plain part, else stripped text/html). */
export function extractText(msg: GmailMessage): string {
  let plain = '', html = ''
  const walk = (p?: GmailPart) => {
    if (!p) return
    if (p.mimeType === 'text/plain' && p.body?.data && !plain) plain = Buffer.from(p.body.data, 'base64url').toString('utf8')
    if (p.mimeType === 'text/html' && p.body?.data && !html) html = Buffer.from(p.body.data, 'base64url').toString('utf8')
    p.parts?.forEach(walk)
  }
  walk(msg.payload)
  if (plain) return plain
  return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}
