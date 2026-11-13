import { noAccountingOrHr } from '@/lib/role-access'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sellPriceForLine } from '@/lib/inventory'

/**
 * GET /api/inventory/parts/search?q=drop%20tube&limit=15
 * Catalog lookup for the quote/invoice/ticket line pickers. Session-scoped
 * (proxy.ts already redirects anonymous callers). Returns the part plus a
 * suggested line price = cost × (1 + markup) + freight, with document-level
 * sales tax left to the document so nothing is taxed twice.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id, role').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'No profile' }, { status: 403 })

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
  const limit = Math.min(30, Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') ?? '15', 10) || 15))
  // Optional REV19 category (1–12): the builder's per-category pickers only want parts filed there.
  const category = parseInt(request.nextUrl.searchParams.get('category') ?? '', 10)
  // Service tickets price from the master list's sell price; quotes keep the cost + markup rule.
  const preferSell = request.nextUrl.searchParams.get('prefer') === 'sell'
  if (q.length < 2) return NextResponse.json({ parts: [] })

  const like = `%${q.replace(/[%_,]/g, ' ')}%`
  let query = admin
    .from('parts')
    .select('id, part_number, description, category, subcategory, item_type, uom, taxable, unit_cost, cost_source, cost_vendor, cost_invoice_ref, cost_date, price_status, freight_per_unit, markup_pct, sell_price, sku')
    .eq('company_id', profile.company_id)
    .eq('active', true)
    .or(`part_number.ilike.${like},description.ilike.${like},subcategory.ilike.${like}`)
  if (category >= 1 && category <= 12) query = query.eq('category', category)
  const { data, error } = await query.order('description').limit(limit * 3)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Rank by how trustworthy the price is (RPS rule: receipt beats vendor quote beats book beats web),
  // then exact part-number hits, then description.
  const RANK: Record<string, number> = { receipt: 0, vendor_quote: 1, book: 2, sell_billed: 3, web: 4, estimate: 5, rate_card: 6 }
  const qUpper = q.toUpperCase()
  const parts = (data ?? [])
    .map(p => ({ ...p, suggested_price: preferSell && p.sell_price != null ? Number(p.sell_price) : sellPriceForLine(p, 0) }))
    .sort((a, b) => {
      const ea = (a.part_number ?? '').toUpperCase() === qUpper ? -1 : 0, eb = (b.part_number ?? '').toUpperCase() === qUpper ? -1 : 0
      if (ea !== eb) return ea - eb
      const ra = a.unit_cost != null ? (RANK[a.cost_source ?? ''] ?? 8) : 9, rb = b.unit_cost != null ? (RANK[b.cost_source ?? ''] ?? 8) : 9
      if (ra !== rb) return ra - rb
      return a.description.localeCompare(b.description)
    })
    .slice(0, limit)
  // Techs, mechanics and shop employees get cost only: never the sell price, markup or a suggested customer price.
  // (A field ticket line saved without a price is priced on the server from the catalog.)
  if (noAccountingOrHr(profile.role)) {
    return NextResponse.json({ parts: parts.map(({ sell_price: _s, markup_pct: _m, suggested_price: _p, ...rest }) => rest) })
  }
  return NextResponse.json({ parts })
}
