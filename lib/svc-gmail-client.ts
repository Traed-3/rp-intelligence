/**
 * Gmail API client for the SERVICE DISPATCH module (7-Eleven / Wawa / Sunoco
 * work orders) — a separate pair of mailboxes from the internal fleet sync
 * (gmail-client.ts / maintenance.rps@gmail.com):
 *
 *   - rpdispatcher@gmail.com — every portal (7HELP, WTSC, IT Service Desk)
 *     dumps "work order dispatched" notices here.
 *   - rpinvoicing@gmail.com  — field techs forward the dispatch email back
 *     here with a one-line COMPLETE / INCOMPLETE / RTN note once the job is
 *     actually done (or not).
 *
 * Both mailboxes share one OAuth client (SVC_GMAIL_CLIENT_ID/SECRET) but each
 * has its own refresh token, so every call below takes a `mailbox` param.
 */

export type SvcMailbox = 'dispatcher' | 'invoicing'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

function refreshTokenFor(mailbox: SvcMailbox): string {
  const key = mailbox === 'dispatcher' ? 'SVC_DISPATCHER_REFRESH_TOKEN' : 'SVC_INVOICING_REFRESH_TOKEN'
  const token = process.env[key]
  if (!token) throw new Error(`${key} is not set`)
  return token
}

// ── Token management (cached per mailbox) ───────────────────────────────────

const cachedTokens: Partial<Record<SvcMailbox, { token: string; expires: number }>> = {}

export async function getAccessToken(mailbox: SvcMailbox): Promise<string> {
  const cached = cachedTokens[mailbox]
  if (cached && Date.now() < cached.expires - 300_000) return cached.token

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshTokenFor(mailbox),
      client_id:     process.env.SVC_GMAIL_CLIENT_ID!,
      client_secret: process.env.SVC_GMAIL_CLIENT_SECRET!,
    }),
  })

  const data = await res.json()
  if (data.error) throw new Error(`Gmail token error (${mailbox}): ${data.error} — ${data.error_description}`)

  cachedTokens[mailbox] = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 }
  return data.access_token
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function gmailFetch(mailbox: SvcMailbox, path: string, params?: Record<string, string>) {
  const token = await getAccessToken(mailbox)
  const url = new URL(`${GMAIL_API}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gmail API ${path} (${mailbox}) failed: ${res.status} ${err}`)
  }
  return res.json()
}

/** List message IDs matching a query. */
export async function listMessages(mailbox: SvcMailbox, query: string, maxResults = 200): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined

  do {
    const params: Record<string, string> = { q: query, maxResults: String(Math.min(maxResults - ids.length, 500)) }
    if (pageToken) params.pageToken = pageToken

    const data = await gmailFetch(mailbox, '/messages', params)
    if (data.messages) ids.push(...data.messages.map((m: any) => m.id))
    pageToken = data.nextPageToken
  } while (pageToken && ids.length < maxResults)

  return ids
}

/** Get a full message (with body). */
export async function getMessage(mailbox: SvcMailbox, id: string): Promise<any> {
  return gmailFetch(mailbox, `/messages/${id}`, { format: 'full' })
}

/** Attachment bytes. */
export async function getAttachment(mailbox: SvcMailbox, messageId: string, attachmentId: string): Promise<Buffer> {
  const data = await gmailFetch(mailbox, `/messages/${messageId}/attachments/${attachmentId}`)
  return Buffer.from(data.data, 'base64url')
}

/** Every real attachment in a message's MIME tree (skips inline signature images under 8 KB). */
export function listAttachments(msg: any): { filename: string; mimeType: string; attachmentId: string; size: number }[] {
  const out: { filename: string; mimeType: string; attachmentId: string; size: number }[] = []
  const walk = (p: any) => {
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

/** Mark a message as read. */
export async function markAsRead(mailbox: SvcMailbox, id: string): Promise<void> {
  const token = await getAccessToken(mailbox)
  await fetch(`${GMAIL_API}/messages/${id}/modify`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  })
}

/** Archive a single message (remove it from the inbox). */
export async function archiveMessage(mailbox: SvcMailbox, id: string): Promise<void> {
  const token = await getAccessToken(mailbox)
  await fetch(`${GMAIL_API}/messages/${id}/modify`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ removeLabelIds: ['INBOX'] }),
  })
}

/**
 * Archive an entire thread (every message in it, not just one) — used when
 * archiving a work order from the Service Dispatch dashboard, since a single
 * dispatch is often split across more than one message (e.g. "assigned" +
 * "dispatched") that share a thread.
 */
export async function archiveThread(mailbox: SvcMailbox, threadId: string): Promise<void> {
  const token = await getAccessToken(mailbox)
  await fetch(`${GMAIL_API}/threads/${threadId}/modify`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ removeLabelIds: ['INBOX'] }),
  })
}
