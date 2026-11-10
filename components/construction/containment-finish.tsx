'use client'

import { useActionState } from 'react'
import { SignaturePad } from '@/components/svc/signature-pad'
import type { FinishResult } from '@/app/(app)/construction/surveys/tests/actions'

/** Tester signature: reuses the service-ticket pad; "Re-sign" clears it while the test is still a draft. */
export function TestSignature({ existing, signedLabel, locked, save }: { existing: string | null; signedLabel: string | null; locked: boolean; save: (dataUrl: string | null) => Promise<void> }) {
  return (
    <div className="space-y-2">
      <SignaturePad title="Tester signature" existingUrl={existing} signedLabel={signedLabel} disabled={locked}
        onSave={async url => { try { await save(url); return {} } catch (e) { return { error: e instanceof Error ? e.message : 'Could not save' } } }} />
      {existing && !locked && <button type="button" onClick={() => void save(null)} className="text-xs text-gray-500 underline">Re-sign</button>}
    </div>
  )
}

/** Finish box: who gets the PDF, then one button. Shows what's still missing instead of failing silently. */
export function FinishBox({ action, defaultTo, agency }: { action: (prev: FinishResult | null, fd: FormData) => Promise<FinishResult>; defaultTo: string; agency: string }) {
  const [state, formAction, pending] = useActionState(action, null)
  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Email the PDF to (comma-separated)</label>
        <input name="send_to" defaultValue={defaultTo} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
      </div>
      <button disabled={pending} className="w-full sm:w-auto px-5 py-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60">
        {pending ? 'Building the PDF…' : `Finish → ${agency} PDF + email`}
      </button>
      {state?.missing?.length ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-semibold mb-1">Fill these in first:</div>
          <ul className="list-disc ml-5">{state.missing.map(m => <li key={m}>{m}</li>)}</ul>
        </div>
      ) : null}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && state.emailError && <p className="text-sm text-amber-700">PDF is built and filed, but the email did not go: {state.emailError}</p>}
    </form>
  )
}
