'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Sparkles, Loader2, AlertTriangle, CreditCard, Truck, Store, HardHat, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ImageUpload } from '@/components/ui/image-upload'
import type { ScanResult } from '@/lib/receipt-scan'

type State = { error: string } | null
const inp = 'rp-input'
const lbl = 'rp-label flex items-center gap-1.5 mb-1.5'

type Asset   = { id: string; unit_number: string; name: string | null; make: string | null; model: string | null }
type PM      = { id: string; code: string; name: string }
type Cat     = { id: string; name: string }
type Ticket  = { id: string; ticket_number: string; title: string }
type ConJob  = { id: string; site_number: string | null; work_order_number: string | null; stage: string | null }

type Fields = {
  expense_date: string; amount: string; vendor: string; description: string; notes: string
  expense_type: string; asset_id: string; store_number: string; con_job_id: string; project_number: string
  category_id: string; category_custom: string; repair_ticket_id: string; payment_method_code: string; card_last4: string
}
type Key = keyof Fields

/** Little "auto" tag beside a label; hover shows why the app picked it. Disappears once edited. */
function Auto({ k, auto, why }: { k: Key; auto: Set<Key>; why: Partial<Record<string, string>> }) {
  if (!auto.has(k)) return null
  return (
    <span title={why[k] ?? 'Filled in from the receipt'} className="inline-flex items-center gap-0.5 rounded-full bg-violet-50 border border-violet-200 px-1.5 py-px text-[10px] font-semibold text-violet-700 cursor-help">
      <Sparkles className="w-2.5 h-2.5" /> auto
    </span>
  )
}

