'use client'

import { useEffect, useRef, useState } from 'react'
import { Move } from 'lucide-react'
import { cn } from '@/lib/utils'
import { saveDashboardOrder } from '@/app/(app)/dashboard/actions'

type Item = { key: string; node: React.ReactNode }
type Note = { text: string; bad?: boolean } | null

const MOUSE_START_PX = 6     // a mouse picks a square up once it has moved this far with the button held
const TOUCH_HOLD_MS = 350    // a finger has to rest on a square this long first, so scrolling the page still works
const TOUCH_SLOP_PX = 10     // moving more than this before the hold is up = the person is scrolling

/**
 * The Dashboard squares in the person's own order (Trae, 11/23/26). Grab a square and move it (mouse: press and drag;
 * phone: hold, then drag); the others make room, and the new order is saved to their own settings when it is let go.
 * A plain tap or click still opens the square.
 */
export function SortableGrid({ items, className }: { items: Item[]; className?: string }) {
  const [order, setOrder] = useState<string[]>(() => items.map(i => i.key))
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [note, setNote] = useState<Note>(null)
  const grid = useRef<HTMLDivElement>(null)

  // The person's order, then any square the server added since (a card switched back on).
  const byKey = new Map(items.map(i => [i.key, i.node]))
  const shown = [...order.filter(k => byKey.has(k)), ...items.map(i => i.key).filter(k => !order.includes(k))]

  useEffect(() => {
    const root = grid.current
    if (!root) return
    type Drag = { key: string; el: HTMLElement; pointerId: number; touch: boolean; startX: number; startY: number; offX: number; offY: number; tx: number; ty: number; live: boolean; timer?: ReturnType<typeof setTimeout>; before: string }
    let d: Drag | null = null
    let swallowClick = false

    const cells = () => [...root.querySelectorAll<HTMLElement>(':scope > [data-key]')]
    const keys = () => cells().map(c => c.dataset.key!)

    const place = (x: number, y: number) => {
      if (!d) return
      // Where the square sits in the grid right now (its box minus the shift already applied), then follow the pointer.
      const r = d.el.getBoundingClientRect()
      d.tx = x - d.offX - (r.left - d.tx)
      d.ty = y - d.offY - (r.top - d.ty)
      d.el.style.transform = `translate(${d.tx}px, ${d.ty}px) scale(1.03)`
    }
    const begin = (x: number, y: number) => {
      if (!d) return
      const r = d.el.getBoundingClientRect()
      d.offX = d.startX - r.left
      d.offY = d.startY - r.top
      d.live = true
      swallowClick = true
      setDragKey(d.key)
      place(x, y)
      if (d.touch) navigator.vibrate?.(15)
    }

    const down = (e: PointerEvent) => {
      if (e.button !== 0 || d) return
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')
      if (!el || el.parentElement !== root) return
      const touch = e.pointerType !== 'mouse'
      d = { key: el.dataset.key!, el, pointerId: e.pointerId, touch, startX: e.clientX, startY: e.clientY, offX: 0, offY: 0, tx: 0, ty: 0, live: false, before: keys().join('|') }
      swallowClick = false
      if (touch) { const x = e.clientX, y = e.clientY; d.timer = setTimeout(() => begin(x, y), TOUCH_HOLD_MS) }
    }
    const move = (e: PointerEvent) => {
      if (!d || e.pointerId !== d.pointerId) return
      const far = Math.hypot(e.clientX - d.startX, e.clientY - d.startY)
      if (!d.live) {
        if (d.touch) { if (far > TOUCH_SLOP_PX) { clearTimeout(d.timer); d = null } return }
        if (far < MOUSE_START_PX) return
        begin(e.clientX, e.clientY)
      }
      e.preventDefault()
      // Over another square? Take its place.
      const over = cells().find(c => {
        if (c === d!.el) return false
        const r = c.getBoundingClientRect()
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      })
      if (over) {
        const cur = keys()
        const from = cur.indexOf(d.key), to = cur.indexOf(over.dataset.key!)
        if (from !== -1 && to !== -1) {
          cur.splice(from, 1)
          cur.splice(to, 0, d.key)
          setOrder(cur)
        }
      }
      place(e.clientX, e.clientY)
    }
    const up = (e: PointerEvent) => {
      if (!d || e.pointerId !== d.pointerId) return
      const was = d
      d = null
      clearTimeout(was.timer)
      was.el.style.transform = ''
      if (!was.live) return
      setDragKey(null)
      const now = keys()
      if (now.join('|') === was.before) return
      setNote({ text: 'Saving your order…' })
      saveDashboardOrder(now)
        .then(r => setNote(r.ok ? { text: 'Order saved.' } : { text: 'Could not save the new order. Try again.', bad: true }))
        .catch(() => setNote({ text: 'Could not save the new order. Try again.', bad: true }))
    }
    // A drag that ends on a square must not also open it.
    const click = (e: MouseEvent) => { if (swallowClick) { e.preventDefault(); e.stopPropagation(); swallowClick = false } }
    // While a square is held on a phone, the page must not scroll under the finger, and no link menu may pop up.
    const touchMove = (e: TouchEvent) => { if (d?.live) e.preventDefault() }
    const noMenu = (e: Event) => { if (d?.touch) e.preventDefault() }
    const noNativeDrag = (e: Event) => e.preventDefault()

    root.addEventListener('pointerdown', down)
    root.addEventListener('click', click, true)
    root.addEventListener('contextmenu', noMenu)
    root.addEventListener('dragstart', noNativeDrag)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    document.addEventListener('touchmove', touchMove, { passive: false })
    return () => {
      root.removeEventListener('pointerdown', down)
      root.removeEventListener('click', click, true)
      root.removeEventListener('contextmenu', noMenu)
      root.removeEventListener('dragstart', noNativeDrag)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.removeEventListener('touchmove', touchMove)
    }
  }, [])

  useEffect(() => {
    if (!note || note.text.startsWith('Saving')) return
    const t = setTimeout(() => setNote(null), 2500)
    return () => clearTimeout(t)
  }, [note])

  return (
    <div className="space-y-3">
      <div ref={grid} className={cn(className, dragKey && 'select-none')}>
        {shown.map(k => (
          <div key={k} data-key={k} className={cn('rp-sortable', dragKey === k && 'rp-sortable-lifted')}>
            {byKey.get(k)}
          </div>
        ))}
      </div>
      <p className={cn('flex items-center justify-center gap-1.5 text-xs', note?.bad ? 'text-red-600' : 'text-gray-500')} aria-live="polite">
        <Move className="w-3.5 h-3.5" />
        {note?.text ?? 'Grab a square and move it to put them in your own order. On a phone, hold it first.'}
      </p>
    </div>
  )
}
