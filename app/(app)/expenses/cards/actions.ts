'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { cardAuditViewer } from '@/lib/card-audit-data'

/** Tick (or un-tick) receipts as matched to the card statement. */
export async function setStatementMatch(formData: FormData) {
  const viewer = await cardAuditViewer()
  if (!viewer?.allowed) return
  const ids = formData.getAll('id').filter((v): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v))
  if (!ids.length) return
  const matched = formData.get('matched') === '1'
  await createAdminClient()
    .from('billing_inbox_documents')
    .update(matched
      ? { card_matched_at: new Date().toISOString(), card_matched_by: viewer.id }
      : { card_matched_at: null, card_matched_by: null })
    .eq('company_id', viewer.company_id)
    .in('id', ids)
  revalidatePath('/expenses/cards')
}
