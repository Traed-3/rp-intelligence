'use client'
import { useState } from 'react'

/** Copies text to the clipboard; falls back to selecting a hidden textarea where the clipboard API is refused. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className="px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 text-[11px]"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }
        catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); setDone(true); setTimeout(() => setDone(false), 1500) } finally { ta.remove() } }
      }}>{done ? 'Copied' : label}</button>
  )
}
