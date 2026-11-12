'use client'

import { useState, useRef, useEffect } from 'react'
import { Sparkles, X, Send, FileText } from 'lucide-react'

type Msg = { role: 'user' | 'assistant'; content: string }

const NAVY = 'var(--hero)'
const SUGGESTIONS = [
  'How do I change a due date?',
  "What's overdue?",
  'Who is clocked in?',
  'Assign 61026P16 to Ariel Kerner',
]

export function AskRps() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

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
        body: JSON.stringify({ messages: next }),
      })
      const data = await res.json()
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
      const data = await res.json()
      const reply = data.content ?? data.error ?? 'Could not generate an update.'
      setMessages([...next, { role: 'assistant', content: reply }])
    } catch {
      setMessages([...next, { role: 'assistant', content: 'Network error — please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 md:bottom-5 right-4 z-40 inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
        style={{ background: NAVY }}
      >
        <Sparkles className="w-4 h-4" /> Ask RPS
      </button>
    )
  }

  return (
    <div className="rp-card fixed bottom-20 md:bottom-5 right-4 z-40 w-[min(92vw,380px)] h-[min(72vh,580px)] flex flex-col shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 text-white" style={{ background: NAVY }}>
        <div className="flex items-center gap-2 font-semibold"><Sparkles className="w-4 h-4" /> Ask RPS</div>
        <button onClick={() => setOpen(false)} aria-label="Close"><X className="w-5 h-5" /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50">
        {/* Always-visible quick action */}
        <button
          onClick={getUpdateSinceLastSummary}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors"
        >
          <FileText className="w-4 h-4" /> Update since last summary
        </button>
        {messages.length === 0 && (
          <div className="text-sm text-gray-500 space-y-2">
            <p>Or ask me a question — I can look things up and make changes for you. Try:</p>
            <ul className="space-y-1.5">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button onClick={() => send(s)} className="text-left text-blue-600 hover:underline">“{s}”</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-card border border-gray-200 text-gray-800'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rp-card px-3 py-2 text-sm text-gray-400">Thinking…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="flex items-center gap-2 p-2 border-t border-gray-100 bg-card">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask or tell me to do something…"
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="submit" disabled={loading || !input.trim()} className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-40" aria-label="Send">
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  )
}
