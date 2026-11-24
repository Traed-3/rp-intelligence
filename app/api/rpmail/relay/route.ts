import { NextResponse, type NextRequest } from 'next/server'
import { relayAllowed, relayExchange } from '@/lib/rpmail/relay'
import { UserError } from '@/lib/rpmail/gmail'

// The Mac Studio helper that answers for Proton mailboxes (lib/rpmail/relay.ts). No sign-in: it proves itself with the
// shared secret in the Authorization header. Open in proxy.ts like the cron path.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (!relayAllowed(auth.startsWith('Bearer ') ? auth.slice(7) : null)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const body = await req.json().catch(() => ({}))
    return NextResponse.json(await relayExchange(body && typeof body === 'object' ? body : {}), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 })
    console.error('rpmail relay:', e instanceof Error ? e.message.slice(0, 200) : 'error')
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
