'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CON_STAGES, CON_PRIORITIES } from '@/lib/construction'
import { classifySite } from '@/lib/site-number'
import type { ActionState } from '@/app/(app)/construction/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

type Customer = { id: string; name: string; brand?: string | null }
type Site = { id: string; site_number: string; store_brand: string | null; customer_id: string | null; facility_address?: string | null }
type Manager = { id: string; full_name: string }

export type JobRecord = {
  id: string
  site_id: string | null
  site_number: string | null
  customer_id: string | null
  work_order_number: string | null
  po_number?: string | null
  master_sync_hold?: boolean | null
  stage: string
  status_detail: string | null
  scope_of_work: string | null
  facility_address: string | null
  gas_brand: string | null
  program: string | null
  priority: string
  date_received: string | null
  project_start_date: string | null
  response_time: string | null
  assigned_manager_id: string | null
  notes: string | null
}

export function JobForm({
  action,
  job,
  customers,
  sites,
  managers,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  job?: JobRecord
  customers: Customer[]
  sites: Site[]
  managers: Manager[]
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const j = job
  const [siteId, setSiteId] = useState(j?.site_id ?? '')
  const [siteNumber, setSiteNumber] = useState(j?.site_number ?? '')
  const [customerId, setCustomerId] = useState(j?.customer_id ?? '')
  const [gasBrand, setGasBrand] = useState(j?.gas_brand ?? '')

  // When a known site is picked, pre-fill the free-typed site number for display.
  const selectedSite = sites.find(s => s.id === siteId)

  // The brand — and so the customer — is dictated by the site number (7-Eleven
  // numbers are 7-Eleven, SU-#### is Sunoco, etc.), so re-derive it any time the
  // known site or the typed site number changes. Skip the very first run so
  // opening an existing job never overwrites a deliberately different customer
  // (e.g. AECOM managing a brand site) that was already saved.
  const hasMounted = useRef(false)
  useEffect(() => {
    if (!hasMounted.current) { hasMounted.current = true; return }
    const brand = selectedSite?.store_brand || classifySite(siteNumber).brand
    if (!brand) return
    const match = customers.find(c => c.brand && c.brand.toLowerCase() === brand.toLowerCase())
    // An explicit site → customer link beats a brand guess.
    if (selectedSite?.customer_id) setCustomerId(selectedSite.customer_id)
    else if (match) setCustomerId(match.id)
    setGasBrand(prev => prev || brand)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, siteNumber])

  return (
    <form action={formAction} className="space-y-6">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>
      )}

      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">Site &amp; Customer</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Known Site (optional)</label>
            <select name="site_id" className={inp} value={siteId} onChange={e => {
              const id = e.target.value
              setSiteId(id)
              const s = sites.find(x => x.id === id)
              if (s) setSiteNumber(s.site_number)
            }}>
              <option value="">— Not linked —</option>
              {sites.map(s => (
                <option key={s.id} value={s.id}>{s.site_number}{s.store_brand ? ` (${s.store_brand})` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={lbl}>Site Number / Label <span className="text-red-500">*</span></label>
            <input
              name="site_number"
              className={inp}
              placeholder="28960, SU-7415…"
              value={siteNumber}
              onChange={e => setSiteNumber(e.target.value)}
              required
            />
          </div>
          <div>
            <label className={lbl}>Customer</label>
            <select name="customer_id" className={inp} value={customerId} onChange={e => setCustomerId(e.target.value)}>
              <option value="">— No customer —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1">Filled in automatically from the site number — change it if this one's actually AECOM, a subcontractor, etc.</p>
          </div>
          <div>
            <label className={lbl}>Work Order #</label>
            <input name="work_order_number" className={inp} placeholder="WOT…, FWKD…, MG 450" defaultValue={j?.work_order_number ?? ''} />
          </div>
          <div>
            <label className={lbl}>Customer PO #</label>
            <input name="po_number" className={inp} placeholder="e.g. 24304" defaultValue={j?.po_number ?? ''} />
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>Facility Address</label>
            <input name="facility_address" className={inp} defaultValue={j?.facility_address ?? ''} />
          </div>
          <div>
            <label className={lbl}>Gas Brand</label>
            <input name="gas_brand" className={inp} placeholder="Sunoco, 7-Eleven…" value={gasBrand} onChange={e => setGasBrand(e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Program</label>
            <input name="program" className={inp} placeholder="Overspill Program, Dispenser Replacement…" defaultValue={j?.program ?? ''} />
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">Stage &amp; Priority</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={lbl}>Stage</label>
            <select name="stage" className={inp} defaultValue={j?.stage ?? 'survey'}>
              {CON_STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Priority</label>
            <select name="priority" className={inp} defaultValue={j?.priority ?? 'normal'}>
              {CON_PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Assigned Manager</label>
            <select name="assigned_manager_id" className={inp} defaultValue={j?.assigned_manager_id ?? ''}>
              <option value="">— Unassigned —</option>
              {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4">
          <label className={lbl}>Current Status (free text)</label>
          <input name="status_detail" className={inp} placeholder="e.g. Waiting on permit from county" defaultValue={j?.status_detail ?? ''} />
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">Scope &amp; Dates</h2>
        <div>
          <label className={lbl}>Scope of Work</label>
          <textarea name="scope_of_work" rows={3} className={inp} defaultValue={j?.scope_of_work ?? ''} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
          <div>
            <label className={lbl}>Date Received</label>
            <input type="date" name="date_received" className={inp} defaultValue={j?.date_received ?? ''} />
          </div>
          <div>
            <label className={lbl}>Project Start Date</label>
            <input type="date" name="project_start_date" className={inp} defaultValue={j?.project_start_date ?? ''} />
          </div>
          <div>
            <label className={lbl}>Response Time</label>
            <input name="response_time" className={inp} placeholder="e.g. 48 hrs" defaultValue={j?.response_time ?? ''} />
          </div>
        </div>
        <div className="mt-4">
          <label className={lbl}>Notes</label>
          <textarea name="notes" rows={2} className={inp} defaultValue={j?.notes ?? ''} />
        </div>
        <label className="mt-4 flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" name="master_sync_hold" defaultChecked={!!j?.master_sync_hold} className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
          <span>Keep the Master Schedule sync off this job <span className="text-gray-400">(it will not change the stage or close it, e.g. while our closeout is pending)</span></span>
        </label>
      </section>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={isPending}>{isPending ? 'Saving…' : j ? 'Save Changes' : 'Create Job'}</Button>
        <a href="/construction/jobs" className="text-sm text-gray-500 hover:text-gray-700">Cancel</a>
      </div>
    </form>
  )
}
