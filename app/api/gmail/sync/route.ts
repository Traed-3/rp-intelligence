import { NextRequest, NextResponse } from 'next/server'
import { syncGmailToTickets } from '@/lib/gmail-sync'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyGmailSyncError } from '@/lib/notifications'

const COMPANY_ID = 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'

// Allow longer runs for historical backfills (chunked imports of older mail)
export const maxDuration = 60

/**
 * GET /api/gmail/sync
 *
 * Called every 15 minutes by Supabase pg_cron (header x-cron-key, see
 * supabase/migrations/maintenance_sync_schedule.sql) and by GitHub Actions /
 * the Settings page with ?secret=CRON_SECRET.
 *
 * Query params:
 *  - after / before=YYYY/MM/DD → backfill a date window (oldest first, time-boxed;
 *                                 response `more: true` means call again)
 *  - matchedOnly=true          → backfill: log unknown-vehicle mail without queueing it for review
 *  - recheckPending=true       → backfill: re-try emails waiting in the review queue
 *  - recentDays=N              → regular run: also read archived mail from the last N days (default 3)
 *  - budgetMs=N                → stop starting new threads after N ms (default 40000, max 50000)
 */
export async function GET(request: NextRequest) {
  // Auth check — Vercel passes the secret in the Authorization header for crons
  const authHeader  = request.headers.get('authorization')
  const querySecret = request.nextUrl.searchParams.get('secret')
  const cronSecret  = process.env.CRON_SECRET

  let isAuthed =
    !!cronSecret && (authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret)

  // Supabase pg_cron calls with its own key (kept in Supabase Vault), checked in the DB
  const cronKey = request.headers.get('x-cron-key')
  if (!isAuthed && cronKey) {
    const { data } = await createAdminClient().rpc('verify_cron_key', { p_name: 'maint_sync_cron_key', p_key: cronKey })
    isAuthed = data === true
  }

  if (!isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const historical  = request.nextUrl.searchParams.get('historical') === 'true'
  const after       = request.nextUrl.searchParams.get('after')  || undefined
  const before      = request.nextUrl.searchParams.get('before') || undefined
  const skipUnmatched = request.nextUrl.searchParams.get('matchedOnly') === 'true'
  const recheckPending = request.nextUrl.searchParams.get('recheckPending') === 'true'
  const maxParam    = request.nextUrl.searchParams.get('max')
  const maxThreads  = maxParam ? Math.max(parseInt(maxParam, 10), 300) : undefined   // old callers pass max=30; the run is time-boxed instead
  const recentDays  = parseInt(request.nextUrl.searchParams.get('recentDays') ?? '3', 10)
  const budgetMs    = Math.min(parseInt(request.nextUrl.searchParams.get('budgetMs') ?? '40000', 10), 50_000)

  const admin = createAdminClient()

  try {
    const result = await syncGmailToTickets({ historical, maxThreads, after, before, skipUnmatched, recentDays, budgetMs, recheckPending })

    // If the refresh token died, the per-thread errors will say "Gmail token
    // error: invalid_grant ...". Surface that as an in-app + email notification
    // for managers so the next cron tick doesn't silently keep failing.
    const tokenError = result.errors.find(e =>
      /invalid_grant|expired or revoked|Gmail token error/i.test(e)
    )
    if (tokenError) {
      await notifyGmailSyncError(admin, COMPANY_ID, tokenError).catch(() => {})
    }

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      historical,
      ...result,
    })
  } catch (e: any) {
    console.error('[Gmail Sync Error]', e)
    if (/invalid_grant|expired or revoked|Gmail token error/i.test(e.message ?? '')) {
      await notifyGmailSyncError(admin, COMPANY_ID, e.message).catch(() => {})
    }
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
