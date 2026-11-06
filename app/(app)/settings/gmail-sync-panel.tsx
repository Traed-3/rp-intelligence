'use client'

import { useState } from 'react'
import { Mail, RefreshCw, History, CheckCircle, AlertCircle } from 'lucide-react'

export function GmailSyncPanel() {
  const [syncing, setSyncing]     = useState(false)
  const [result, setResult]       = useState<any>(null)
  const [error, setError]         = useState<string | null>(null)

  async function runSync(historical = false) {
    setSyncing(true)
    setResult(null)
    setError(null)
    try {
      const url = `/api/gmail/sync?secret=${encodeURIComponent(process.env.NEXT_PUBLIC_CRON_SECRET ?? 'rps-gmail-sync-2026')}${historical ? '&historical=true&max=500' : '&max=100'}`
      const res = await fetch(url)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-2">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2.5 rounded-lg bg-red-50 border border-red-100">
          <Mail className="w-5 h-5 text-red-600" />
        </div>
        <div>
          <p className="font-semibold text-gray-900">Gmail Sync</p>
          <p className="text-sm text-gray-500">maintenance.rps@gmail.com — auto-syncs every 15 minutes (Inbox + the last 3 days of archived mail)</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => runSync(false)}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Sync Now'}
        </button>

        <button
          onClick={() => runSync(true)}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
        >
          <History className="w-4 h-4" />
          Import History (2024+)
        </button>
      </div>

      {result && (
        <div className="mt-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span className="text-sm font-semibold text-green-800">Sync complete</span>
          </div>
          <div className="text-xs text-green-700 space-y-0.5">
            <p>✅ {result.created} new tickets created</p>
            <p>🔄 {result.updated} tickets updated</p>
            {result.review > 0 && <p>📥 {result.review} parked in Email Review (unmatched)</p>}
            <p>⏭️ {result.skipped} already up to date</p>
            <p className="text-green-500 mt-1">{result.timestamp ? new Date(result.timestamp).toLocaleString() : ''}</p>
            {result.errors?.length > 0 && (
              <p className="text-amber-700 mt-1">⚠️ {result.errors.length} error(s): {result.errors[0]}</p>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <span className="text-sm font-semibold text-red-800">Sync error</span>
          </div>
          <p className="text-xs text-red-700 mt-1">{error}</p>
          <p className="text-xs text-red-500 mt-1">Check that the Gmail refresh token is still valid (Settings → Gmail re-auth if needed).</p>
        </div>
      )}
    </div>
  )
}
