'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { receiptReportViewer } from '@/lib/receipt-report'

/** Tick (or un-tick) receipts as found on the bill / statement. */
export async function setStatementChecked(ids: string[], checked: boolean): Promise<{ error?: string }> {
  const viewer = await receiptReportViewer()
  if (!viewer?.allowed || !viewer.canCheck) return { error: 'Only owners, managers and office staff can check receipts off.' }
  const clean = (Array.isArray(ids) ? ids : []).filter(v => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)).slice(0, 2000)
  if (!clean.length) return {}
  const patch = checked
    ? { statement_checked_at: new Date().toISOString(), statement_checked_by: viewer.id }
    : { statement_checked_at: null, statement_checked_by: null }
  const admin = createAdminClient()
  for (let i = 0; i < clean.length; i += 200) {
    const { error } = await admin.from('expenses').update(patch).eq('company_id', viewer.company_id).in('id', clean.slice(i, i + 200))
    if (error) return { error: error.message }
  }
  revalidatePath('/expenses/receipts')
  return {}
}
