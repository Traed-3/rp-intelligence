'use client'

import { useState, useTransition } from 'react'
import { FileText, Check } from 'lucide-react'
import { CON_DOC_CATEGORIES, docTypeLabel } from '@/lib/construction'
import { fileDocument } from '@/app/(app)/construction/actions'

type ReviewDoc = {
  id: string
  file_name: string | null
  category: string | null
  doc_type: string | null
  source_path: string | null
  jobLabel: string | null
}

/** One row in the "Needs Review" queue: open the file, pick a category, File it. */
export function ReviewRow({ doc }: { doc: ReviewDoc }) {
  const [category, setCategory] = useState(doc.category ?? 'other')
  const [pending, start] = useTransition()

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <FileText className="w-4 h-4 text-gray-400 shrink-0" />
      <a
        href={`/api/construction/documents/${doc.id}`}
        target="_blank"
        rel="noopener"
        className="flex-1 min-w-[12rem] text-sm font-medium text-blue-600 hover:text-blue-800 truncate"
      >
        {doc.file_name ?? 'Untitled file'}
      </a>
      {doc.jobLabel && <span className="text-xs text-gray-500 shrink-0">{doc.jobLabel}</span>}
      {docTypeLabel(doc.doc_type) && (
        <span className="text-xs text-gray-400 shrink-0">guess: {docTypeLabel(doc.doc_type)}</span>
      )}
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        disabled={pending}
        className="px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-card"
      >
        {CON_DOC_CATEGORIES.map(c => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { await fileDocument(doc.id, category) })}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        <Check className="w-4 h-4" /> File
      </button>
    </li>
  )
}
