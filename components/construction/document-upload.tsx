'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'
import { RingLoader } from '@/components/ui/ring-loader'
import { CON_DOC_CATEGORIES } from '@/lib/construction'

/** Upload a file to the private construction-docs bucket for a job/quote/invoice. */
export function DocumentUpload({
  jobId,
  quoteId,
  invoiceId,
}: {
  jobId?: string
  quoteId?: string
  invoiceId?: string
}) {
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (jobId) fd.append('job_id', jobId)
      if (quoteId) fd.append('quote_id', quoteId)
      if (invoiceId) fd.append('invoice_id', invoiceId)
      if (category) fd.append('category', category)
      const res = await fetch('/api/construction/documents', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      router.refresh()
    } catch (e: any) {
      setError(e.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
        className="hidden"
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="px-2.5 py-2 text-sm border border-gray-300 rounded-lg bg-card"
      >
        <option value="">Category… (auto-detect)</option>
        {CON_DOC_CATEGORIES.map(c => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-50"
      >
        {uploading ? <><RingLoader /> Uploading…</> : <><Upload className="w-4 h-4" /> Upload Document</>}
      </button>
      {error && <p className="text-xs text-red-600 w-full">{error}</p>}
    </div>
  )
}
