'use client'

import { useActionState, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { PartPicker, type PickedPart } from '@/components/construction/part-picker'
import { postInboxDocument, dismissDocument, reextractDocument, reopenDocument } from '@/app/(app)/inventory/inbox-actions'
import type { ActionState } from '@/app/(app)/inventory/actions'
import { money } from '@/lib/inventory'

const inp = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'

export type QueueLine = {
  part_number: string | null; description: string; qty: number | null; unit_cost: number | null; line_total?: number | null; backordered?: boolean
  part_id?: string | null; match?: string; match_part_number?: string | null; match_description?: string | null; catalog_cost?: number | null
}
type Row = { key: string; part_id: string | null; part_number: string | null; description: string; qty: string; unit_cost: string; include: boolean; create: boolean; match: string; label: string | null; catalog_cost: number | null; picking: boolean; pickText: string }

function toRows(lines: QueueLine[]): Row[] {
  return lines.map((l, i) => ({
    key: `l${i}`, part_id: l.part_id ?? null, part_number: l.part_number ?? null, description: l.description ?? '',
    qty: l.qty != null ? String(l.qty) : '', unit_cost: l.unit_cost != null ? String(l.unit_cost) : '',
    include: !l.backordered && (l.qty ?? 0) > 0, create: false, match: l.match ?? 'none',
    label: l.match_part_number ? `${l.match_part_number} · ${l.match_description ?? ''}` : l.match_description ?? null,
    catalog_cost: l.catalog_cost ?? null, picking: false, pickText: '',
  }))
}

export function InboxDocumentForm({ docId, status, kind, vendor, reference, documentDate, lines, locations, defaultLocation, canWrite, extractStatus, extractError }: {
  docId: string; status: string; kind: string; vendor: string | null; reference: string | null; documentDate: string | null; lines: QueueLine[]
  locations: { id: string; name: string }[]; defaultLocation?: string | null; canWrite: boolean; extractStatus: string; extractError: string | null
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(lines))
  const [mode, setMode] = useState<'receive' | 'cost_only'>(kind === 'vendor_quote' ? 'cost_only' : 'receive')
  const [state, action, pending] = useActionState(postInboxDocument.bind(null, docId), {} as ActionState)
  const [dismissState, dismissAction, dismissing] = useActionState(dismissDocument.bind(null, docId), {} as ActionState)
  const [busy, startTransition] = useTransition()
  const [rereadMsg, setRereadMsg] = useState<string | null>(null)

  const upd = (key: string, patch: Partial<Row>) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r))
  const addRow = () => setRows(rs => [...rs, { key: `n${Date.now()}`, part_id: null, part_number: null, description: '', qty: '1', unit_cost: '', include: true, create: false, match: 'none', label: null, catalog_cost: null, picking: true, pickText: '' }])
  const payload = rows.map(r => ({ part_id: r.part_id, part_number: r.part_number, description: r.description, qty: Number(r.qty) || 0, unit_cost: r.unit_cost !== '' ? Number(r.unit_cost) : null, include: r.include, create: r.create }))
  const ticked = rows.filter(r => r.include && Number(r.qty) > 0)
  const needsPart = ticked.filter(r => !r.part_id && !r.create).length

  if (status !== 'new') {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 flex flex-wrap items-center gap-3">
        <span>This document is <b>{status.replace('_', ' ')}</b>.</span>
        {canWrite && status === 'dismissed' && <button type="button" disabled={busy} onClick={() => startTransition(async () => { await reopenDocument(docId) })} className="text-blue-600 underline disabled:opacity-50">Reopen</button>}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {extractStatus !== 'done' && (
        <div className={`rounded-xl border px-4 py-3 text-sm flex flex-wrap items-center gap-3 ${extractStatus === 'failed' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <span>{extractStatus === 'pending' ? 'Not read yet — the next sync will read it, or read it now.' : extractStatus === 'failed' ? `Reading failed: ${extractError ?? 'unknown error'}` : extractError ?? 'Could not be read automatically. Enter the lines below by hand.'}</span>
          {canWrite && extractStatus !== 'skipped' && <button type="button" disabled={busy} onClick={() => startTransition(async () => { setRereadMsg(null); const r = await reextractDocument(docId); setRereadMsg(r.ok ? 'Read. Refresh the page to see the lines.' : r.error ?? 'Failed') })} className="underline disabled:opacity-50">{busy ? 'Reading…' : 'Read it now'}</button>}
          {rereadMsg && <span className="text-xs">{rereadMsg}</span>}
        </div>
      )}

      <form action={action} className="rp-card">
        <input type="hidden" name="lines" value={JSON.stringify(payload)} />
        <input type="hidden" name="mode" value={mode} />
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <h2 className="font-semibold text-gray-900">Lines on the paperwork</h2>
          <span className="text-xs text-gray-400">{ticked.length} ticked{needsPart ? ` · ${needsPart} need a catalog part` : ''}</span>
          {canWrite && <button type="button" onClick={addRow} className="ml-auto text-sm text-blue-600 hover:text-blue-800">+ Add a line</button>}
        </div>

        <div className="overflow-x-auto">
          <table className="rp-table w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-500 text-xs"><th className="px-3 py-2" /><th className="text-left px-3 py-2">On the document</th><th className="text-left px-3 py-2">Catalog part</th><th className="text-right px-3 py-2">Qty</th><th className="text-right px-3 py-2">Unit cost</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No lines yet. Add them by hand.</td></tr>}
              {rows.map(r => {
                const cost = r.unit_cost !== '' ? Number(r.unit_cost) : null
                const jump = cost != null && r.catalog_cost != null && r.catalog_cost > 0 ? (cost - r.catalog_cost) / r.catalog_cost : null
                return (
                  <tr key={r.key} className={r.include ? '' : 'opacity-50'}>
                    <td className="px-3 py-2 align-top"><input type="checkbox" checked={r.include} onChange={e => upd(r.key, { include: e.target.checked })} aria-label="Include line" className="mt-1.5" /></td>
                    <td className="px-3 py-2 align-top min-w-[220px]">
                      <input value={r.description} onChange={e => upd(r.key, { description: e.target.value })} className={inp} placeholder="Description" aria-label="Description" />
                      <input value={r.part_number ?? ''} onChange={e => upd(r.key, { part_number: e.target.value || null })} className={`${inp} mt-1 font-mono text-xs`} placeholder="part # as printed" aria-label="Part number on document" />
                    </td>
                    <td className="px-3 py-2 align-top min-w-[240px]">
                      {r.picking ? (
                        <PartPicker value={r.pickText} onChange={t => upd(r.key, { pickText: t })} onPick={(p: PickedPart) => upd(r.key, { part_id: p.id, label: `${p.part_number ?? ''} · ${p.description}`, catalog_cost: p.unit_cost ?? null, picking: false, pickText: '', create: false, match: 'exact' })} className={inp} placeholder="Search the catalog…" />
                      ) : r.part_id ? (
                        <div>
                          <div className="text-gray-900 text-xs leading-snug">{r.label}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{r.match === 'fuzzy' ? <span className="text-amber-700">closest match — check it</span> : 'matched'}{r.catalog_cost != null ? ` · on file ${money(r.catalog_cost)}` : ''}{canWrite && <> · <button type="button" onClick={() => upd(r.key, { picking: true })} className="text-blue-600">change</button></>}</div>
                        </div>
                      ) : (
                        <div className="text-xs">
                          <span className="text-red-600">not in catalog</span>
                          {canWrite && <> · <button type="button" onClick={() => upd(r.key, { picking: true })} className="text-blue-600">pick a part</button></>}
                          <label className="flex items-center gap-1.5 mt-1 text-gray-600"><input type="checkbox" checked={r.create} onChange={e => upd(r.key, { create: e.target.checked })} />create it as a new part</label>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top"><input value={r.qty} onChange={e => upd(r.key, { qty: e.target.value })} type="number" step="any" inputMode="decimal" className={`${inp} w-20 text-right`} aria-label="Quantity" /></td>
                    <td className="px-3 py-2 align-top">
                      <input value={r.unit_cost} onChange={e => upd(r.key, { unit_cost: e.target.value })} type="number" step="any" inputMode="decimal" className={`${inp} w-24 text-right`} placeholder="—" aria-label="Unit cost" />
                      {jump != null && Math.abs(jump) >= 0.15 && <div className={`text-[11px] mt-0.5 text-right ${jump > 0 ? 'text-red-600' : 'text-green-700'}`}>{jump > 0 ? '+' : ''}{Math.round(jump * 100)}% vs on file</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 space-y-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="mode_pick" checked={mode === 'receive'} onChange={() => setMode('receive')} />Put into stock</label>
            <label className="flex items-center gap-2"><input type="radio" name="mode_pick" checked={mode === 'cost_only'} onChange={() => setMode('cost_only')} />Cost update only <span className="text-gray-400">(parts went straight to a job)</span></label>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {mode === 'receive' && (
              <div className="col-span-2"><label className={lbl} htmlFor="q-loc">Put on</label>
                <select id="q-loc" name="location_id" className={inp} defaultValue={defaultLocation ?? ''} required><option value="">— shelf or truck —</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
            )}
            <div><label className={lbl} htmlFor="q-vendor">Vendor</label><input id="q-vendor" name="vendor" defaultValue={vendor ?? ''} className={inp} /></div>
            <div><label className={lbl} htmlFor="q-ref">Document #</label><input id="q-ref" name="reference" defaultValue={reference ?? ''} className={inp} /></div>
            <div><label className={lbl} htmlFor="q-date">Document date</label><input id="q-date" name="document_date" type="date" defaultValue={documentDate ?? ''} className={inp} /></div>
            <div className={mode === 'receive' ? 'col-span-2 md:col-span-1' : 'col-span-2 md:col-span-1'}><label className={lbl} htmlFor="q-note">Note</label><input id="q-note" name="note" className={inp} placeholder="for SU-5015" /></div>
          </div>
          {state?.error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>}
          {state?.ok && <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">Posted.</div>}
          {canWrite && <Button type="submit" disabled={pending || ticked.length === 0}>{pending ? 'Posting…' : mode === 'receive' ? `Receive ${ticked.length} line${ticked.length === 1 ? '' : 's'} into stock` : `Update costs on ${ticked.length} line${ticked.length === 1 ? '' : 's'}`}</Button>}
        </div>
      </form>

      {canWrite && (
        <form action={dismissAction} className="flex flex-wrap items-center gap-2 text-sm">
          <input name="note" placeholder="Why it's being dismissed (duplicate, not ours, already keyed in)…" className={`${inp} max-w-md`} aria-label="Dismiss note" />
          <Button type="submit" variant="outline" disabled={dismissing}>{dismissing ? '…' : 'Dismiss'}</Button>
          {dismissState?.error && <span className="text-red-600">{dismissState.error}</span>}
        </form>
      )}
    </div>
  )
}
