'use client'

import { useState } from 'react'
import { FileText, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'

type Props = {
  generatedAt: string | null    // ISO string of latest summary's created_at
  periodStart: string | null
  periodEnd:   string | null
  content:     string | null    // raw markdown the model produced
}

export function DailySummaryCard({ generatedAt, periodStart, periodEnd, content }: Props) {
  const [open, setOpen] = useState(true)

  if (!content) {
    return (
      <div className="rp-card p-5">
        <div className="flex items-center gap-2 text-gray-700">
          <FileText className="h-5 w-5" />
          <h3 className="text-base font-semibold">Today's Recap</h3>
        </div>
        <p className="mt-2 text-sm text-gray-500">
          No summary yet. Today's recap will appear here after the 3pm update fires.
        </p>
      </div>
    )
  }

  const generated = generatedAt ? new Date(generatedAt) : null
  const start = periodStart ? new Date(periodStart) : null
  const end   = periodEnd   ? new Date(periodEnd)   : null
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d)

  return (
    <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-card to-slate-50 p-5 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2 text-gray-800">
          <Sparkles className="h-5 w-5 text-blue-600" />
          <div>
            <h3 className="text-base font-semibold">Today's Recap</h3>
            {start && end && (
              <p className="text-xs text-gray-500">{fmt(start)} → {fmt(end)}</p>
            )}
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
      </button>

      {open && (
        <div className="mt-4 prose prose-sm max-w-none prose-headings:mt-4 prose-headings:mb-2 prose-h2:text-sm prose-h2:font-semibold prose-h2:text-gray-700 prose-h2:border-b prose-h2:pb-1 prose-ul:my-2 prose-li:my-0.5 prose-strong:text-gray-900">
          <SummaryMarkdown text={content} />
          {generated && (
            <p className="mt-4 text-xs text-gray-400">
              Generated {fmt(generated)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// Minimal markdown renderer — headings, bullets, bold. No external lib.
function SummaryMarkdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = []
  const lines = text.split('\n')
  let listBuf: string[] = []

  const flushList = () => {
    if (!listBuf.length) return
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {listBuf.map((li, i) => <li key={i}>{renderInline(li)}</li>)}
      </ul>
    )
    listBuf = []
  }

  lines.forEach((raw, i) => {
    const line = raw.trimEnd()
    if (/^## (.+)/.test(line)) {
      flushList()
      blocks.push(<h2 key={`h-${i}`}>{line.replace(/^## /, '')}</h2>)
    } else if (/^### (.+)/.test(line)) {
      flushList()
      blocks.push(<h3 key={`h-${i}`}>{line.replace(/^### /, '')}</h3>)
    } else if (/^- (.+)/.test(line)) {
      listBuf.push(line.replace(/^- /, ''))
    } else if (line.trim() === '') {
      flushList()
    } else {
      flushList()
      blocks.push(<p key={`p-${i}`}>{renderInline(line)}</p>)
    }
  })
  flushList()
  return <>{blocks}</>
}

function renderInline(text: string): React.ReactNode {
  // **bold** → <strong>
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    /^\*\*([^*]+)\*\*$/.test(p)
      ? <strong key={i}>{p.replace(/^\*\*|\*\*$/g, '')}</strong>
      : <span key={i}>{p}</span>
  )
}
