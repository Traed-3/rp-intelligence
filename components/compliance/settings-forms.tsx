'use client'

import { useActionState, useState, useTransition } from 'react'
import { APPLIES_TO, CATEGORIES, CERT_KINDS, type ComplianceSettings, type RequirementType } from '@/lib/compliance'
import { saveSettings, saveRequirementType, sendTest, previewCheck, type ActionState } from '@/app/(app)/compliance/actions'
import type { CheckResult } from '@/lib/compliance-notices'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'
const hint = 'text-[11px] text-gray-400 mt-1'
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function Status({ s }: { s: ActionState }) {
  if (s.error) return <p className="text-sm text-red-600">{s.error}</p>
  if (s.message) return <p className="text-sm text-green-700">{s.message}</p>
  return null
}

export function NoticeSettingsForm({ settings, canWrite }: { settings: ComplianceSettings; canWrite: boolean }) {
  const [state, action, pending] = useActionState(saveSettings, {} as ActionState)
  const s = settings
  return (
    <form action={action} className="space-y-5">
      <label className={`flex items-start gap-3 rounded-xl border p-3 ${s.emails_enabled ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
        <input type="checkbox" name="emails_enabled" defaultChecked={s.emails_enabled} disabled={!canWrite} className="w-5 h-5 mt-0.5" />
        <span>
          <span className="block text-sm font-semibold text-gray-900">Send automatic expiry emails</span>
          <span className="block text-xs text-gray-600">The check runs every morning at 7am ET. While this is off nothing is emailed — use “Preview” below to see what would go out.</span>
        </span>
      </label>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>DQF / DOT card notices — days before expiry</label>
          <input name="dqf_notice_days" defaultValue={s.dqf_notice_days.join(', ')} disabled={!canWrite} className={inp} />
          <p className={hint}>Medical (DOT physical) card, driver license, annual MVR &amp; review, Clearinghouse. e.g. 60, 30, 14, 7</p>
        </div>
        <div>
          <label className={lbl}>Certification notices — days before expiry</label>
          <input name="cert_notice_days" defaultValue={s.cert_notice_days.join(', ')} disabled={!canWrite} className={inp} />
          <p className={hint}>MDE, OPW, NOV, API, OSHA, CPR, equipment cards… Individual types can override this below.</p>
        </div>
        <div>
          <label className={lbl}>After it expires, repeat the notice every (days)</label>
          <input name="overdue_repeat_days" type="number" min={1} max={60} defaultValue={s.overdue_repeat_days} disabled={!canWrite} className={inp} />
        </div>
        <div className="flex items-end">
          <label className="inline-flex items-center gap-2 text-sm text-gray-800 pb-2"><input type="checkbox" name="notify_employee" defaultChecked={s.notify_employee} disabled={!canWrite} className="w-4 h-4" />Email technicians, drivers &amp; staff their own reminders</label>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <label className={lbl}>Management — every notice</label>
          <textarea name="management_emails" rows={3} defaultValue={s.management_emails.join('\n')} disabled={!canWrite} placeholder="one email per line" className={inp} />
        </div>
        <div>
          <label className={lbl}>DQF / DOT notices only</label>
          <textarea name="dqf_management_emails" rows={3} defaultValue={s.dqf_management_emails.join('\n')} disabled={!canWrite} placeholder="e.g. safety / fleet manager" className={inp} />
        </div>
        <div>
          <label className={lbl}>Certification notices only</label>
          <textarea name="cert_management_emails" rows={3} defaultValue={s.cert_management_emails.join('\n')} disabled={!canWrite} placeholder="e.g. construction & service managers" className={inp} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-gray-800"><input type="checkbox" name="weekly_digest" defaultChecked={s.weekly_digest} disabled={!canWrite} className="w-4 h-4" />Weekly roll-up to management (everything expired, expiring, and missing driver paperwork) every</label>
        <select name="digest_weekday" defaultValue={s.digest_weekday} disabled={!canWrite} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
      </div>

      {canWrite && (
        <div className="flex items-center gap-3">
          <button disabled={pending} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">{pending ? 'Saving…' : 'Save settings'}</button>
          <Status s={state} />
        </div>
      )}
    </form>
  )
}

export function PreviewAndTest({ canWrite }: { canWrite: boolean }) {
  const [result, setResult] = useState<CheckResult | { error: string } | null>(null)
  const [loading, start] = useTransition()
  const [testState, testAction, testing] = useActionState(sendTest, {} as ActionState)
  return (
    <div className="space-y-4">
      <div>
        <button type="button" disabled={loading} onClick={() => start(async () => setResult(await previewCheck()))}
          className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:border-blue-300 disabled:opacity-50">
          {loading ? 'Checking…' : 'Preview what tomorrow’s check would send'}
        </button>
        {result && 'error' in result && <p className="text-sm text-red-600 mt-2">{result.error}</p>}
        {result && !('error' in result) && (
          <div className="mt-3 text-sm">
            <p className="text-gray-700 mb-2"><b>{result.notices}</b> notice{result.notices === 1 ? '' : 's'} due · <b>{result.emails.length}</b> email{result.emails.length === 1 ? '' : 's'}{result.digest ? ' (incl. weekly roll-up)' : ''}{!result.emailsEnabled && ' — not sent while emails are off'}</p>
            {result.emails.length > 0 && (
              <ul className="max-h-64 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-200">
                {result.emails.map((e, i) => (
                  <li key={i} className="px-3 py-2 flex flex-wrap gap-x-3 text-xs">
                    <span className="font-semibold text-gray-900">{e.to}</span>
                    <span className="text-gray-500">{e.kind}</span>
                    <span className="text-gray-700">{e.subject}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {canWrite && (
        <form action={testAction} className="flex flex-wrap items-center gap-2">
          <input name="to" type="email" placeholder="your@email.com" className="rounded-lg border border-gray-300 px-3 py-2 text-sm w-64" />
          <button disabled={testing} className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:border-blue-300 disabled:opacity-50">{testing ? 'Sending…' : 'Send a test email'}</button>
          <Status s={testState} />
        </form>
      )}
    </div>
  )
}

export function RequirementTypeForm({ type, canWrite, onDone }: { type?: RequirementType; canWrite: boolean; onDone?: () => void }) {
  const [state, action, pending] = useActionState(async (p: ActionState, fd: FormData) => {
    const r = await saveRequirementType(p, fd)
    if (r.ok && onDone) onDone()
    return r
  }, {} as ActionState)
  const t = type
  return (
    <form action={action} className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="col-span-2"><label className={lbl}>Name</label><input name="name" defaultValue={t?.name ?? ''} required disabled={!canWrite} className={inp} /></div>
      <div>
        <label className={lbl}>Side</label>
        <select name="category" defaultValue={t?.category ?? 'certification'} disabled={!canWrite} className={inp}>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      <div>
        <label className={lbl}>Group</label>
        <select name="kind" defaultValue={t?.kind ?? ''} disabled={!canWrite} className={inp}>
          <option value="">—</option>
          {CERT_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>
      <div className="col-span-2"><label className={lbl}>Issuer / jurisdiction</label><input name="issuer" defaultValue={t?.issuer ?? ''} disabled={!canWrite} className={inp} /></div>
      <div className="col-span-2">
        <label className={lbl}>Who needs it</label>
        <select name="applies_to" defaultValue={t?.applies_to ?? 'optional'} disabled={!canWrite} className={inp}>
          {APPLIES_TO.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      </div>
      <div><label className={lbl}>Valid for (months)</label><input name="renewal_months" type="number" min={1} defaultValue={t?.renewal_months ?? ''} disabled={!canWrite} className={inp} /></div>
      <div><label className={lbl}>Notice days override</label><input name="notice_days" defaultValue={t?.notice_days?.join(', ') ?? ''} placeholder="default" disabled={!canWrite} className={inp} /></div>
      <div className="col-span-2"><label className={lbl}>Regulation / note</label><input name="regulation" defaultValue={t?.regulation ?? ''} disabled={!canWrite} className={inp} /></div>
      <input type="hidden" name="description" value={t?.description ?? ''} />
      <div className="col-span-2 md:col-span-6 flex flex-wrap items-center gap-4">
        <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" name="expires" defaultChecked={t?.expires ?? true} disabled={!canWrite} className="w-4 h-4" />Expires</label>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" name="notify" defaultChecked={t?.notify ?? t?.category === 'dqf'} disabled={!canWrite} className="w-4 h-4" />Send expiry emails</label>
        {t && <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" name="retired" defaultChecked={!t.is_active} disabled={!canWrite} className="w-4 h-4" />Retired (hide)</label>}
        {canWrite && <button disabled={pending} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50">{pending ? 'Saving…' : t ? 'Save' : 'Add requirement'}</button>}
        <Status s={state} />
      </div>
    </form>
  )
}

export function RequirementTypeList({ types, canWrite }: { types: RequirementType[]; canWrite: boolean }) {
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <div className="divide-y divide-gray-100">
      {CATEGORIES.map(c => (
        <div key={c.value}>
          <p className="px-4 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{c.label}</p>
          {types.filter(t => t.category === c.value).map(t => (
            <div key={t.id} className={`px-4 py-2 ${t.is_active ? '' : 'opacity-50'}`}>
              {editing === t.id ? (
                <RequirementTypeForm type={t} canWrite={canWrite} onDone={() => setEditing(null)} />
              ) : (
                <button type="button" onClick={() => canWrite && setEditing(t.id)} className="w-full text-left flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className="text-sm font-medium text-gray-900">{t.name}</span>
                  <span className="text-xs text-gray-500">{[t.issuer, APPLIES_TO.find(a => a.value === t.applies_to)?.label, t.expires ? (t.renewal_months ? `valid ${t.renewal_months} mo` : 'expires') : 'no expiry', t.notice_days?.length ? `notices ${t.notice_days.join('/')}d` : null, t.expires && !t.notify ? 'no emails' : null, t.is_active ? null : 'retired'].filter(Boolean).join(' · ')}</span>
                  {canWrite && <span className="ml-auto text-xs text-blue-600">Edit</span>}
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
