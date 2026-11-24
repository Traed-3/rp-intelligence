'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { buttonVariants } from '@/components/ui/button'

// An on-page "are you sure?" box, in place of the browser's own pop-up (which looks like a warning from the browser,
// cannot be styled, and is blocked on some phones). `const [ask, asking] = useAsk()`, put {asking} anywhere in the page,
// then `if (await ask({ text, yes })) ...`. Escape or a click outside counts as No.

type Ask = { text: string; yes: string; no?: string; danger?: boolean }

export function useAsk(): [(a: Ask) => Promise<boolean>, React.ReactNode] {
  const [q, setQ] = useState<(Ask & { done: (ok: boolean) => void }) | null>(null)
  const ask = useCallback((a: Ask) => new Promise<boolean>(done => setQ({ ...a, done })), [])
  const answer = (ok: boolean) => { q?.done(ok); setQ(null) }
  return [ask, q ? <AskBox q={q} answer={answer} /> : null]
}

function AskBox({ q, answer }: { q: Ask; answer: (ok: boolean) => void }) {
  const yes = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    yes.current?.focus()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); answer(false) } }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [answer])
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-label={q.text} onClick={() => answer(false)}>
      <div className="rp-card w-full max-w-sm p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <p className="text-sm text-foreground">{q.text}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button className={buttonVariants({ variant: 'outline', size: 'sm' })} onClick={() => answer(false)}>{q.no ?? 'Cancel'}</button>
          <button ref={yes} className={buttonVariants({ variant: q.danger ? 'destructive' : 'default', size: 'sm' })} onClick={() => answer(true)}>{q.yes}</button>
        </div>
      </div>
    </div>
  )
}
