import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSuggestions, loadReceiptImage, loadScanContext, readReceipt } from '@/lib/receipt-scan'

export const maxDuration = 60

// POST { receipt_url } → suggested values for the New Expense form. Saves nothing.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { receipt_url?: string }
  if (!body.receipt_url) return NextResponse.json({ error: 'No receipt photo' }, { status: 400 })

  const admin = createAdminClient()
  const image = await loadReceiptImage(admin, body.receipt_url)
  if (!image) return NextResponse.json({ error: 'Could not open the receipt photo' }, { status: 400 })

  try {
    const ctx = await loadScanContext(admin, user.id)
    const read = await readReceipt([image], Array.from(new Set(ctx.categories.map(c => c.name))))
    return NextResponse.json(buildSuggestions(read, ctx))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
