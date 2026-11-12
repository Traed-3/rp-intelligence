'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, Plus } from 'lucide-react'
import { RingLoader } from '@/components/ui/ring-loader'

// Add a deliverable to a site: a type, optional file, optional open-items note.
export function DeliverableUpload({ siteId }: { siteId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [type, setType] = useState('')
  const [openItems, setOpenItems] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function submit(file: File | null) {
    setError(null)
    if (!type && !file) { setError('Enter a type or choose a file.'); return }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('site_id', siteId)
      if (type) fd.append('type', type)
      if (openItems) fd.append('open_items', openItems)
      if (file) fd.append('file', file)
      const res = await fetch('/api/construction/permit-deliverables', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setType(''); setOpenItems('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const inp = 'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <input className={`${inp} flex-1 min-w-48`} placeholder="Deliverable type (e.g. Dispenser electrical drawing)" value={type} onChange={e => setType(e.target.value)} />
        <input className={`${inp} flex-1 min-w-48`} placeholder="Open items (optional)" value={openItems} onChange={e => setOpenItems(e.target.value)} />
      </div>
      <input ref={fileRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) submit(f); e.target.value = '' }} />
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50">
          {busy ? <><RingLoader /> Uploading…</> : <><Upload className="w-4 h-4" /> Upload file</>}
        </button>
        <button type="button" disabled={busy} onClick={() => submit(null)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
          <Plus className="w-4 h-4" /> Add note only
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
