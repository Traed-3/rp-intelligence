/**
 * Gmail API client — uses OAuth 2.0 refresh token to get access tokens
 * and makes Gmail API calls without any external SDK dependency.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

// ── Token management ──────────────────────────────────────────────────────────

let cachedToken: { token: string; expires: number } | null = null

export async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (5-min buffer)
  if (cachedToken && Date.now() < cachedToken.expires - 300_000) {
    return cachedToken.token
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
      client_id:     process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
    }),
  })

  const data = await res.json()
  if (data.error) throw new Error(`Gmail token error: ${data.error} — ${data.error_description}`)

  cachedToken = {
    token:   data.access_token,
    expires: Date.now() + data.expires_in * 1000,
  }
  return data.access_token
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function gmailFetch(path: string, params?: Record<string, string>) {
  const token = await getAccessToken()
  const url = new URL(`${GMAIL_API}${path}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gmail API ${path} failed: ${res.status} ${err}`)
  }
  return res.json()
}

// ── Public API ────────────────────────────────────────────────────────────────

/** List message IDs matching a query */
export async function listMessages(query: string, maxResults = 500): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined

  do {
    const params: Record<string, string> = { q: query, maxResults: String(Math.min(maxResults - ids.length, 100)) }
    if (pageToken) params.pageToken = pageToken

    const data = await gmailFetch('/messages', params)
    if (data.messages) ids.push(...data.messages.map((m: any) => m.id))
    pageToken = data.nextPageToken
  } while (pageToken && ids.length < maxResults)

  return ids
}

/** List message ids WITH their thread ids (Gmail returns both — no extra fetch needed). Newest first. */
export async function listMessageRefs(query: string, maxResults = 500): Promise<{ id: string; threadId: string }[]> {
  const refs: { id: string; threadId: string }[] = []
  let pageToken: string | undefined
  do {
    const params: Record<string, string> = { q: query, maxResults: String(Math.min(maxResults - refs.length, 500)) }
    if (pageToken) params.pageToken = pageToken
    const data = await gmailFetch('/messages', params)
    for (const m of data.messages ?? []) refs.push({ id: m.id, threadId: m.threadId })
    pageToken = data.nextPageToken
  } while (pageToken && refs.length < maxResults)
  return refs
}

/** Get a full message (with body) */
export async function getMessage(id: string): Promise<any> {
  return gmailFetch(`/messages/${id}`, { format: 'full' })
}

/** Get a full thread with all replies */
export async function getThread(id: string): Promise<any> {
  return gmailFetch(`/threads/${id}`, { format: 'full' })
}

/** List thread IDs matching a query (e.g. "in:inbox") */
export async function listThreadIds(query: string): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const params: Record<string, string> = { q: query, maxResults: '100' }
    if (pageToken) params.pageToken = pageToken
    const data = await gmailFetch('/threads', params)
    if (data.threads) ids.push(...data.threads.map((t: any) => t.id))
    pageToken = data.nextPageToken
  } while (pageToken)
  return ids
}

/** List all labels (used for per-asset folders) */
export async function listLabels(): Promise<any[]> {
  const data = await gmailFetch('/labels')
  return data.labels ?? []
}

/** Download a message attachment's bytes (returns a Buffer) */
export async function getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
  const data = await gmailFetch(`/messages/${messageId}/attachments/${attachmentId}`)
  return Buffer.from(data.data, 'base64url')
}

/** Mark a message as read */
export async function markAsRead(id: string): Promise<void> {
  const token = await getAccessToken()
  await fetch(`${GMAIL_API}/messages/${id}/modify`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  })
}
