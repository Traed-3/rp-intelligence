'use client'

import { useState, useRef, useEffect, Fragment } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sparkles, X, Send, FileText, RotateCcw } from 'lucide-react'
import { safeAppPath } from '@/lib/assistant/links'

type Msg = { role: 'user' | 'assistant'; content: string }

const NAVY = 'var(--hero)'
const STORE_KEY = 'askrps:chat'
const KEEP = 40   // messages kept in this tab's memory

/** Read the saved chat for this tab. Only ever this person's own (a different login starts fresh). */
function loadSaved(userId: string): { open: boolean; messages: Msg[] } {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    if (!raw) return { open: false, messages: [] }
    const v = JSON.parse(raw)
    if (v?.userId !== userId || !Array.isArray(v.messages)) return { open: false, messages: [] }
    const messages = v.messages.filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
    return { open: !!v.open, messages }
  } catch { return { open: false, messages: [] } }
}

/** Page paths in an answer (`/construction/jobs/...`) become links into the app; anything else, plain text. */
function AnswerText({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  const parts = text.split(/(`[^`\n]{1,200}`)/g)
  return (
    <>
      {parts.map((part, i) => {
        const path = /^`[^`]+`$/.test(part) ? safeAppPath(part.slice(1, -1)) : null
        if (path) return <Link key={i} href={path} onClick={onNavigate} className="font-medium text-blue-600 underline underline-offset-2 break-all">{path}</Link>
        if (/^`[^`]+`$/.test(part)) return <code key={i} className="rounded bg-gray-100 px-1 text-[0.85em]">{part.slice(1, -1)}</code>
        return <Fragment key={i}>{part}</Fragment>
      })}
    </>
  )
}

export function AskRps({ suggestions, userId }: { suggestions: string[]; userId: string }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [restored, setRestored] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Bring the chat back after moving to another page (same tab only).
  useEffect(() => {
    const saved = loadSaved(userId)
    setMessages(saved.messages)
    setOpen(saved.open)
    setRestored(true)
  }, [userId])

  useEffect(() => {
    if (!restored) return
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ userId, open, messages: messages.slice(-KEEP) })) } catch { /* private window: chat just isn't kept */ }
  }, [restored, userId, open, messages])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading, open])
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  async function send(text: string) {
    const t = text.trim()
    if (!t || loading) return
    const next: Msg[] = [...messages, { role: 'user', content: t }]
    setMessages(next)
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, page: pathname }),
      })
      const data = await res.json().catch(() => ({}))
      setMessages([...next, { role: 'assistant', content: data.reply ?? data.error ?? 'Something went wrong.' }])
    } catch {
      setMessages([...next, { role: 'assistant', content: 'Network error — please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  async function getUpdateSinceLastSummary() {
    if (loading) return
    const next: Msg[] = [...messages, { role: 'user', content: 'Update since last summary' }]
    setMessages(next)
    setLoading(true)
    try {
      const res = await fetch('/api/daily-summary?dry_run=true')
      const data = await res.json().catch(() => ({}))
      setMessages([...next, { role: 'assistant', content: data.content ?? data.error ?? 'Could not generate an update.' }])
    } catch {
      setMessages([...next, { role: 'assistant', content: 'Network error — please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  // On a phone the chat covers the page, so following a link closes it.
  const closeOnPhone = () => { if (typeof window !== 'undefined' && window.innerWidth < 768) setOpen(false) }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        // Rounded like the other main buttons (Trae, 11/25/26): navy at the edges, lighter toward the middle.
        className="rp-round-button rp-round-navy fixed bottom-20 md:bottom-5 right-4 z-40 inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all print:hidden"
      >
        <Sparkles className="w-4 h-4" /> Ask RPS
      </button>
    )
  }

  return (
    <div className="rp-card fixed bottom-20 md:bottom-5 right-4 z-40 w-[min(92vw,400px)] h-[min(72vh,600px)] flex flex-col shadow-2xl overflow-hidden print:hidden">
      <div className="flex items-center justify-between px-4 py-3 text-white" style={{ background: NAVY }}>
        <div className="flex items-center gap-2 font-semibold"><Sparkles className="w-4 h-4" /> Ask RPS</div>
        <div className="flex items-center gap-3">
          {messages.length > 0 && (
            <button onClick={() => setMessages([])} disabled={loading} aria-label="New chat" title="New chat" className="disabled:opacity-50">
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
          <button onClick={() => setOpen(false)} aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50">
        <button
          onClick={getUpdateSinceLastSummary}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors"
        >
          <FileText className="w-4 h-4" /> Update since last summary
        </button>
        {messages.length === 0 && (
          <div className="text-sm text-gray-500 space-y-2">
            <p>Ask me about anything in the app you can open: jobs, service calls, sites, parts, tickets, your plate, or how to do something. Try:</p>
            <ul className="space-y-1.5">
              {suggestions.map((s) => (
                <li key={s}>
                  <button onClick={() => send(s)} className="text-left text-blue-600 hover:underline">“{s}”</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-card border border-gray-200 text-gray-800'}`}>
              {m.role === 'assistant' ? <AnswerText text={m.content} onNavigate={closeOnPhone} /> : m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rp-card px-3 py-2 text-sm text-gray-400">Looking that up…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="flex items-center gap-2 p-2 border-t border-gray-100 bg-card">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={4000}
          placeholder="Ask or tell me to do something…"
          className="flex-1 px-3 py-2 text-base md:text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="submit" disabled={loading || !input.trim()} className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-40" aria-label="Send">
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  )
}
