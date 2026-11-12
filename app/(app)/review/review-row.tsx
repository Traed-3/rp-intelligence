'use client'

import { useState, useTransition } from 'react'
import { Check, Plus, X, Wand2 } from 'lucide-react'

type Imp = {
  id: string
  subject: string
  sender: string
  receivedAt: string | null
  bodyPreview: string
  detectedAsset: string
}
type Suggestion = { id: string; unit_number: string; score: number; reason: string }
type AssetLite = { id: string; unit_number: string }
type AssetType = { id: string; name: string }

export function ReviewRow({
  imp,
  suggestions,
  assets,
  assetTypes,
  onAssign,
  onCreate,
  onReject,
}: {
  imp: Imp
  suggestions: Suggestion[]
  assets: AssetLite[]
  assetTypes: AssetType[]
  onAssign: (importId: string, assetId: string) => Promise<void>
  onCreate: (importId: string, unitNumber: string, assetTypeId: string) => Promise<void>
  onReject: (importId: string) => Promise<void>
}) {
  const [isPending, startTransition] = useTransition()
  const [selectedAsset, setSelectedAsset] = useState<string>(suggestions[0]?.id ?? '')
  const [showCreate, setShowCreate] = useState(false)
  const [newUnit, setNewUnit] = useState(imp.detectedAsset)
  const [newType, setNewType] = useState<string>(assetTypes[0]?.id ?? '')

  const date = imp.receivedAt
    ? new Date(imp.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : ''

  function run(fn: () => Promise<void>) {
    startTransition(async () => { await fn() })
  }

  return (
    <div className="rp-card p-5">
      {/* Email summary */}
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-100">
          Unmatched: {imp.detectedAsset || '—'}
        </span>
        {date && <span className="text-xs text-gray-400">{date}</span>}
        {imp.sender && <span className="text-xs text-gray-400">· {imp.sender}</span>}
      </div>
      <p className="font-semibold text-gray-900">{imp.subject || '(no subject)'}</p>
      {imp.bodyPreview && (
        <p className="text-sm text-gray-500 mt-1 line-clamp-3 whitespace-pre-wrap">{imp.bodyPreview}</p>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-gray-500 mb-1.5 flex items-center gap-1">
            <Wand2 className="w-3.5 h-3.5 text-indigo-500" /> Suggested matches
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => run(() => onAssign(imp.id, s.id))}
                disabled={isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 transition-colors"
                title={`${s.reason} (${s.score})`}
              >
                <Check className="w-3.5 h-3.5" />
                {s.unit_number}
                <span className="text-[10px] text-indigo-400">{s.reason}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Manual controls */}
      <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-end gap-3">
        {/* Pick any asset */}
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Or pick an asset</label>
            <select
              value={selectedAsset}
              onChange={(e) => setSelectedAsset(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 min-w-[140px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>{a.unit_number}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => selectedAsset && run(() => onAssign(imp.id, selectedAsset))}
            disabled={isPending || !selectedAsset}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            Assign
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setShowCreate((v) => !v)}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <Plus className="w-4 h-4" /> New asset
          </button>
          <button
            onClick={() => run(() => onReject(imp.id))}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <X className="w-4 h-4" /> Dismiss
          </button>
        </div>
      </div>

      {/* Create-new-asset panel */}
      {showCreate && (
        <div className="mt-3 p-3 rounded-lg bg-gray-50 border border-gray-200 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Unit #</label>
            <input
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 w-28 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Type</label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {assetTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => newUnit.trim() && run(() => onCreate(imp.id, newUnit, newType))}
            disabled={isPending || !newUnit.trim()}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-600/90 disabled:opacity-50 transition-colors"
          >
            Create &amp; open ticket
          </button>
        </div>
      )}
    </div>
  )
}
