import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runBackground } from '@/lib/rpmail/background'
import { sendDue } from '@/lib/rpmail/schedule'

// RPMail's scheduler door. Supabase pg_cron calls it every 5 minutes (migration rpmail_background.sql) with the Vault
// token `rps_sync_token`; CRON_SECRET also works for a manual run. Nothing here is reachable by a signed-in person:
// it returns only counts. `?part=scheduled` (every minute) only sends what people scheduled themselves and is due.
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
    const part = req.nextUrl.searchParams.get('part')
    return NextResponse.json(part === 'scheduled' ? await sendDue(45_000) : await runBackground(), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('rpmail cron:', e instanceof Error ? e.message.slice(0, 300) : 'error')
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
