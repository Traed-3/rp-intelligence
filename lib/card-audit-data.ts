import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { buildAuditRows, canAuditCards, monthRange, type CardDoc } from '@/lib/card-audit'

/** Who is asking, and may they see card spend? */
export async function cardAuditViewer() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile) return null
  return { ...profile, allowed: canAuditCards(profile.role) }
}

/** Card codes the company uses (Settings → Payment methods), longest first so "SPCO" wins over "SP". */
export async function loadCardCodes(companyId: string) {
  const { data } = await createAdminClient()
    .from('payment_methods').select('code, name').eq('company_id', companyId).eq('is_active', true).order('code')
  const methods = (data ?? []).filter(m => m.code)
  return { methods, codes: methods.map(m => m.code.toUpperCase()).sort((a, b) => b.length - a.length) }
}

/** Every receipt on one card for one month, with audit flags. */
export async function loadCardAudit(companyId: string, card: string, ym: string | undefined) {
  const range = monthRange(ym)
  const { codes, methods } = await loadCardCodes(companyId)
  // Any card or vendor account code from Settings → Payment methods (TEC, HDP, NOL, J&J …).
  const code = /^[A-Za-z&]{1,8}$/.test(card) ? card.toUpperCase() : 'TEC'
  // The month is decided by the receipt date, so look a week either side of the emailed date
  // (a 10/31 receipt emailed 11/2 still belongs to October).
  const pad = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString()
  const { data, error } = await createAdminClient()
    .from('billing_inbox_documents')
    .select('id, received_at, sender, sender_email, subject, vendor, reference, document_date, extracted, card_matched_at')
    .eq('company_id', companyId)
    .gte('received_at', pad(range.start, -7))
    .lt('received_at', pad(range.end, 7))
    .ilike('subject', `%${code}%`)
    .order('received_at')
    .limit(2000)
  if (error) throw new Error(error.message)
  const rows = buildAuditRows((data ?? []) as CardDoc[], code, codes.includes(code) ? codes : [...codes, code])
    .filter(r => r.date >= range.start && r.date < range.end)
  return { range, rows, methods, code }
}
