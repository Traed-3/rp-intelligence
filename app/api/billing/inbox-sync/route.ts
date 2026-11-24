import { NextRequest, NextResponse } from 'next/server'
import { syncAllInboxes, syncInbox, extractPending } from '@/lib/billing-inbox-sync'
import { syncJobEmailFeed } from '@/lib/job-email-feed'
import { BILLING_INBOXES, inboxStatus, type BillingInbox } from '@/lib/billing-gmail-client'
import { backfillPermitEmails } from '@/lib/permit-email-backfill'
import { backfillFieldTicketsForJob } from '@/lib/field-ticket-gmail-match'
import { createAdminClient } from '@/lib/supabase/admin'
import { importReceiptExpenses } from '@/lib/receipt-expense-import'

/** Supabase pg_cron (migration billing_sync_pg_cron.sql) sends the Vault token `rps_sync_token`; sync_token_ok() checks it in the DB. */
async function syncTokenOk(token: string | null): Promise<boolean> {
  if (!token) return false
  const { data, error } = await createAdminClient().rpc('sync_token_ok', { t: token })
  return !error && data === true
}

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/billing/inbox-sync?secret=…&pass=sync|extract|both|updates|orders|expenses|backfill-permits[&inbox=econstruction][&max=30][&since=14][&limit=3][&after=YYYY-MM-DD][&before=YYYY-MM-DD]
 *
 * `after`/`before` pin a dated slice for `pass=sync&inbox=…` (historical catch-up) and `pass=expenses`.
 * `pass=expenses[&apply=1]` imports emailed receipts into Expenses & Receipts (dry run without apply=1).
 *
 * Supabase pg_cron (billing_sync_pg_cron.sql) hits `pass=sync`, `extract`, `updates` and `orders` on separate
 * ticks every 15 minutes so each stays under the 60 s budget (GitHub's schedule only fired every 5-7 hours). `pass=both` is for a manual "sync now".
 *
 * `pass=backfill-permits[&offset=0][&limit=5][&apply=1]` is the one-time
 * historical-permit-email backfill (see lib/permit-email-backfill.ts) — a
 * read-only preview without `apply=1`, batched by `offset`/`limit` since
 * Gmail's full-message fetches are slow enough to risk the 60s budget across
 * all sites in one call. Re-run with the `nextOffset` the response returns
 * until it comes back null.
 *
 * `pass=backfill-field-tickets&jobId=…[&apply=1]` matches one job's field
 * tickets (read from `rpinvoicing` — const.inv.rp auto-forwards there, see
 * lib/field-ticket-gmail-match.ts) to their econstruction typed updates and
 * files each as a needs_review con_daily_updates draft — a read-only preview
 * without `apply=1`. No extra inbox connection needed.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  const secret = request.nextUrl.searchParams.get('secret')
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  const cronOk = !!process.env.CRON_SECRET && (bearer === process.env.CRON_SECRET || secret === process.env.CRON_SECRET)
  if (!cronOk && !(await syncTokenOk(bearer ?? secret))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const q = request.nextUrl.searchParams
  const pass = q.get('pass') ?? 'both'
  const maxResults = Math.min(parseInt(q.get('max') ?? '30', 10) || 30, 100)
  const sinceDays = Math.min(parseInt(q.get('since') ?? '14', 10) || 14, 365)
  const limit = Math.min(parseInt(q.get('limit') ?? '3', 10) || 3, 10)
  const only = q.get('inbox') as BillingInbox | null
  const isoDay = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  const after = isoDay(q.get('after'))
  const before = isoDay(q.get('before'))

  try {
    const out: Record<string, unknown> = { ok: true, timestamp: new Date().toISOString(), inboxes: inboxStatus().map(i => ({ key: i.key, connected: i.connected })) }
    if (pass === 'sync' || pass === 'both') {
      if (only && BILLING_INBOXES.some(i => i.key === only)) out.sync = [await syncInbox(only, { maxResults, sinceDays, after, before })]
      else out.sync = await syncAllInboxes({ maxResults, sinceDays })
    }
    if (pass === 'extract' || pass === 'both') {
      out.extract = await extractPending(limit)
      // Emailed receipts → Expenses & Receipts (lib/receipt-expense-import.ts). Runs on every extract tick;
      // it only looks at the last 3 days and skips anything already imported, so it's cheap.
      out.expenses = await importReceiptExpenses()
    }
    // Manual / historical run: pass=expenses&after=2026-01-01[&before=2026-07-01][&apply=1] (dry run without apply=1).
    if (pass === 'expenses') {
      out.expenses = await importReceiptExpenses({ since: after ?? new Date(Date.now() - sinceDays * 86_400_000).toISOString(), until: before, apply: q.get('apply') === '1', limit: 500 })
    }
    // Tech updates, field tickets and Peggy's invoice workups onto their jobs (lib/job-email-feed.ts).
    if (pass === 'updates') out.updates = await syncJobEmailFeed({ sinceDays: Math.min(sinceDays, 7), part: 'updates' })
    if (pass === 'orders') out.updates = await syncJobEmailFeed({ sinceDays: Math.min(sinceDays, 7), part: 'orders' })
    if (pass === 'backfill-permits') {
      const offset = Math.max(parseInt(q.get('offset') ?? '0', 10) || 0, 0)
      const permitLimit = Math.min(parseInt(q.get('limit') ?? '5', 10) || 5, 10)
      out.backfillPermits = await backfillPermitEmails({ offset, limit: permitLimit, apply: q.get('apply') === '1' })
    }
    if (pass === 'backfill-field-tickets') {
      const jobId = q.get('jobId')
      if (!jobId) return NextResponse.json({ ok: false, error: 'jobId is required' }, { status: 400 })
      out.backfillFieldTickets = await backfillFieldTicketsForJob(jobId, { apply: q.get('apply') === '1' })
    }
    return NextResponse.json(out)
  } catch (e) {
    console.error('[Billing Inbox Sync Error]', e)
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
