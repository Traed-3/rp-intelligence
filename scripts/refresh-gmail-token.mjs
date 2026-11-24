#!/usr/bin/env node
/**
 * One-time helper to refresh the Gmail OAuth refresh token.
 *
 * The Gmail sync uses an OAuth refresh token to mint short-lived access tokens
 * on every cron run. When that refresh token expires/is revoked (typically
 * after a long inactive stretch, a password change, or manual revocation),
 * the sync breaks until a new one is minted. New emails stop importing,
 * archives stop closing tickets, and the dashboard goes stale.
 *
 * Run:    npm run refresh-gmail
 * Steps:  the script prints OAuth Playground instructions, you paste the new
 *         refresh token, it tests it against Google and updates .env.local.
 */
import readline from 'node:readline/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stdin as input, stdout as output } from 'node:process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ENV_PATH = resolve(__dirname, '..', '.env.local')

function readEnv() {
  const text = readFileSync(ENV_PATH, 'utf-8')
  const env = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) env[m[1]] = m[2]
  }
  return env
}

function writeEnvUpdate(key, value) {
  let text = readFileSync(ENV_PATH, 'utf-8')
  const re = new RegExp(`^${key}=.*`, 'm')
  if (re.test(text)) {
    text = text.replace(re, `${key}=${value}`)
  } else {
    text = text.replace(/\n*$/, '') + `\n${key}=${value}\n`
  }
  writeFileSync(ENV_PATH, text)
}

async function testToken(refreshToken, clientId, clientSecret) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  const data = await res.json()
  if (data.error) return { ok: false, error: data.error_description ?? data.error }
  return { ok: true, accessToken: data.access_token }
}

async function testGmailReachable(accessToken) {
  const res = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const data = await res.json()
  if (data.error) return { ok: false, error: data.error.message }
  return { ok: true, email: data.emailAddress, messagesTotal: data.messagesTotal }
}

async function main() {
  const env = readEnv()
  const clientId     = env.GMAIL_CLIENT_ID
  const clientSecret = env.GMAIL_CLIENT_SECRET
  const gmailEmail   = env.GMAIL_EMAIL

  if (!clientId || !clientSecret) {
    console.error('GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET missing from .env.local')
    process.exit(1)
  }

  console.log(`
============================================================
Gmail token refresh
============================================================

Why: production Gmail sync has been failing because the refresh
token is expired or revoked. No new emails have imported, no
archived threads have closed, no completion notes have landed.

Do this in your browser, then come back here:

1. Open  https://developers.google.com/oauthplayground

2. Click the GEAR icon (top right). Check "Use your own OAuth
   credentials" and paste:
     OAuth Client ID:     ${clientId}
     OAuth Client secret: ${clientSecret}
   Click Close.

3. On the LEFT, scroll to "Gmail API v1" and check this scope:
     https://www.googleapis.com/auth/gmail.readonly

4. Click "Authorize APIs". Sign in as ${gmailEmail || 'the maintenance.rps Gmail account'}.

5. Click "Exchange authorization code for tokens".

6. Copy the "Refresh token" value from the response on the right.

Paste it below ↓
`)

  const rl = readline.createInterface({ input, output })
  const newToken = (await rl.question('New refresh token: ')).trim()
  rl.close()

  if (!newToken) {
    console.error('No token provided. Exiting.')
    process.exit(1)
  }

  process.stdout.write('Testing token against Google… ')
  const tokenTest = await testToken(newToken, clientId, clientSecret)
  if (!tokenTest.ok) {
    console.error(`FAILED.\n  ${tokenTest.error}\n\nCheck that you copied the token correctly and that the OAuth client ID/secret in .env.local match the ones you pasted into the playground.`)
    process.exit(1)
  }
  console.log('OK')

  process.stdout.write('Calling Gmail API…                ')
  const gmailTest = await testGmailReachable(tokenTest.accessToken)
  if (!gmailTest.ok) {
    console.error(`FAILED.\n  ${gmailTest.error}\n\nToken minted but Gmail API call failed. Maybe the scope is wrong (must include gmail.readonly).`)
    process.exit(1)
  }
  console.log(`OK (inbox: ${gmailTest.email}, ${gmailTest.messagesTotal} messages)`)

  if (gmailEmail && gmailTest.email !== gmailEmail) {
    console.warn(`\nWARNING: you authorized ${gmailTest.email} but GMAIL_EMAIL in .env.local is ${gmailEmail}.`)
    console.warn(`If the system is supposed to read ${gmailEmail}, redo the OAuth Playground steps and sign in with THAT account.\n`)
  }

  writeEnvUpdate('GMAIL_REFRESH_TOKEN', newToken)
  console.log(`Wrote new GMAIL_REFRESH_TOKEN to .env.local`)

  console.log(`
============================================================
Local is fixed. Now update production:
============================================================

1. Open  https://vercel.com/traed-3s-projects/rp-intelligence/settings/environment-variables
2. Find  GMAIL_REFRESH_TOKEN  →  click the ⋮ menu → Edit
3. Replace the value with the new token (same one you just pasted here).
4. Save.
5. Go to the Deployments tab, click the latest deployment → click "Redeploy"
   on the menu (⋮). Keep "Use existing Build Cache" checked.

Within ~3 minutes the next Gmail cron tick will pull every email
that came in since June 4 — including Austin's P16 rattling ticket
from June 9. The dashboard will catch up automatically.
`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
