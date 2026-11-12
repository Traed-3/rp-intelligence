'use client'

import { useActionState, useRef, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { HR_BUCKET, ITEM_STATUSES, fmtDate, type EmployeeItem, type Health, type RequirementType } from '@/lib/compliance'
import { saveItem, prepareUpload, attachDocument, removeItem, type ActionState } from '@/app/(app)/compliance/actions'
import { HealthChip } from './health-chip'
import { Paperclip, ChevronDown, ChevronUp, Upload, Trash2 } from 'lucide-react'

const inp = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-[11px] font-medium text-gray-500 mb-0.5'

export function ItemRow({
  employeeId, type, item, health, exp, daysLeft, required, canWrite,
}: {
  employeeId: string
  type: RequirementType
  item: EmployeeItem | null
  health: Health
  exp: string | null
  daysLeft: number | null
  required: boolean
  canWrite: boolean
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState(saveItem, {} as ActionState)
  const [upMsg, setUpMsg] = useState<string | null>(null)
  const [uploading, startUpload] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

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
        {item?.document_path && <Paperclip className="w-4 h-4 text-gray-400 shrink-0" />}
        <span className="text-xs text-gray-600 tabular-nums w-20 text-right shrink-0">{type.expires ? (exp ? fmtDate(exp) : '—') : ''}</span>
        <span className="w-32 shrink-0 flex justify-end"><HealthChip health={health} daysLeft={daysLeft} /></span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 bg-gray-50/60">
          {type.description && <p className="text-xs text-gray-500 mb-2">{type.description}</p>}
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
