import { NextRequest, NextResponse } from 'next/server'
import { toCsv } from '@/lib/csv'
import { submitterLabel } from '@/lib/receipt-submitter'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id, role').eq('id', user.id).single()
  if (!profile || !['owner', 'manager', 'shop_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start') ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  const end   = searchParams.get('end')   ?? new Date().toISOString().split('T')[0]

  const { data: expenses } = await admin
    .from('expenses')
    .select('expense_date, amount, vendor, description, expense_type, payment_method_code, store_number, project_number, submitter_name, submitter_email, profiles!expenses_submitted_by_fkey(full_name, email), assets(unit_number), expense_categories(name)')
    .eq('company_id', profile.company_id)
    .gte('expense_date', start)
    .lte('expense_date', end)
    .order('expense_date')

  const rows: unknown[][] = [
    ['Date', 'Employee', 'Amount', 'Type', 'Asset/Store/Project', 'Category', 'Vendor', 'Payment', 'Description'],
    ...(expenses ?? []).map(e => [
      e.expense_date,
      submitterLabel(e as any) ?? '',
      Number(e.amount).toFixed(2),
      e.expense_type,
      (e as any).assets?.unit_number ?? e.store_number ?? e.project_number ?? '',
      (e as any).expense_categories?.name ?? '',
      e.vendor ?? '',
      e.payment_method_code ?? '',
      e.description ?? '',
    ]),
  ]

  return new NextResponse(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="expenses_${start}_${end}.csv"`,
    },
  })
}
