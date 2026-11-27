import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runClockGuard } from '@/lib/clock-guard'

// The time clock's forgotten-clock-out check. Supabase pg_cron calls it every 10 minutes (migration
// time_clock_guard.sql) with the Vault token `rps_sync_token`; CRON_SECRET also works for a manual run.
// Nothing here is reachable by a signed-in person: it returns only counts.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '') || null
  let ok = !!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET
  if (!ok && bearer) {
    const { data, error } = await createAdminClient().rpc('sync_token_ok', { t: bearer })
    ok = !error && data === true
  }
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await runClockGuard(), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('clock guard:', e instanceof Error ? e.message.slice(0, 300) : 'error')
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
