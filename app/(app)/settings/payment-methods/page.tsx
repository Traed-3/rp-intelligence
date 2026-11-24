import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { togglePaymentMethod } from '@/app/(app)/expenses/actions'
import { addPaymentMethodDirect, saveExpenseCard, deleteExpenseCard, learnCardsFromPastReceipts } from './actions'
import { PendingButton } from '@/components/expenses/pending-button'

export const maxDuration = 300

export default async function PaymentMethodsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin.from('profiles').select('company_id, role').eq('id', user!.id).single()
  if (!['owner', 'manager'].includes(profile?.role ?? '')) redirect('/settings')

  const { data: methods } = await admin
    .from('payment_methods')
    .select('id, code, name, is_active')
    .eq('company_id', profile!.company_id)
    .order('code')

  const [{ data: cards }, { data: people }] = await Promise.all([
    admin.from('expense_cards')
      .select('id, last4, brand, payment_method_code, holder_profile_id, holder_label, source, seen_count, conflict_note, last_seen_at')
      .eq('company_id', profile!.company_id).order('payment_method_code').order('last4'),
    admin.from('profiles').select('id, full_name').eq('company_id', profile!.company_id).not('full_name', 'is', null).order('full_name'),
  ])
  const nameOf = new Map((people ?? []).map(p => [p.id as string, p.full_name as string]))
  const codes = (methods ?? []).filter(m => m.is_active).map(m => m.code as string)
  const sel = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-700">← Settings</Link>
        <span className="text-gray-300">/</span>
        <h1 className="rp-title">Payment Methods</h1>
      </div>

      <p className="text-sm text-gray-500 mb-6">
        These codes appear on expense receipts. Keep them short (2–6 letters) and memorable.
        Inactive codes are hidden from forms but old records keep their code.
      </p>

      {/* Existing methods */}
      <div className="rp-card overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
          <h2 className="font-semibold text-sm text-gray-900">Current Codes</h2>
        </div>
        <div className="divide-y divide-gray-50">
          {(methods ?? []).map(m => {
            async function handleToggle() {
              'use server'
              await togglePaymentMethod(m.id, !m.is_active)
            }
            return (
              <div key={m.id} className="px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-sm bg-gray-100 px-2.5 py-1 rounded-lg">{m.code}</span>
                  <span className="text-sm text-gray-700">{m.name}</span>
                </div>
                <form action={handleToggle}>
                  <button type="submit" className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                    m.is_active
                      ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                      : 'bg-gray-100 text-gray-400 border-gray-200 hover:bg-gray-200'
                  }`}>
                    {m.is_active ? 'Active' : 'Inactive'}
                  </button>
                </form>
              </div>
            )
          })}
        </div>
      </div>

      {/* Tech cards — card last-4 → whose card it is */}
      <div className="rp-card overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-sm text-gray-900">Cards (last 4 digits)</h2>
            <p className="text-xs text-gray-500 mt-0.5">When a receipt photo shows one of these numbers, the expense form fills in the code and whose card it is.
              Numbers are learned automatically from saved TEC receipts; a change you make here is never overwritten.</p>
          </div>
          <form action={learnCardsFromPastReceipts} className="shrink-0">
            <PendingButton busy="Reading receipts…" className="text-xs px-3 py-1.5 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 font-medium hover:bg-violet-100 disabled:opacity-60">
              Learn from past receipts
            </PendingButton>
          </form>
        </div>
        <div className="divide-y divide-gray-50">
          {(cards ?? []).length === 0 && (
            <p className="px-5 py-4 text-sm text-gray-400">No cards yet — click “Learn from past receipts” to read the TEC receipts already emailed to Construction Receipts.</p>
          )}
          {(cards ?? []).map(c => {
            const holder = c.holder_profile_id ? nameOf.get(c.holder_profile_id) ?? '—' : c.holder_label
            return (
              <div key={c.id} className="px-5 py-3">
                <form action={saveExpenseCard} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="last4" value={c.last4} />
                  <span className="font-mono font-bold text-sm bg-gray-100 px-2.5 py-1 rounded-lg">•••• {c.last4}</span>
                  <select name="payment_method_code" defaultValue={c.payment_method_code} className={sel}>
                    {Array.from(new Set([...codes, c.payment_method_code])).map(code => <option key={code} value={code}>{code}</option>)}
                  </select>
                  <select name="holder_profile_id" defaultValue={c.holder_profile_id ?? ''} className={sel + ' min-w-44'}>
                    <option value="">{c.holder_label ? `— ${c.holder_label} —` : '— Whose card? —'}</option>
                    {(people ?? []).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                  {c.holder_label && <input type="hidden" name="holder_label" value={c.holder_label} />}
                  <button type="submit" className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90">Save</button>
                  <button formAction={deleteExpenseCard} name="id" value={c.id} className="text-xs px-2 py-1.5 rounded-lg text-gray-400 hover:text-red-600">Remove</button>
                </form>
                <p className="text-xs text-gray-400 mt-1">
                  {!holder && <span className="text-amber-600 font-medium">Needs a cardholder · </span>}
                  {c.source === 'manual' ? 'Set by hand' : c.source === 'backfill' ? 'Learned from past receipts' : 'Learned from saved receipts'}
                  {c.seen_count ? ` · seen on ${c.seen_count} receipt${c.seen_count === 1 ? '' : 's'}` : ''}
                  {c.conflict_note ? ` · ${c.conflict_note}` : ''}
                </p>
              </div>
            )
          })}
        </div>
        <form action={saveExpenseCard} className="px-5 py-3 border-t border-gray-100 bg-gray-50/60 flex flex-wrap items-center gap-2">
          <input name="last4" inputMode="numeric" maxLength={4} placeholder="Last 4" className={sel + ' w-24 font-mono'} />
          <select name="payment_method_code" defaultValue="TEC" className={sel}>
            {codes.map(code => <option key={code} value={code}>{code}</option>)}
          </select>
          <select name="holder_profile_id" defaultValue="" className={sel + ' min-w-44'}>
            <option value="">— Whose card? —</option>
            {(people ?? []).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <button type="submit" className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90">Add card</button>
        </form>
      </div>

      {/* Add new */}
      <div className="rp-card p-5">
        <h2 className="font-semibold text-gray-900 mb-4">Add New Code</h2>
        <form action={addPaymentMethodDirect} className="flex gap-3">
          <input
            name="code"
            className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="ABC"
            maxLength={6}
          />
          <input
            name="name"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Full name, e.g. Amazon Business Card"
          />
          <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors">
            Add
          </button>
        </form>
      </div>
    </div>
  )
}
