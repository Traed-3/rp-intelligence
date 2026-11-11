'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ImageUpload } from '@/components/ui/image-upload'

type State = { error: string } | null
const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

type Asset   = { id: string; unit_number: string; name: string | null; make: string | null; model: string | null }
type PM      = { id: string; code: string; name: string }
type Cat     = { id: string; name: string }
type Ticket  = { id: string; ticket_number: string; title: string }
type ConJob  = { id: string; site_number: string | null; work_order_number: string | null; stage: string | null }

export function ExpenseForm({
  action,
  assets,
  paymentMethods,
  assetCategories,
  storeCategories,
  openTickets,
  constructionJobs,
  storeNumbers,
  projectCategories,
  sourceDoc = null,
}: {
  action: (state: State, formData: FormData) => Promise<State>
  assets: Asset[]
  paymentMethods: PM[]
  assetCategories: Cat[]
  storeCategories: Cat[]
  openTickets: Ticket[]
  constructionJobs: ConJob[]
  storeNumbers: string[]
  projectCategories: Record<string, string[]>
  /** the receipt email this expense is being keyed in from (credits its sender) */
  sourceDoc?: { id: string; sender: string | null; senderEmail: string | null; vendor: string | null; date: string | null; amount: number | null } | null
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const [expenseType, setExpenseType] = useState<string>('asset')
  const [conJobId, setConJobId] = useState('')
  const [pmCode, setPmCode] = useState('')
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [customPm, setCustomPm] = useState(false)
  const today = new Date().toISOString().split('T')[0]

  const categories = expenseType === 'asset' ? assetCategories : storeCategories
  const bidCats = projectCategories[conJobId] ?? []

  return (
    <form action={formAction} className="space-y-6">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>
      )}

      {/* Hidden receipt URL */}
      <input type="hidden" name="receipt_url" value={receiptUrl ?? ''} />
      <input type="hidden" name="payment_method_code" value={pmCode} />
      {sourceDoc && (
        <>
          <input type="hidden" name="source_document_id" value={sourceDoc.id} />
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
            From the receipt email sent by <strong>{sourceDoc.sender || sourceDoc.senderEmail}</strong>
            {sourceDoc.sender && sourceDoc.senderEmail ? <span className="text-blue-600"> &lt;{sourceDoc.senderEmail}&gt;</span> : null}
            {' '}— this expense will be submitted under their name.
          </div>
        </>
      )}

      {/* Date + Amount */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Date <span className="text-red-500">*</span></label>
          <input name="expense_date" type="date" className={inp} defaultValue={sourceDoc?.date ?? today} required />
        </div>
        <div>
          <label className={lbl}>Amount ($) <span className="text-red-500">*</span></label>
          <input name="amount" type="number" step="0.01" min="0" className={inp} placeholder="0.00" defaultValue={sourceDoc?.amount ?? undefined} required />
        </div>
      </div>

      {/* Expense Type */}
      <div>
        <label className={lbl}>Charge To</label>
        <div className="grid grid-cols-4 gap-2">
          {[
            { value: 'asset',   label: '🚛 Asset' },
            { value: 'store',   label: '🏪 Store #' },
            { value: 'project', label: '📋 Project #' },
            { value: 'general', label: '📦 General' },
          ].map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => setExpenseType(t.value)}
              className={`py-2 px-3 rounded-xl text-sm font-medium border transition-colors ${
                expenseType === t.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input type="hidden" name="expense_type" value={expenseType} />
      </div>

      {/* Dynamic target field */}
      {expenseType === 'asset' && (
        <div>
          <label className={lbl}>Asset</label>
          <select name="asset_id" className={inp}>
            <option value="">— Select asset —</option>
            {assets.map(a => (
              <option key={a.id} value={a.id}>
                {a.unit_number}{[a.make, a.model].filter(Boolean).length ? ` — ${[a.make, a.model].filter(Boolean).join(' ')}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      {expenseType === 'store' && (
        <div>
          <label className={lbl}>Store Number</label>
          <input name="store_number" className={inp} list="store-numbers" placeholder="Select or type a store #" autoComplete="off" />
          <datalist id="store-numbers">
            {storeNumbers.map(s => <option key={s} value={s} />)}
          </datalist>
          {storeNumbers.length === 0 && (
            <p className="text-xs text-gray-400 mt-1">No stores on file yet — type one and it’ll be suggested next time.</p>
          )}
        </div>
      )}
      {expenseType === 'project' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Construction Project</label>
            <select name="con_job_id" className={inp} value={conJobId} onChange={e => setConJobId(e.target.value)}>
              <option value="">— Select project —</option>
              {constructionJobs.map(j => (
                <option key={j.id} value={j.id}>
                  {j.site_number ?? '—'}{j.work_order_number ? ` (${j.work_order_number})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={lbl}>Or Project # <span className="font-normal text-gray-400">(field / service work)</span></label>
            <input name="project_number" className={inp} placeholder="e.g. 32346" />
          </div>
        </div>
      )}

      {/* Category — project mode pulls straight from the bid line items */}
      {expenseType === 'project' ? (
        <div>
          <label className={lbl}>Category <span className="font-normal text-gray-400">(from the project bid)</span></label>
          <input
            name="category_custom"
            className={inp}
            list="bid-categories"
            autoComplete="off"
            placeholder={bidCats.length ? 'Select from bid or type…' : 'Type a category'}
          />
          <datalist id="bid-categories">
            {bidCats.map(d => <option key={d} value={d} />)}
          </datalist>
          {conJobId && bidCats.length === 0 && (
            <p className="text-xs text-gray-400 mt-1">No bid line items on this project yet — type a category.</p>
          )}
        </div>
      ) : expenseType !== 'general' ? (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Category</label>
            <select name="category_id" className={inp}>
              <option value="">— Select —</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              <option value="">Other (type below)</option>
            </select>
          </div>
          <div>
            <label className={lbl}>Custom Category</label>
            <input name="category_custom" className={inp} placeholder="Leave blank if selected above" />
          </div>
        </div>
      ) : null}

      {/* Vendor + linked ticket (ticket only applies to non-project expenses) */}
      <div className={`grid gap-4 ${expenseType === 'project' ? 'grid-cols-1' : 'grid-cols-2'}`}>
        <div>
          <label className={lbl}>Vendor / Store</label>
          <input name="vendor" className={inp} placeholder="Home Depot, O'Reilly, etc." defaultValue={sourceDoc?.vendor ?? undefined} />
        </div>
        {expenseType !== 'project' && (
          <div>
            <label className={lbl}>Linked Ticket (optional)</label>
            <select name="repair_ticket_id" className={inp}>
              <option value="">— None —</option>
              {openTickets.map(t => (
                <option key={t.id} value={t.id}>{t.ticket_number} — {t.title.slice(0, 35)}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Payment method */}
      <div>
        <label className={lbl}>Payment Method</label>
        <div className="flex gap-2 flex-wrap mb-2">
          {paymentMethods.map(pm => (
            <button
              key={pm.code}
              type="button"
              onClick={() => { setPmCode(pm.code); setCustomPm(false) }}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                pmCode === pm.code
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
              }`}
              title={pm.name}
            >
              {pm.code}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCustomPm(!customPm)}
            className="px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-gray-300 text-gray-500 hover:border-gray-500"
          >
            + Other
          </button>
        </div>
        {customPm && (
          <input
            className={inp}
            placeholder="Enter 3–6 letter code (e.g. AMZ)"
            maxLength={6}
            value={pmCode}
            onChange={e => setPmCode(e.target.value.toUpperCase())}
          />
        )}
        {pmCode && <p className="text-xs text-blue-600 mt-1">Selected: {pmCode}</p>}
      </div>

      {/* Description + Notes */}
      <div>
        <label className={lbl}>Description</label>
        <input name="description" className={inp} placeholder="What was purchased?" />
      </div>
      <div>
        <label className={lbl}>Notes</label>
        <textarea name="notes" rows={2} className={inp} placeholder="Any additional details..." />
      </div>

      {/* Receipt photo */}
      <div>
        <label className={lbl}>Receipt Photo</label>
        <ImageUpload
          bucket="receipts"
          value={receiptUrl}
          onChange={setReceiptUrl}
          label="Take Photo or Upload Receipt"
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : 'Submit Expense'}
        </Button>
        <Link href="/expenses" className="text-sm text-gray-500 hover:text-gray-700">Cancel</Link>
      </div>
    </form>
  )
}