export function ExpenseForm({
  action, assets, paymentMethods, assetCategories, storeCategories, openTickets, constructionJobs, storeNumbers, projectCategories, sourceDoc = null, cancelHref = '/expenses', fromForms = false,
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
  /** where Cancel goes: Expenses for the office, Forms for techs */
  cancelHref?: string
  /** opened from Forms: after sending, come back to this form */
  fromForms?: boolean
  sourceDoc?: { id: string; sender: string | null; senderEmail: string | null; vendor: string | null; date: string | null; amount: number | null } | null
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const [f, setF] = useState<Fields>({
    // Opened from a receipt email (/expenses/new?doc=…): start from what the inbox already extracted.
    expense_date: sourceDoc?.date ?? today, amount: sourceDoc?.amount != null ? sourceDoc.amount.toFixed(2) : '',
    vendor: sourceDoc?.vendor ?? '', description: '', notes: '',
    expense_type: 'asset', asset_id: '', store_number: '', con_job_id: '', project_number: '',
    category_id: '', category_custom: '', repair_ticket_id: '', payment_method_code: '', card_last4: '',
  })
  const [auto, setAuto] = useState<Set<Key>>(new Set())
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [customPm, setCustomPm] = useState(false)

  /** A person changed a field: take their value and drop the "auto" tag. */
  function edit<K extends Key>(k: K, v: Fields[K]) {
    setF(prev => ({ ...prev, [k]: v }))
    setAuto(prev => { if (!prev.has(k)) return prev; const n = new Set(prev); n.delete(k); return n })
  }

  async function onPhoto(url: string | null) {
    setReceiptUrl(url)
    setScanError(null)
    if (!url) return
    setScanning(true)
    try {
      const res = await fetch('/api/expenses/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ receipt_url: url }) })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? 'Could not read the receipt')
      const r = data as ScanResult
      setScan(r)
      // Fill only fields the scan has a value for and the person hasn't already typed into.
      const s = r.fields
      const next: Partial<Fields> = {}
      const filled = new Set<Key>()
      const put = (k: Key, v: string | number | null | undefined) => {
        if (v === null || v === undefined || v === '') return
        next[k] = String(v); filled.add(k)
      }
      put('expense_date', s.expense_date); put('amount', s.amount != null ? s.amount.toFixed(2) : null)
      put('vendor', s.vendor); put('description', s.description)
      put('payment_method_code', s.payment_method_code); put('card_last4', s.card_last4)
      put('expense_type', s.expense_type); put('asset_id', s.asset_id); put('store_number', s.store_number)
      put('con_job_id', s.con_job_id); put('project_number', s.project_number)
      put('category_id', s.category_id); put('category_custom', s.category_custom)
      setF(prev => {
        const out = { ...prev }
        for (const k of filled) {
          const typed = prev[k] !== '' && !['expense_date', 'expense_type'].includes(k) && !auto.has(k)
          if (!typed) (out as Record<Key, string>)[k] = next[k]!
          else filled.delete(k)
        }
        return out
      })
      setAuto(filled)
      if (s.payment_method_code && !paymentMethods.some(p => p.code === s.payment_method_code)) setCustomPm(true)
    } catch (e) {
      setScanError((e as Error).message)
    } finally {
      setScanning(false)
    }
  }

  const why = scan?.why ?? {}
  const categories = f.expense_type === 'asset' ? assetCategories : storeCategories
  const bidCats = projectCategories[f.con_job_id] ?? []
  const A = (k: Key) => <Auto k={k} auto={auto} why={why as Partial<Record<string, string>>} />
  const autoRing = (k: Key) => (auto.has(k) ? ' bg-violet-50/40 border-violet-300' : '')

  return (
    <form action={formAction} className="space-y-6">
      {state?.error && (
        <div className="rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">{state.error}</div>
      )}

      {/* Everything the form posts */}
      <input type="hidden" name="receipt_url" value={receiptUrl ?? ''} />
      {fromForms && <input type="hidden" name="from" value="forms" />}
      <input type="hidden" name="payment_method_code" value={f.payment_method_code} />
      <input type="hidden" name="expense_type" value={f.expense_type} />
      <input type="hidden" name="card_last4" value={f.card_last4} />
      <input type="hidden" name="card_brand" value={scan?.read.card_brand ?? ''} />
      <input type="hidden" name="ai_extracted" value={scan ? JSON.stringify(scan.read) : ''} />
      <input type="hidden" name="ai_filled" value={Array.from(auto).join(',')} />

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

      {/* Step 1 — receipt photo first */}
      <div className="rounded-xl border border-primary/15 bg-primary/5 p-4">
        <p className="text-sm font-semibold text-gray-900 mb-1">1. Snap the receipt</p>
        <p className="text-xs text-gray-500 mb-3">The app reads it and fills in what it can. Check everything below and change anything that’s wrong.</p>
        <ImageUpload bucket="receipts" value={receiptUrl} onChange={onPhoto} label="Take Photo or Upload Receipt" />
        {scanning && (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-violet-700"><Loader2 className="w-4 h-4 animate-spin" /> Reading the receipt…</p>
        )}
        {scanError && (
          <p className="mt-3 text-sm text-amber-700">Couldn’t read it automatically ({scanError}). Fill in the form below.</p>
        )}
        {scan && !scanning && (
          <div className="mt-3 space-y-1.5">
            <p className="inline-flex items-center gap-1.5 text-sm text-violet-700"><Sparkles className="w-4 h-4" /> Filled {auto.size} field{auto.size === 1 ? '' : 's'} — tagged <b>auto</b>. Hover a tag to see why.</p>
            {scan.cardholder && (
              <p className="flex items-center gap-1.5 text-xs text-gray-600"><CreditCard className="w-3.5 h-3.5" /> Card ending {scan.read.card_last4} — {scan.cardholder.name}</p>
            )}
            {scan.warnings.map(w => (
              <p key={w} className="flex items-start gap-1.5 text-xs text-amber-700"><AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> {w}</p>
            ))}
          </div>
        )}
      </div>

      {/* Date + Amount */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Date <span className="text-red-500">*</span> {A('expense_date')}</label>
          <input name="expense_date" type="date" className={inp + autoRing('expense_date')} value={f.expense_date} onChange={e => edit('expense_date', e.target.value)} required />
        </div>
        <div>
          <label className={lbl}>Amount ($) <span className="text-red-500">*</span> {A('amount')}</label>
          <input name="amount" type="number" step="0.01" className={inp + autoRing('amount')} placeholder="0.00" value={f.amount} onChange={e => edit('amount', e.target.value)} required />
        </div>
      </div>

      {/* Charge To */}
      <div>
        <label className={lbl}>Charge To {A('expense_type')}</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([
            { value: 'asset',   label: 'Truck',      icon: Truck },
            { value: 'store',   label: 'Store #',    icon: Store },
            { value: 'project', label: 'Project',    icon: HardHat },
            { value: 'general', label: 'Shop Stock', icon: Package },
          ] as const).map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => edit('expense_type', t.value)}
              data-on={f.expense_type === t.value}
              className="rp-chip justify-center !rounded-lg !py-2.5 flex-col sm:flex-row"
            >
              <t.icon className="size-4" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {f.expense_type === 'asset' && (
        <div>
          <label className={lbl}>Truck / Asset {A('asset_id')}</label>
          <select name="asset_id" className={inp + autoRing('asset_id')} value={f.asset_id} onChange={e => edit('asset_id', e.target.value)}>
            <option value="">Select a truck or asset</option>
            {assets.map(a => (
              <option key={a.id} value={a.id}>
                {a.unit_number}{[a.make, a.model].filter(Boolean).length ? ` — ${[a.make, a.model].filter(Boolean).join(' ')}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      {f.expense_type === 'store' && (
        <div>
          <label className={lbl}>Store Number {A('store_number')}</label>
          <input name="store_number" className={inp + autoRing('store_number')} list="store-numbers" placeholder="Select or type a store #" autoComplete="off" value={f.store_number} onChange={e => edit('store_number', e.target.value)} />
          <datalist id="store-numbers">
            {storeNumbers.map(s => <option key={s} value={s} />)}
          </datalist>
        </div>
      )}
      {f.expense_type === 'project' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Construction Project {A('con_job_id')}</label>
            <select name="con_job_id" className={inp + autoRing('con_job_id')} value={f.con_job_id} onChange={e => edit('con_job_id', e.target.value)}>
              <option value="">— Select project —</option>
              {constructionJobs.map(j => (
                <option key={j.id} value={j.id}>
                  {j.site_number ?? '—'}{j.work_order_number ? ` (${j.work_order_number})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={lbl}>Or Project # <span className="font-normal text-gray-400">(field / service work)</span> {A('project_number')}</label>
            <input name="project_number" className={inp + autoRing('project_number')} placeholder="e.g. 32346" value={f.project_number} onChange={e => edit('project_number', e.target.value)} />
          </div>
        </div>
      )}

      {/* Category — project mode pulls straight from the bid line items */}
      {f.expense_type === 'project' ? (
        <div>
          <label className={lbl}>Category <span className="font-normal text-gray-400">(from the project bid)</span> {A('category_custom')}</label>
          <input
            name="category_custom"
            className={inp + autoRing('category_custom')}
            list="bid-categories"
            autoComplete="off"
            placeholder={bidCats.length ? 'Select from bid or type…' : 'Type a category'}
            value={f.category_custom}
            onChange={e => edit('category_custom', e.target.value)}
          />
          <datalist id="bid-categories">
            {bidCats.map(d => <option key={d} value={d} />)}
          </datalist>
          {f.con_job_id && bidCats.length === 0 && (
            <p className="text-xs text-gray-400 mt-1">No bid line items on this project yet — type a category.</p>
          )}
        </div>
      ) : f.expense_type !== 'general' ? (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Category {A('category_id')}</label>
            <select name="category_id" className={inp + autoRing('category_id')} value={f.category_id} onChange={e => edit('category_id', e.target.value)}>
              <option value="">— Select —</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={lbl}>Custom Category</label>
            <input name="category_custom" className={inp} placeholder="Leave blank if selected above" value={f.category_custom} onChange={e => edit('category_custom', e.target.value)} />
          </div>
        </div>
      ) : null}

      {/* Vendor + linked ticket (ticket only applies to non-project expenses) */}
      <div className={`grid gap-4 ${f.expense_type === 'project' ? 'grid-cols-1' : 'grid-cols-2'}`}>
        <div>
          <label className={lbl}>Vendor / Store {A('vendor')}</label>
          <input name="vendor" className={inp + autoRing('vendor')} placeholder="Home Depot, O'Reilly, etc." value={f.vendor} onChange={e => edit('vendor', e.target.value)} />
        </div>
        {f.expense_type !== 'project' && (
          <div>
            <label className={lbl}>Linked Ticket (optional)</label>
            <select name="repair_ticket_id" className={inp} value={f.repair_ticket_id} onChange={e => edit('repair_ticket_id', e.target.value)}>
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
        <label className={lbl}>Payment Method {A('payment_method_code')}</label>
        <div className="flex gap-2 flex-wrap mb-2">
          {paymentMethods.map(pm => (
            <button
              key={pm.code}
              type="button"
              onClick={() => { edit('payment_method_code', pm.code); setCustomPm(false) }}
              data-on={f.payment_method_code === pm.code}
              className="rp-chip font-mono"
              title={pm.name}
            >
              {pm.code}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCustomPm(!customPm)}
            className="rp-chip border-dashed"
          >
            + Other
          </button>
        </div>
        {customPm && (
          <input
            className={inp}
            placeholder="Enter 3–6 letter code (e.g. AMZ)"
            maxLength={6}
            value={f.payment_method_code}
            onChange={e => edit('payment_method_code', e.target.value.toUpperCase())}
          />
        )}
        <div className="mt-2 flex items-center gap-2">
          <label className="text-xs text-gray-500 inline-flex items-center gap-1.5">Card last 4 {A('card_last4')}</label>
          <input
            className="rp-input !w-20 font-mono text-xs"
            inputMode="numeric" maxLength={4} placeholder="––––"
            value={f.card_last4}
            onChange={e => edit('card_last4', e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          {f.payment_method_code && <span className="text-xs text-muted-foreground">Selected: <b className="font-mono text-foreground">{f.payment_method_code}</b></span>}
        </div>
      </div>

      {/* Description + Notes */}
      <div>
        <label className={lbl}>Description {A('description')}</label>
        <input name="description" className={inp + autoRing('description')} placeholder="What was purchased?" value={f.description} onChange={e => edit('description', e.target.value)} />
      </div>
      <div>
        <label className={lbl}>Notes</label>
        <textarea name="notes" rows={2} className={inp} placeholder="Any additional details..." value={f.notes} onChange={e => edit('notes', e.target.value)} />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isPending || scanning}>
          {isPending ? 'Sending…' : scanning ? 'Reading receipt…' : 'Submit Receipt'}
        </Button>
        <Link href={cancelHref} className="text-sm text-muted-foreground hover:text-foreground">Cancel</Link>
      </div>
    </form>
  )
}

