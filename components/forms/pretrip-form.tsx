'use client'

import { useActionState, useState } from 'react'
import { SignaturePad } from '@/components/svc/signature-pad'
import { type Mark, type PretripRow, type PretripSection, MARKS, unitLabel } from '@/lib/pretrip'
import type { SubmitResult, EmailResult } from '@/app/(app)/forms/pre-trip/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-card disabled:bg-gray-50 disabled:text-gray-600'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'
const ON: Record<Mark, string> = {
  ok: 'bg-emerald-600 border-emerald-600 text-white',
  remark: 'bg-amber-500 border-amber-500 text-white',
  na: 'bg-gray-500 border-gray-500 text-white',
}

/** The whole sheet in one form: number, checklist (tap OK / Remark / N/A per line), remarks, date, checked by. */
export function PretripForm({ row, sections, units, locked, action }: {
  row: PretripRow; sections: PretripSection[]; units: string[]; locked: boolean
  action: (prev: SubmitResult | null, fd: FormData) => Promise<SubmitResult>
}) {
  const [marks, setMarks] = useState<Record<string, Mark>>(row.results ?? {})
  const [state, formAction, pending] = useActionState(action, null)
  const keys = sections.flatMap(s => s.items.map(i => i.key))
  const done = keys.filter(k => marks[k]).length
  const flagged = keys.filter(k => marks[k] === 'remark').length
  const set = (k: string, m: Mark) => setMarks(prev => { const next = { ...prev }; if (next[k] === m) delete next[k]; else next[k] = m; return next })
  const allOk = () => setMarks(prev => { const next = { ...prev }; for (const k of keys) if (!next[k]) next[k] = 'ok'; return next })

  return (
    <form action={formAction} className="space-y-4">
      {keys.map(k => marks[k] ? <input key={k} type="hidden" name={`r_${k}`} value={marks[k]} /> : null)}

      <div className="rp-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-amber-50/60">
        <div>
          <label className={lbl}>{unitLabel(row.kind)}</label>
          <input name="unit_number" list="pretrip-units" defaultValue={row.unit_number ?? ''} disabled={locked} autoComplete="off" placeholder={row.kind === 'trailer' ? 'T12' : 'ES'} className={inp} />
          <datalist id="pretrip-units">{units.map(u => <option key={u} value={u} />)}</datalist>
        </div>
        {row.kind === 'trailer' && (
          <div><label className={lbl}>Equipment</label><input name="equipment" defaultValue={row.equipment ?? ''} disabled={locked} placeholder="What is on the trailer" className={inp} /></div>
        )}
      </div>

      <div className="rp-card overflow-hidden">
        <div className="px-4 py-2.5 flex items-center justify-between gap-3 bg-foreground text-background">
          <span className="text-xs font-semibold uppercase tracking-wide">Checklist · {done} of {keys.length} marked{flagged ? ` · ${flagged} need${flagged === 1 ? 's' : ''} attention` : ''}</span>
          {!locked && done < keys.length && <button type="button" onClick={allOk} className="text-xs font-semibold px-2.5 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-600/90">Mark the rest OK</button>}
        </div>
        {sections.map((sec, si) => (
          <div key={si}>
            {(sec.lead || sec.tail) && <p className="px-4 py-2 text-sm bg-gray-50 border-y border-gray-100 text-gray-800"><b>{sec.lead}</b>{sec.tail}</p>}
            <ul className="divide-y divide-gray-100">
              {sec.items.map(it => {
                const m = marks[it.key]
                return (
                  <li key={it.key} className={`px-4 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 ${m === 'remark' ? 'bg-amber-50' : ''}`}>
                    <span className="flex-1 text-sm text-gray-800">{it.lead ? <b>{it.lead}</b> : null}{it.lead && it.text && !it.text.startsWith(',') ? ' ' : ''}{it.text}</span>
                    <span className="flex gap-1.5 shrink-0" role="group" aria-label={it.lead ?? it.text}>
                      {MARKS.map(o => (
                        <button key={o.value} type="button" disabled={locked} aria-pressed={m === o.value} onClick={() => set(it.key, o.value)}
                          className={`min-w-[4.25rem] px-2 py-2 rounded-lg border text-xs font-semibold transition-colors ${m === o.value ? ON[o.value] : 'bg-card border-gray-300 text-gray-600 hover:bg-gray-50'} disabled:cursor-default`}>
                          {o.label}
                        </button>
                      ))}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="rp-card p-4">
        <label className={lbl}>Remarks{flagged ? ' (say what needs attention on the lines marked Remark)' : ''}</label>
        <textarea name="remarks" rows={4} defaultValue={row.remarks ?? ''} disabled={locked} className={inp} />
      </div>

      <div className="rp-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-amber-50/60">
        <div><label className={lbl}>Date</label><input name="inspection_date" type="date" defaultValue={row.inspection_date} disabled={locked} className={inp} /></div>
        <div><label className={lbl}>Checked by</label><input name="checked_by" defaultValue={row.checked_by ?? ''} disabled={locked} className={inp} /></div>
      </div>

      {!locked && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button name="intent" value="save" disabled={pending} className="px-5 py-3 rounded-lg border border-gray-300 bg-card text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-60">Save</button>
            <button name="intent" value="finish" disabled={pending} className="px-5 py-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-600/90 disabled:opacity-60">{pending ? 'Saving…' : 'Finish inspection'}</button>
          </div>
          {state?.missing?.length ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-semibold mb-1">Saved. Fill these in to finish:</div>
              <ul className="list-disc ml-5">{state.missing.map(x => <li key={x}>{x}</li>)}</ul>
            </div>
          ) : null}
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.ok && !pending && <p className="text-sm text-emerald-700">Saved.</p>}
        </div>
      )}
    </form>
  )
}

/** Driver signature: reuses the service-ticket pad; "Re-sign" clears it while the inspection is still open. */
export function PretripSignature({ existing, signedLabel, locked, save }: { existing: string | null; signedLabel: string | null; locked: boolean; save: (dataUrl: string | null) => Promise<void> }) {
  return (
    <div className="space-y-2">
      <SignaturePad title="Signature (optional)" existingUrl={existing} signedLabel={signedLabel} disabled={locked}
        onSave={async url => { try { await save(url); return {} } catch (e) { return { error: e instanceof Error ? e.message : 'Could not save' } } }} />
      {existing && !locked && <button type="button" onClick={() => void save(null)} className="text-xs text-gray-500 underline">Re-sign</button>}
    </div>
  )
}

/** Email the PDF: only goes to the addresses typed here. */
export function PretripEmail({ action, sentTo }: { action: (prev: EmailResult | null, fd: FormData) => Promise<EmailResult>; sentTo: string | null }) {
  const [state, formAction, pending] = useActionState(action, null)
  return (
    <form action={formAction} className="space-y-2">
      <label className={lbl}>Email the PDF to (comma-separated)</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input name="send_to" type="text" inputMode="email" autoComplete="off" placeholder="name@example.com" className={inp} />
        <button disabled={pending} className="shrink-0 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-600/90 disabled:opacity-60">{pending ? 'Sending…' : 'Email PDF'}</button>
      </div>
      {state?.ok && <p className="text-sm text-emerald-700">Sent to {state.sentTo?.join(', ')}.</p>}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {!state && sentTo && <p className="text-xs text-gray-500">Last emailed to {sentTo}.</p>}
    </form>
  )
}
