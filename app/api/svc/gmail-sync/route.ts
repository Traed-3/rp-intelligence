import { NextRequest, NextResponse } from 'next/server'
import { syncDispatcher, syncInvoicing, archiveStaleWorkOrders, captureMissingWorkOrderDocuments } from '@/lib/svc-gmail-sync'
import { reconcileWorkOrders } from '@/lib/svc-reconcile'
import { extractPendingWorkOrderDocuments } from '@/lib/svc-work-order-docs-extract'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The Supabase scheduler (pg_cron, migration svc_sync_pg_cron.sql) calls this route with a token that lives
 * only in Supabase Vault (`rps_sync_token`); `sync_token_ok()` checks it without the token leaving the database.
 */
async function syncTokenOk(token: string | null): Promise<boolean> {
  if (!token) return false
  const { data, error } = await createAdminClient().rpc('sync_token_ok', { t: token })
  return !error && data === true
}

// Allow enough time for a full pass through one mailbox.
export const maxDuration = 60

/**
 * GET /api/svc/gmail-sync?pass=dispatcher|invoicing|extract-docs[&max=N|&limit=N|&sinceDays=N]
 *
 * Both mailbox passes list ALL mail in their window (dispatcher default 7 days, invoicing 14), skip what is
 * already logged, and read up to `max` messages oldest-first inside a 45 s budget. `remaining` in the reply
 * says how many unlogged messages are left for the next run. `q` adds Gmail search terms to the window;
 * `backfill=1` (or `archive=0`) is the read-only catch-up mode — nothing in either mailbox is archived.
 *
 * `sinceDays` (default 14 for invoicing, 7 for dispatcher) — the rolling window is normally
 * fine since the 15-min cron never lets it lapse, but if the sync was ever
 * down for a stretch, or a completion note simply sat further back than 14
 * days before ever being fetched once, it falls outside the window forever.
 * Pass a much larger value for a one-time manual catch-up run.
 *
 * Each pass gets its own request (and its own 60s budget) — running both
 * mailboxes in one call proved too slow once invoicing had real volume
 * (first live run hit a 504 partway through). Omitting `pass` runs both
 * sequentially, which is fine for a manual/low-volume check but NOT what
 * the 15-min cron should do.
 *
 * `extract-docs` is a third, separate pass: Claude drafts a transcript for
 * completed-ticket attachments the invoicing pass captured (see
 * captureWorkOrderDocument in svc-gmail-sync.ts), bounded by `limit` so it
 * stays inside the same time budget.
 *
 * `reconcile` (cron step, DB-only) fixes open calls whose status disagrees with the evidence on file —
 * see lib/svc-reconcile.ts. apply=1 writes; otherwise it only reports what it would change.
 *
 * `archive-stale` is a manual maintenance sweep, not part of the cron: archives
 * work orders older than `days` (default 60) with no rpinvoicing mail ever
 * (checked live) and no system update in that window — see
 * archiveStaleWorkOrders in svc-gmail-sync.ts for the exact rule. Dry run by
 * default; pass apply=1 to actually write. Optional archivedBy=<profile id>.
 */
