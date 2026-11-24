import { NextRequest, NextResponse } from 'next/server'
import { toCsv } from '@/lib/csv'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })
}
function fmtHours(mins: number | null) {
  if (mins == null) return ''
  return (mins / 60).toFixed(2)
}

export async function GET(request: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()

  if (!profile || !['owner', 'manager', 'shop_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start') ?? new Date().toISOString().split('T')[0]
  const end   = searchParams.get('end')   ?? start
  const empId = searchParams.get('employee') ?? null

  let query = admin
    .from('time_clock_entries')
    .select('id, clock_in, clock_out, total_minutes, is_approved, manually_adjusted, adjustment_note, profiles(full_name, email)')
    .eq('company_id', profile.company_id)
    .gte('clock_in', new Date(start).toISOString())
    .lte('clock_in', new Date(end + 'T23:59:59.999Z').toISOString())
    .order('clock_in', { ascending: true })

  if (empId) query = (query as any).eq('profile_id', empId)

  const { data: entries } = await query

  // Build CSV
  const rows: unknown[][] = [
    ['Employee', 'Email', 'Date', 'Clock In', 'Clock Out', 'Total Hours', 'Approved', 'Adjusted', 'Note'],
  ]

  for (const e of entries ?? []) {
    const p = (e as any).profiles
    rows.push([
      p?.full_name ?? '',
      p?.email ?? '',
      fmtDate(e.clock_in),
      fmtTime(e.clock_in),
      e.clock_out ? fmtTime(e.clock_out) : '',
      fmtHours(e.total_minutes),
      e.is_approved ? 'Yes' : 'No',
      e.manually_adjusted ? 'Yes' : 'No',
      e.adjustment_note ?? '',
    ])
  }

  const csv = toCsv(rows)
  const filename = `payroll_${start}_${end}.csv`

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
