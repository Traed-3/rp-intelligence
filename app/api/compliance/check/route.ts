import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runComplianceCheck } from '@/lib/compliance-notices'

export const maxDuration = 120

/**
 * GET /api/compliance/check — the daily DQF & certification expiry check.
 * Fired every morning by .github/workflows/compliance-check.yml (CRON_SECRET, Bearer or ?secret=).
 * Sends nothing while Compliance → Settings "Send emails" is off; `dry_run=1` previews regardless.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  const q = request.nextUrl.searchParams
  if (!secret || (auth !== `Bearer ${secret}` && q.get('secret') !== secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createAdminClient()
  const { data: companies } = await admin.from('companies').select('id, name')
  const results = []
  for (const c of companies ?? []) {
    results.push({ company: c.name, ...(await runComplianceCheck(admin, c.id, { dryRun: q.get('dry_run') === '1' })) })
  }
  return NextResponse.json({ ok: true, results })
}
