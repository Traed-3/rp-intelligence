'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Eraser, PenLine } from 'lucide-react'

/**
 * Finger/stylus signature capture. Draws on a canvas sized to its container
 * (device-pixel aware so it stays crisp), then hands a PNG data URL to `onSave`.
 * Once a signature exists it is shown as an image and the pad is hidden.
 */
export function SignaturePad({
  title,
  existingUrl,
  signedLabel,
  askName,
  onSave,
  disabled,
}: {
  title: string
  existingUrl?: string | null
  signedLabel?: string | null
  askName?: boolean
  onSave: (dataUrl: string, name?: string, signerTitle?: string) => Promise<{ error?: string }>
  disabled?: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [dirty, setDirty] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    const c = canvas.current; if (!c) return
    const dpr = window.devicePixelRatio || 1
    const rect = c.getBoundingClientRect()
    c.width = Math.round(rect.width * dpr); c.height = Math.round(rect.height * dpr)
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111827'
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, rect.width, rect.height)
  }, [existingUrl])

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = canvas.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return
    drawing.current = true; canvas.current!.setPointerCapture(e.pointerId)
    const ctx = canvas.current!.getContext('2d')!; const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y)
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = canvas.current!.getContext('2d')!; const { x, y } = pos(e); ctx.lineTo(x, y); ctx.stroke(); setDirty(true)
  }
  function up() { drawing.current = false }
  function clear() {
    const c = canvas.current!; const ctx = c.getContext('2d')!; const r = c.getBoundingClientRect()
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, r.width, r.height); setDirty(false)
  }
  function save() {
    if (!dirty) { setError('Sign in the box first.'); return }
    if (askName && !name.trim()) { setError('Enter the name of the person signing.'); return }
    setError(null)
    const dataUrl = canvas.current!.toDataURL('image/png')
    start(async () => { const r = await onSave(dataUrl, name.trim() || undefined, role.trim() || undefined); if (r?.error) setError(r.error) })
  }

  if (existingUrl) {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-green-700 mb-2">{title} · signed</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={existingUrl} alt={`${title} signature`} className="h-20 w-auto rounded bg-white border border-green-100" />
        {signedLabel && <div className="text-xs text-green-800 mt-1">{signedLabel}</div>}
      </div>
    )
  }

  return (
    <div className="rp-card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5"><PenLine className="w-4 h-4 text-blue-600" />{title}</div>
        <button type="button" onClick={clear} className="text-xs text-gray-500 inline-flex items-center gap-1 hover:text-gray-800"><Eraser className="w-3.5 h-3.5" />Clear</button>
      </div>
      {askName && (
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" aria-label="Signer name" />
          <input value={role} onChange={e => setRole(e.target.value)} placeholder="Title (Store Manager…)" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" aria-label="Signer title" />
        </div>
      )}
      <canvas
        ref={canvas}
        className="w-full h-36 rounded-xl border border-dashed border-gray-300 touch-none bg-white"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
        aria-label={`${title} signature area`}
      />
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      <button type="button" onClick={save} disabled={pending || disabled} className="mt-3 w-full rounded-xl bg-primary text-primary-foreground text-sm font-semibold py-2.5 disabled:opacity-50">
        {pending ? 'Saving…' : `Save ${title.toLowerCase()}`}
      </button>
    </div>
  )
}
