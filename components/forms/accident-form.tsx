'use client'

import { useActionState, useState, useTransition } from 'react'
import { Camera, Trash2 } from 'lucide-react'
import { SignaturePad } from '@/components/svc/signature-pad'
import { type AccidentRow, type AccidentPhoto, type AccidentField, ACCIDENT_SECTIONS, MAX_PHOTOS, isShown } from '@/lib/accident'
import type { SubmitResult, EmailResult } from '@/app/(app)/forms/accident/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-card disabled:bg-gray-50 disabled:text-gray-600'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'

/** The whole report in one form. Yes / No questions open their follow-up questions; a No hides (and clears) them. */
export function AccidentForm({ row, units, locked, action }: {
  row: AccidentRow; units: string[]; locked: boolean
  action: (prev: SubmitResult | null, fd: FormData) => Promise<SubmitResult>
}) {
  const [yn, setYn] = useState<Record<string, boolean | null>>(() => {
    const init: Record<string, boolean | null> = {}
    for (const s of ACCIDENT_SECTIONS) for (const f of s.fields) if (f.type === 'yesno') init[f.key] = typeof row[f.key] === 'boolean' ? (row[f.key] as boolean) : null
    return init
  })
  const [state, formAction, pending] = useActionState(action, null)

  const field = (f: AccidentField) => {
    const star = f.required ? <span className="text-red-600"> *</span> : null
    if (f.type === 'yesno') {
      const v = yn[f.key]
      return (
        <div key={f.key} className="sm:col-span-2 flex flex-col sm:flex-row sm:items-center gap-2">
          <span className="flex-1 text-sm font-medium text-gray-800">{f.label}{star}</span>
          <span className="flex gap-1.5 shrink-0" role="group" aria-label={f.label}>
            {([['Yes', true], ['No', false]] as const).map(([text, val]) => (
              <button key={text} type="button" disabled={locked} aria-pressed={v === val} onClick={() => setYn(prev => ({ ...prev, [f.key]: prev[f.key] === val ? null : val }))}
                className={`min-w-[4.5rem] px-3 py-2 rounded-lg border text-sm font-semibold transition-colors ${v === val ? (val ? 'bg-amber-500 border-amber-500 text-white' : 'bg-gray-600 border-gray-600 text-white') : 'bg-card border-gray-300 text-gray-600 hover:bg-gray-50'} disabled:cursor-default`}>
                {text}
              </button>
            ))}
          </span>
          {v !== null && <input type="hidden" name={f.key} value={v ? 'yes' : 'no'} />}
        </div>
      )
    }
    const value = (row[f.key] as string | null) ?? ''
    const common = { name: f.key, defaultValue: value, disabled: locked, className: inp }
    return (
      <div key={f.key} className={f.wide || f.type === 'textarea' ? 'sm:col-span-2' : ''}>
        <label className={lbl}>{f.label}{star}</label>
        {f.type === 'textarea'
          ? <textarea {...common} rows={f.key === 'description' ? 6 : 3} placeholder={f.hint} />
          : f.key === 'unit_number'
            ? <><input {...common} list="accident-units" autoComplete="off" placeholder="NN14" /><datalist id="accident-units">{units.map(u => <option key={u} value={u} />)}</datalist></>
            : <input {...common} type={f.type} inputMode={f.type === 'tel' ? 'tel' : undefined} autoComplete="off" placeholder={f.type === 'text' ? f.hint : undefined} />}
        {f.hint && f.type !== 'textarea' && f.key === 'unit_number' && <p className="text-[11px] text-gray-500 mt-1">{f.hint}</p>}
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      {ACCIDENT_SECTIONS.map(sec => (
        <div key={sec.title} className="rp-card overflow-hidden">
          <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide bg-foreground text-background">{sec.title}</div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {sec.fields.filter(f => isShown(f, yn)).map(field)}
          </div>
        </div>
      ))}

      {!locked && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button name="intent" value="save" disabled={pending} className="px-5 py-3 rounded-lg border border-gray-300 bg-card text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-60">Save</button>
            <button name="intent" value="finish" disabled={pending} className="px-5 py-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-600/90 disabled:opacity-60">{pending ? 'Saving…' : 'Submit report'}</button>
          </div>
          {state?.missing?.length ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-semibold mb-1">Saved. Fill these in to submit:</div>
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

/** Shrinks a phone photo in the browser (long side 1600 px, JPEG) so several upload quickly on a weak signal. */
async function shrink(file: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.8))
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file
  } catch { return file }
}

/** Photos of the vehicles, the damage, the other driver's plate and insurance card, and the scene. */
export function AccidentPhotos({ reportId, photos, locked, add, remove }: {
  reportId: string; photos: AccidentPhoto[]; locked: boolean
  add: (fd: FormData) => Promise<{ error?: string }>
  remove: (path: string) => Promise<void>
}) {
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const upload = (list: FileList | null) => {
    const files = Array.from(list ?? [])
    if (!files.length) return
    setError(null)
    start(async () => {
      // One at a time keeps each upload small.
      for (const f of files) {
        const fd = new FormData()
        fd.append('photos', await shrink(f))
        const res = await add(fd)
        if (res.error) { setError(res.error); break }
      }
    })
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-800">Photos · {photos.length}</span>
        {busy && <span className="text-xs text-gray-500">Uploading…</span>}
      </div>
      {!locked && <p className="text-xs text-gray-500">Every vehicle from all four sides, close-ups of the damage, the other driver’s license plate and insurance card, and the scene.</p>}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {photos.map((ph, i) => (
            <div key={ph.path} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- private photo behind a signed redirect */}
              <a href={`/forms/accident/${reportId}/photo/${i}`} target="_blank" rel="noopener"><img src={`/forms/accident/${reportId}/photo/${i}`} alt={`Accident photo ${i + 1}`} className="w-full aspect-square object-cover rounded-lg border border-gray-200" loading="lazy" /></a>
              {!locked && <button type="button" disabled={busy} onClick={() => { if (confirm('Delete this photo?')) start(() => remove(ph.path)) }} className="absolute top-1 right-1 bg-card/90 rounded-full p-1.5 text-gray-600 hover:text-red-600" title="Delete photo"><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
          ))}
        </div>
      )}
      {!locked && photos.length < MAX_PHOTOS && (
        <div className="flex gap-2">
          <label className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-semibold cursor-pointer hover:bg-primary/90"><Camera className="w-4 h-4" /> Take photo<input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} onChange={ev => { upload(ev.currentTarget.files); ev.currentTarget.value = '' }} /></label>
          <label className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-card px-4 py-2.5 text-sm cursor-pointer hover:bg-gray-50">From roll<input type="file" accept="image/*" multiple className="hidden" disabled={busy} onChange={ev => { upload(ev.currentTarget.files); ev.currentTarget.value = '' }} /></label>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}

/** Employee signature: reuses the service-ticket pad; "Re-sign" clears it while the report is still open. */
export function AccidentSignature({ existing, signedLabel, locked, save }: { existing: string | null; signedLabel: string | null; locked: boolean; save: (dataUrl: string | null) => Promise<void> }) {
  return (
    <div className="space-y-2">
      <SignaturePad title="Employee signature" existingUrl={existing} signedLabel={signedLabel} disabled={locked}
        onSave={async url => { try { await save(url); return {} } catch (e) { return { error: e instanceof Error ? e.message : 'Could not save' } } }} />
      <p className="text-xs text-gray-500">I certify that the information in this report is true and complete to the best of my knowledge.</p>
      {existing && !locked && <button type="button" onClick={() => void save(null)} className="text-xs text-gray-500 underline">Re-sign</button>}
    </div>
  )
}

/** Send the PDF again, or to someone else (insurance agent). Starts with the office list when the automatic email did not go. */
export function AccidentEmail({ action, defaultTo }: { action: (prev: EmailResult | null, fd: FormData) => Promise<EmailResult>; defaultTo: string }) {
  const [state, formAction, pending] = useActionState(action, null)
  return (
    <form action={formAction} className="space-y-2">
      <label className={lbl}>Send the PDF again, or to someone else (comma-separated)</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input name="send_to" type="text" inputMode="email" autoComplete="off" placeholder="name@example.com" defaultValue={defaultTo} className={inp} />
        <button disabled={pending} className="shrink-0 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-600/90 disabled:opacity-60">{pending ? 'Sending…' : 'Email PDF'}</button>
      </div>
      {state?.ok && <p className="text-sm text-emerald-700">Sent to {state.sentTo?.join(', ')}.</p>}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      
    </form>
  )
}
