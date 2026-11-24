import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/construction/sites/search?q=40107
 * Typeahead for the quote/invoice "Site" box. Session-scoped (proxy.ts already
 * redirects anonymous callers). Matches con_sites by site number, address or city
 * so a picked site fills the facility address + city/state/zip on the document.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 403 })

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
  const limit = Math.min(20, Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') ?? '12', 10) || 12))
  if (q.length < 1) return NextResponse.json({ sites: [] })

  const like = `%${q.replace(/[%_,]/g, ' ')}%`
  const { data, error } = await admin
    .from('con_sites')
    .select('id, site_number, store_brand, address, city, state, zip')
    .eq('company_id', profile.company_id)
    .or(`site_number.ilike.${like},address.ilike.${like},city.ilike.${like}`)
    .order('site_number')
    .limit(limit * 3)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Exact site-number hits first, then the rest alphabetically.
  const qUpper = q.toUpperCase()
  const sites = (data ?? [])
    .sort((a, b) => {
      const ea = (a.site_number ?? '').toUpperCase() === qUpper ? -1 : 0
      const eb = (b.site_number ?? '').toUpperCase() === qUpper ? -1 : 0
      if (ea !== eb) return ea - eb
      return (a.site_number ?? '').localeCompare(b.site_number ?? '')
    })
    .slice(0, limit)
  return NextResponse.json({ sites })
}
