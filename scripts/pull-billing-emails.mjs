#!/usr/bin/env node
/**
 * Pull RPS invoices / vendor quotes / receipts / packing slips out of a Gmail
 * inbox and save the attachments to a folder, with a manifest.
 *
 * Works for ANY of the RPS inboxes once that inbox has a refresh token:
 *   econstruction.rp@gmail.com   (construction dispatch: Peggy's invoice reviews, packing slips, vendor quotes)
 *   constructionreceipts@gmail.com (vendor receipts)
 *   rpinvoicing@gmail.com          (service invoicing)
 *   constructioninvoicing@gmail.com
 *
 * Usage:
 *   node scripts/pull-billing-emails.mjs --inbox econstruction --since 2026/03/15 --out "/path/to/folder"
 *   node scripts/pull-billing-emails.mjs --inbox constructionreceipts --since 2025/09/01 --query "has:attachment"
 *
 * Tokens: put one refresh token per inbox in .env.local as
 *   GMAIL_TOKEN_ECONSTRUCTION=...   GMAIL_TOKEN_CONSTRUCTIONRECEIPTS=...   GMAIL_TOKEN_RPINVOICING=...
 * (mint each one the same way as GMAIL_REFRESH_TOKEN: OAuth Playground, gmail.readonly scope,
 *  signed in as THAT inbox — see scripts/refresh-gmail-token.mjs for the walkthrough).
 * Falls back to GMAIL_REFRESH_TOKEN when --inbox is omitted (= maintenance.rps).
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n')
    .map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]])
)
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(s => {
  const [k, ...v] = s.trim().split(' '); return [k, v.join(' ').trim() || true]
}))

const inbox = (args.inbox || '').toUpperCase().replace(/[^A-Z]/g, '')
const refreshToken = inbox ? env[`GMAIL_TOKEN_${inbox}`] : env.GMAIL_REFRESH_TOKEN
if (!refreshToken) { console.error(`No token for inbox "${args.inbox}". Add GMAIL_TOKEN_${inbox} to .env.local`); process.exit(1) }

const since = args.since || '2026/03/15'
const outDir = args.out || resolve(process.env.HOME, 'Library/Mobile Documents/com~apple~CloudDocs/RP - Rappahannock Petroleum/Operations/RPS Project Quote Docs/Quote and Invoice Documents', `Email Pull - ${args.inbox || 'maintenance'}`)
// Default query covers all four document kinds; override with --query
const query = args.query || `has:attachment after:${since} (invoice OR quote OR proposal OR estimate OR receipt OR "packing slip")`

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
let access = null
async function token() {
  if (access) return access
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET }) })
  const d = await r.json(); if (d.error) throw new Error(`token: ${d.error} ${d.error_description || ''}`)
  return (access = d.access_token)
}
async function api(path, params = {}) {
  const u = new URL(`${API}${path}`); Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v))
  const r = await fetch(u, { headers: { Authorization: `Bearer ${await token()}` } })
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`)
  return r.json()
}
function classify(subject, from) {
  const s = subject.toLowerCase()
  if (/packing slip/.test(s)) return 'packing_slip'
  if (/pwilmoth/.test(from) && /invoice/.test(s)) return 'rps_invoice'
  if (/receipt/.test(s)) return 'receipt'
  if (/quote|proposal|estimate/.test(s)) return 'vendor_quote'
  if (/invoice/.test(s)) return 'vendor_invoice'
  return 'other'
}
function walk(part, out = []) {
  if (part.filename && part.body?.attachmentId) out.push({ id: part.body.attachmentId, filename: part.filename, mime: part.mimeType })
  ;(part.parts || []).forEach(p => walk(p, out)); return out
}
const safe = s => s.replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 90)

mkdirSync(outDir, { recursive: true })
const manifestPath = join(outDir, 'manifest.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf-8')) : {}

let pageToken, threads = []
do {
  const r = await api('/threads', { q: query, maxResults: '100', ...(pageToken ? { pageToken } : {}) })
  threads.push(...(r.threads || [])); pageToken = r.nextPageToken
} while (pageToken)
console.log(`${threads.length} threads match: ${query}`)

let saved = 0
for (const t of threads) {
  const th = await api(`/threads/${t.id}`, { format: 'full' })
  for (const m of th.messages) {
    if (manifest[m.id]) continue
    const h = Object.fromEntries((m.payload.headers || []).map(x => [x.name.toLowerCase(), x.value]))
    const atts = walk(m.payload).filter(a => !/^image\/(png|gif)$/.test(a.mime) || /\.(pdf|xlsx?|csv)$/i.test(a.filename))
    if (!atts.length) continue
    const kind = classify(h.subject || '', h.from || '')
    const date = new Date(Number(m.internalDate)).toISOString().slice(0, 10)
    const dir = join(outDir, kind); mkdirSync(dir, { recursive: true })
    const files = []
    for (const a of atts) {
      const d = await api(`/messages/${m.id}/attachments/${a.id}`)
      const buf = Buffer.from(d.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
      const fn = `${date} ${safe((h.subject || 'no subject').replace(/^(re|fwd?):\s*/i, ''))} [${m.id.slice(-6)}] ${safe(a.filename)}`
      writeFileSync(join(dir, fn), buf); files.push(fn); saved++
    }
    manifest[m.id] = { thread: t.id, date, from: h.from, subject: h.subject, kind, files }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1))
}
console.log(`saved ${saved} new attachments → ${outDir}`)