export async function GET(request: NextRequest) {
  const authHeader  = request.headers.get('authorization')
  const querySecret = request.nextUrl.searchParams.get('secret')
  const cronSecret  = process.env.CRON_SECRET

  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const isAuthed =
    (!!cronSecret && (bearer === cronSecret || querySecret === cronSecret)) ||
    await syncTokenOk(bearer ?? querySecret)

  if (!isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp = request.nextUrl.searchParams
  const pass = sp.get('pass')
  const maxResults = parseInt(sp.get('max') ?? '50', 10)
  const num = (k: string) => { const v = sp.get(k); return v != null && v !== '' ? parseInt(v, 10) : undefined }
  // backfill=1 / archive=0: the one-time catch-up — reads only, never archives anything in either mailbox.
  const backfill = sp.get('backfill') === '1'
  const archive = sp.get('archive') !== '0' && !backfill
  const passOpts = { max: maxResults, sinceDays: num('sinceDays'), untilDays: num('untilDays'), query: sp.get('q') ?? undefined, archive, backfill }

  try {
    if (pass === 'dispatcher') {
      const dispatcher = await syncDispatcher(passOpts)
      return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), dispatcher })
    }
    if (pass === 'invoicing') {
      const invoicing = await syncInvoicing(passOpts)
      return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), invoicing })
    }
    if (pass === 'extract-docs') {
      const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '5', 10)
      // `concurrency` reads that many tickets side by side (default 3) — the Nov 2026 re-read of the whole log uses more.
      const extracted = await extractPendingWorkOrderDocuments(limit, { concurrency: num('concurrency') })
      return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), extracted })
    }
    if (pass === 'capture-missing') {
      // Catch-up: ticket emails that were logged without their attachments being stored (Sept–Oct 2026 gap).
      const captured = await captureMissingWorkOrderDocuments(num('limit') ?? 12)
      return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), captured })
    }
    if (pass === 'lookup') {
      // Read-only diagnostic: search rpinvoicing for a raw Gmail query (e.g. a
      // subject:(WO1 OR WO2 OR ...) list) with no date restriction and no
      // writes — for checking whether specific old work orders have any
      // completion email at all, without crawling the full historical range.
      const q = request.nextUrl.searchParams.get('q')
      if (!q) return NextResponse.json({ error: 'q is required' }, { status: 400 })
      // Defaults to rpinvoicing (completion notes); pass mailbox=dispatcher to
      // check whether a work order was ever dispatched / updated there instead.
      const mailboxParam = request.nextUrl.searchParams.get('mailbox')
      const full = request.nextUrl.searchParams.get('full') === '1'
      if (mailboxParam === 'econstruction') {
        // Read-only look at econstruction.rp — which service calls were handed to construction.
        const bg = await import('@/lib/billing-gmail-client')
        // Gmail's per-minute quota is shared with the job-email feed reading this same inbox, so back off and retry on 403/429.
        const retry = async <T,>(fn: () => Promise<T>): Promise<T> => {
          for (let attempt = 0; ; attempt++) {
            try { return await fn() } catch (e: any) {
              if (attempt >= 4 || !/ 40[39] | 429 |Quota/i.test(String(e?.message))) throw e
              await new Promise(r => setTimeout(r, 6000 * (attempt + 1)))
            }
          }
        }
        const ids = await retry(() => bg.listMessages('econstruction', q, 80))
        const hits = []
        for (const id of ids) {
          const msg = await retry(() => full ? bg.getMessage('econstruction', id) : bg.getMessageMeta('econstruction', id))
          const hit: Record<string, unknown> = { id, threadId: msg.threadId, subject: bg.header(msg, 'Subject'), from: bg.header(msg, 'From'), to: bg.header(msg, 'To'), date: bg.header(msg, 'Date'), snippet: msg.snippet }
          if (full) hit.body = bg.extractText(msg).slice(0, 1500)
          hits.push(hit)
        }
        return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), count: hits.length, hits })
      }
      const mailbox = mailboxParam === 'dispatcher' ? 'dispatcher' : 'invoicing'
      const { listMessages, getMessage } = await import('@/lib/svc-gmail-client')
      const { extractBody, getHeader: gh } = await import('@/lib/svc-work-order-parser')
      const ids = await listMessages(mailbox, q, 100)
      const hits = []
      for (const id of ids) {
        const msg = await getMessage(mailbox, id)
        const headers: { name: string; value: string }[] = msg.payload?.headers ?? []
        const h = (n: string) => gh(headers, n)
        const hit: Record<string, unknown> = { id, threadId: msg.threadId, subject: h('Subject'), from: h('From'), date: h('Date'), snippet: msg.snippet }
        if (full) hit.body = extractBody(msg.payload).slice(0, 3000)
        hits.push(hit)
      }
      return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), count: hits.length, hits })
    }
    if (pass === 'reconcile') {
      // Replays every open call's evidence in time order — tech notes (even ones that arrived before the
      // call existed), customer invoice approvals, redirects/terminations, and the construction job the
      // call was handed to — and fixes any call whose status disagrees. Dry run unless apply=1.
      const dryRun = request.nextUrl.searchParams.get('apply') !== '1'
      const result = await reconcileWorkOrders({ dryRun, archive, archivedBy: request.nextUrl.searchParams.get('archivedBy') })
      return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), result })
    }
    if (pass === 'archive-stale') {
      // Sweeps for work orders that are old, dead in rpinvoicing (checked live,
      // not just the DB), and untouched — see archiveStaleWorkOrders for the
      // exact rule. Defaults to a dry run; pass apply=1 to actually archive.
      const days = parseInt(request.nextUrl.searchParams.get('days') ?? '60', 10)
      const dryRun = request.nextUrl.searchParams.get('apply') !== '1'
      const archivedBy = request.nextUrl.searchParams.get('archivedBy')
      const result = await archiveStaleWorkOrders(days, dryRun, archivedBy)
      return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), result })
    }

    const dispatcher = await syncDispatcher({ max: maxResults })
    const invoicing = await syncInvoicing({ max: maxResults })
    return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), dispatcher, invoicing })
  } catch (e: any) {
    console.error('[Service Dispatch Sync Error]', e)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
