'use client'

import { useActionState, useRef, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { HR_BUCKET, ITEM_STATUSES, fmtDate, type EmployeeItem, type Health, type RequirementType } from '@/lib/compliance'
import { saveItem, prepareUpload, attachDocument, removeItem, setNoPriorDot, type ActionState } from '@/app/(app)/compliance/actions'
import type { FormLink } from '@/lib/compliance-forms'
import { HealthChip } from './health-chip'
import { Paperclip, ChevronDown, ChevronUp, Upload, Trash2, Download, StickyNote } from 'lucide-react'

const inp = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-[11px] font-medium text-gray-500 mb-0.5'

export function ItemRow({
  employeeId, type, item, health, exp, daysLeft, required, canWrite, forms = [], noPriorDot,
}: {
  employeeId: string
  type: RequirementType
  item: EmployeeItem | null
  health: Health
  exp: string | null
  daysLeft: number | null
  required: boolean
  canWrite: boolean
  /** Blank RP forms that belong to this item. */
  forms?: FormLink[]
  /** Only passed on the Safety Performance History item: the driver's "no previous DOT employer" check mark. */
  noPriorDot?: { on: boolean; notedAt: string | null; notedBy: string | null }
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(saveItem, {} as ActionState)
  const [upMsg, setUpMsg] = useState<string | null>(null)
  const [uploading, startUpload] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)
  const [npMsg, setNpMsg] = useState<string | null>(null)
  const [npPending, startNp] = useTransition()
  const toggleNoPrior = (on: boolean) => {
    setNpMsg(null)
    startNp(async () => { const res = await setNoPriorDot(employeeId, on); setNpMsg(res.error ?? res.message ?? null) })
  }

  function upload(file: File) {
    setUpMsg(null)
    startUpload(async () => {
      const prep = await prepareUpload(employeeId, type.id, file.name)
      if (prep.error || !prep.path || !prep.token || !prep.itemId) { setUpMsg(prep.error ?? 'Upload failed.'); return }
      const { error } = await createClient().storage.from(HR_BUCKET).uploadToSignedUrl(prep.path, prep.token, file, { contentType: file.type || undefined })
      if (error) { setUpMsg(error.message); return }
      const res = await attachDocument(prep.itemId, prep.path, file.name)
      setUpMsg(res.error ?? res.message ?? null)
    })
  }

  const computed = !item?.expiration_date && exp  // date derived from issued + renewal period
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {type.name}
            {!required && type.applies_to !== 'optional' && <span className="ml-2 text-[10px] font-semibold text-gray-400 uppercase">not required</span>}
          </p>
          <p className="text-xs text-gray-400 truncate">
            {[type.issuer, type.regulation, item?.cert_number ? `#${item.cert_number}` : null, item?.issued_date ? `issued ${fmtDate(item.issued_date)}` : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        {noPriorDot?.on && <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-green-200 bg-green-50 text-[10px] font-semibold text-green-800 uppercase"><StickyNote className="w-3 h-3" /><span className="hidden lg:inline">No previous DOT employer - </span>note in file</span>}
        {item?.document_path && <Paperclip className="w-4 h-4 text-gray-400 shrink-0" />}
        <span className="text-xs text-gray-600 tabular-nums w-20 text-right shrink-0">{type.expires ? (exp ? fmtDate(exp) : '—') : ''}</span>
        <span className="w-32 shrink-0 flex justify-end"><HealthChip health={health} daysLeft={daysLeft} /></span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 bg-gray-50/60">
          {type.description && <p className="text-xs text-gray-500 mb-2">{type.description}</p>}
          {noPriorDot && (
            <div className={`mb-3 rounded-lg border px-3 py-2.5 ${noPriorDot.on ? 'border-green-200 bg-green-50' : 'border-blue-200 bg-blue-50/60'}`}>
              <label className="flex items-start gap-2.5 text-sm font-medium text-gray-900">
                <input type="checkbox" className="w-4 h-4 mt-0.5" checked={noPriorDot.on} disabled={!canWrite || npPending} onChange={e => toggleNoPrior(e.target.checked)} />
                <span>
                  No previous DOT employer - this driver did not drive for a DOT-regulated employer in the 3 years before hire
                  <span className="block text-xs font-normal text-gray-600 mt-0.5">
                    DOT accepts a note in the file in place of the safety history. Ticking this writes the note, marks this item on file and flags the driver.
                    {noPriorDot.on && noPriorDot.notedAt ? ` Noted ${fmtDate(noPriorDot.notedAt)}${noPriorDot.notedBy ? ` by ${noPriorDot.notedBy}` : ''}.` : ''}
                  </span>
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-3 mt-1.5 pl-6">
                {noPriorDot.on && <a href={`/api/compliance/forms/no-prior-dot-note?employee=${employeeId}`} target="_blank" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"><Download className="w-3.5 h-3.5" />Print the note for the paper file</a>}
                {npPending && <span className="text-xs text-gray-500">Saving…</span>}
                {npMsg && <span className="text-xs text-gray-700">{npMsg}</span>}
              </div>
            </div>
          )}
          {forms.filter(f => !f.generated).length > 0 && (
            <p className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="font-medium text-gray-500">Blank form:</span>
              {forms.filter(f => !f.generated).map(f => (
                <a key={f.slug} href={`/api/compliance/forms/${f.slug}?download=1`} className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline"><Download className="w-3.5 h-3.5" />{f.title}</a>
              ))}
            </p>
          )}
          <form action={formAction} className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
            <input type="hidden" name="employee_id" value={employeeId} />
            <input type="hidden" name="type_id" value={type.id} />
            <div className="col-span-2 md:col-span-1">
              <label className={lbl}>Status</label>
              <select name="status" defaultValue={item?.status && item.status !== 'missing' ? item.status : 'on_file'} disabled={!canWrite} className={inp}>
                {ITEM_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>{type.category === 'dqf' && type.renewal_months === 12 ? 'Completed' : 'Issued'}</label>
              <input type="date" name="issued_date" defaultValue={item?.issued_date ?? ''} disabled={!canWrite} className={inp} />
            </div>
            {type.expires && (
              <div>
                <label className={lbl}>Expires{type.renewal_months ? ` (blank = +${type.renewal_months} mo)` : ''}</label>
                <input type="date" name="expiration_date" defaultValue={item?.expiration_date ?? ''} disabled={!canWrite} className={inp} />
              </div>
            )}
            <div>
              <label className={lbl}>Card / cert #</label>
              <input name="cert_number" defaultValue={item?.cert_number ?? ''} disabled={!canWrite} className={inp} />
            </div>
            <div className="col-span-2">
              <label className={lbl}>Notes</label>
              <input name="notes" defaultValue={item?.notes ?? ''} disabled={!canWrite} className={inp} />
            </div>
            {canWrite && (
              <div className="col-span-2 md:col-span-6 flex flex-wrap items-center gap-3 pt-1">
                <button disabled={pending} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50">{pending ? 'Saving…' : 'Save'}</button>
                <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-card text-xs font-semibold text-gray-700 hover:border-blue-300 disabled:opacity-50">
                  <Upload className="w-3.5 h-3.5" />{uploading ? 'Uploading…' : item?.document_path ? 'Replace scan' : 'Upload card / document'}
                </button>
                {item?.document_path && <a href={`/api/compliance/documents/${item.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"><Paperclip className="w-3.5 h-3.5" />{item.document_name ?? 'View document'}</a>}
                {computed && <span className="text-xs text-gray-500">Expiry {fmtDate(exp)} = issued + {type.renewal_months} months</span>}
                {state.error && <span className="text-xs text-red-600">{state.error}</span>}
                {state.message && <span className="text-xs text-green-700">{state.message}</span>}
                {upMsg && <span className="text-xs text-gray-700">{upMsg}</span>}
                {item && !required && (
                  <button type="submit" formAction={removeItem} name="item_id" value={item.id} formNoValidate
                    onClick={e => { if (!confirm(`Remove ${type.name} from this file?`)) e.preventDefault() }}
                    className="ml-auto inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" />Remove</button>
                )}
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  )
}
