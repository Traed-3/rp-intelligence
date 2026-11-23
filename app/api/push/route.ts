import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPushEndpoint } from '@/lib/push'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { endpoint, keys } = body ?? {}
  if (!isPushEndpoint(endpoint) || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles').select('company_id').eq('id', user.id).single()

  await admin.from('push_subscriptions').upsert({
    profile_id: user.id,
    company_id: profile!.company_id,
    endpoint,
    p256dh:   keys.p256dh,
    auth_key: keys.auth,
  }, { onConflict: 'profile_id,endpoint' })

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { endpoint } = await req.json()
  if (!endpoint) return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 })

  const admin = createAdminClient()
  await admin.from('push_subscriptions')
    .delete()
    .eq('profile_id', user.id)
    .eq('endpoint', endpoint)

  return NextResponse.json({ ok: true })
}
