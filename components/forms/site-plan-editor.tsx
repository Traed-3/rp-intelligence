'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Crosshair, Eye, EyeOff, Globe, Pencil, RotateCw, ScanSearch, Trash2, Wand2, ZoomIn, ZoomOut } from 'lucide-react'
import {
  type SitePlan, type PlanElement, type PlanShape, type PlanLine, type ShapeType, type LineType,
  BOARD, SHAPES, LINES, shapeDef, lineDef, newShape, newId, feet, fmtFeet,
} from '@/lib/site-survey'
import type { PlanResult } from '@/app/(app)/forms/site-survey/actions'

const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-card px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50'
const primary = 'inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-semibold hover:bg-primary/90 disabled:opacity-50'
const inp = 'rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-card'
const SPANS = [60, 90, 130, 180]
const BIG = ['building', 'canopy', 'tank_pad', 'tank']

export type PlanActions = {
  save: (plan: unknown) => Promise<PlanResult>
  loadAerial: (opts: { where?: string; center?: [number, number]; span?: number }) => Promise<PlanResult>
  removeAerial: () => Promise<PlanResult>
  scan: () => Promise<PlanResult>
  fromSurvey: () => Promise<PlanResult>
}
type Mode = { kind: 'select' } | { kind: 'center' } | { kind: 'line'; type: LineType; id: string | null } | { kind: 'pen'; id: string | null }
type Drag = { id: string; what: 'move' | 'size'; sx: number; sy: number; orig: PlanShape } | { id: string; what: 'line'; sx: number; sy: number; pts: [number, number][] } | null

/**
 * The site drawing. Three ways in, all ending on the same board:
 *  1. Picture from above: finds the site from its address, shows the aerial picture, and "Scan the picture" draws the
 *     store, canopy, dispensers and tank pad from it. Tanks and dispenser numbers come from the survey.
 *  2. Draw from the survey: no picture, a standard layout from the tank and dispenser list.
 *  3. By hand: add shapes, draw pipe runs, or sketch with the pen. (A photo of a paper sketch goes in the box below.)
 * Everything can be dragged, sized, turned and renamed. With a picture behind it, sizes read out in feet.
 */
export function SitePlanEditor({ surveyId, initial, address, locked, actions }: { surveyId: string; initial: SitePlan | null; address: string; locked: boolean; actions: PlanActions }) {
  const [plan, setPlan] = useState<SitePlan>(initial ?? { elements: [] })
  const [sel, setSel] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>({ kind: 'select' })
  const [showAerial, setShowAerial] = useState(true)
  const [where, setWhere] = useState('')
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [state, setState] = useState<'saved' | 'dirty' | 'saving'>('saved')
  const [busy, start] = useTransition()
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag>(null)
  const latest = useRef(plan)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { latest.current = plan }, [plan])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const save = useCallback(async () => {
    setState('saving')
    const r = await actions.save(latest.current).catch(e => ({ ok: false, error: String(e) }) as PlanResult)
    if (!r.ok) { setMsg({ text: r.error ?? 'Could not save the drawing', bad: true }); setState('dirty'); return }
    setState(s => (s === 'saving' ? 'saved' : s))
  }, [actions])
  const change = useCallback((fn: (els: PlanElement[]) => PlanElement[]) => {
    setPlan(p => ({ ...p, elements: fn(p.elements) }))
    setState('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void save() }, 1800)
  }, [save])

  /** Run a server step that returns a whole new plan (aerial, scan, layout). Anything drawn is saved first. */
  const run = (label: string, fn: () => Promise<PlanResult>) => start(async () => {
    setMsg({ text: label })
    if (timer.current) clearTimeout(timer.current)
    if (state !== 'saved') await save()
    const r = await fn().catch(e => ({ ok: false, error: String(e) }) as PlanResult)
    if (!r.ok || !r.plan) { setMsg({ text: r.error ?? 'That did not work', bad: true }); return }
    setPlan(r.plan); setSel(null); setState('saved'); setMode({ kind: 'select' }); setShowAerial(true)
    setMsg(r.message ? { text: r.message } : null)
  })

  const at = (e: React.PointerEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * BOARD, ((e.clientY - r.top) / r.height) * BOARD]
  }
  const shapes = plan.elements.filter((e): e is PlanShape => e.kind === 'shape')
  const lines = plan.elements.filter((e): e is PlanLine => e.kind === 'line')
  const picked = plan.elements.find(e => e.id === sel) ?? null
  const patch = (id: string, p: Partial<PlanShape>) => change(els => els.map(e => (e.id === id && e.kind === 'shape' ? { ...e, ...p } : e)))

  const boardDown = (e: React.PointerEvent) => {
    if (locked) return
    const [x, y] = at(e)
    if (mode.kind === 'center') { run('Moving the picture…', () => actions.loadAerial({ center: [x, y], span: plan.aerial && plan.aerial.span_m > 90 ? 90 : plan.aerial?.span_m })); return }
    if (mode.kind === 'line') {
      // Each tap adds a corner to the run; "Done" ends it.
      if (mode.id) { const id = mode.id; change(els => els.map(l => (l.id === id && l.kind === 'line' ? { ...l, pts: [...l.pts, [x, y]] } : l))) }
      else { const id = newId(); change(els => [...els, { id, kind: 'line', type: mode.type, pts: [[x, y], [x, y]] }]); setMode({ ...mode, id }) }
      return
    }
    if (mode.kind === 'pen') {
      const id = newId()
      change(els => [...els, { id, kind: 'line', type: 'pen', pts: [[x, y], [x, y]] }])
      setMode({ kind: 'pen', id }); svg.current!.setPointerCapture(e.pointerId)
      return
    }
    setSel(null)
  }
  const boardMove = (e: React.PointerEvent) => {
    const [x, y] = at(e)
    if (mode.kind === 'pen' && mode.id && e.buttons) {
      const id = mode.id
      setPlan(p => ({ ...p, elements: p.elements.map(l => { if (l.id !== id || l.kind !== 'line') return l; const last = l.pts[l.pts.length - 1]; return Math.hypot(x - last[0], y - last[1]) > 5 ? { ...l, pts: [...l.pts, [x, y]] } : l }) }))
      return
    }
    const d = drag.current
    if (!d) return
    const dx = x - d.sx, dy = y - d.sy
    if (d.what === 'line') { const pts = d.pts; setPlan(p => ({ ...p, elements: p.elements.map(l => (l.id === d.id && l.kind === 'line' ? { ...l, pts: pts.map(pt => [pt[0] + dx, pt[1] + dy] as [number, number]) } : l)) })); return }
    const o = d.orig
    if (d.what === 'move') { setPlan(p => ({ ...p, elements: p.elements.map(s => (s.id === d.id && s.kind === 'shape' ? { ...s, x: o.x + dx, y: o.y + dy } : s)) })); return }
    // Sizing: the handle sits on the shape's own corner, so measure the pull along the shape's own sides.
    const rad = (-o.rot * Math.PI) / 180
    const lx = (x - o.x) * Math.cos(rad) - (y - o.y) * Math.sin(rad), ly = (x - o.x) * Math.sin(rad) + (y - o.y) * Math.cos(rad)
    setPlan(p => ({ ...p, elements: p.elements.map(s => (s.id === d.id && s.kind === 'shape' ? { ...s, w: Math.max(10, Math.abs(lx) * 2), h: Math.max(10, Math.abs(ly) * 2) } : s)) }))
  }
  const boardUp = () => {
    if (drag.current) { drag.current = null; change(els => els) }
    if (mode.kind === 'pen' && mode.id) { setMode({ kind: 'pen', id: null }); change(els => els) }
  }
  const grab = (e: React.PointerEvent, el: PlanElement, what: 'move' | 'size' = 'move') => {
    if (locked || mode.kind !== 'select') return
    e.stopPropagation()
    const [sx, sy] = at(e)
    setSel(el.id)
    drag.current = el.kind === 'shape' ? { id: el.id, what, sx, sy, orig: el } : { id: el.id, what: 'line', sx, sy, pts: el.pts }
    svg.current!.setPointerCapture(e.pointerId)
  }
  const add = (type: ShapeType) => {
    const n = shapes.filter(s => s.type === type).length
    const label = type === 'dispenser' ? `${n * 2 + 1}/${n * 2 + 2}` : type === 'tank' ? `Tank ${n + 1}` : shapeDef(type).label
    const s = newShape(type, 500 + (n % 5) * 24, 500 + (n % 5) * 24, label)
    change(els => [...els, s]); setSel(s.id); setMode({ kind: 'select' })
  }

  const a = plan.aerial
  const pickedShape = picked?.kind === 'shape' ? picked : null
  const sizeFt = pickedShape ? [feet(pickedShape.w, plan), feet(pickedShape.h, plan)] : null
  const earth = a ? `https://earth.google.com/web/@${a.lat.toFixed(6)},${a.lng.toFixed(6)},0a,250d,35y,0h,0t,0r` : address ? `https://earth.google.com/web/search/${encodeURIComponent(address)}` : null
  const hint = mode.kind === 'center' ? 'Tap the middle of the site (between the canopy and the tank pad). The picture re-aims and zooms in there.'
    : mode.kind === 'line' ? `Tap each corner of the ${lineDef(mode.type).label.toLowerCase()}, then press Done.`
    : mode.kind === 'pen' ? 'Draw with a finger or the mouse. Press Done when finished.' : null

  return (
    <div className="space-y-3">
      {!locked && (
        <div className="rounded-xl border border-gray-200 p-3 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[14rem]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Picture from above</label>
              <input value={where} onChange={e => setWhere(e.target.value)} placeholder={address || 'Site address, or coordinates: 37.5946, -77.5665'} className={`${inp} w-full`} />
            </div>
            <button type="button" disabled={busy} onClick={() => run('Finding the site…', () => actions.loadAerial({ where: where.trim() || undefined }))} className={primary}><Globe className="w-4 h-4" /> {a ? 'Get it again' : 'Get the picture'}</button>
            {earth && <a href={earth} target="_blank" rel="noopener" className={btn}>Open in Google Earth</a>}
          </div>
          {a && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy} onClick={() => setMode(m => (m.kind === 'center' ? { kind: 'select' } : { kind: 'center' }))} className={mode.kind === 'center' ? primary : btn}><Crosshair className="w-4 h-4" /> Center on the site</button>
              <button type="button" disabled={busy || a.span_m <= SPANS[0]} onClick={() => run('Zooming in…', () => actions.loadAerial({ span: SPANS[Math.max(0, SPANS.indexOf(a.span_m) - 1)] }))} className={btn}><ZoomIn className="w-4 h-4" /> Closer</button>
              <button type="button" disabled={busy || a.span_m >= SPANS[SPANS.length - 1]} onClick={() => run('Zooming out…', () => actions.loadAerial({ span: SPANS[Math.min(SPANS.length - 1, SPANS.indexOf(a.span_m) + 1)] }))} className={btn}><ZoomOut className="w-4 h-4" /> Wider</button>
              <button type="button" disabled={busy} onClick={() => { if (!shapes.length || confirm('Scan the picture and redraw the shapes? Pipe runs and notes you drew stay.')) run('Reading the picture…', actions.scan) }} className={primary}><ScanSearch className="w-4 h-4" /> Scan the picture</button>
              <button type="button" onClick={() => setShowAerial(v => !v)} className={btn}>{showAerial ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />} {showAerial ? 'Show clean drawing' : 'Show picture'}</button>
              <span className="text-[11px] text-gray-500">{Math.round(a.span_m * 3.281)} ft across · north up · {a.source}</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy} onClick={() => { if (!shapes.length || confirm('Redraw the shapes from the survey? Pipe runs and notes you drew stay.')) run('Drawing…', actions.fromSurvey) }} className={btn}><Wand2 className="w-4 h-4" /> Draw from the survey (no picture)</button>
            {a && <button type="button" disabled={busy} onClick={() => { if (confirm('Take the aerial picture off the drawing?')) run('Removing…', actions.removeAerial) }} className="text-xs text-gray-400 hover:text-red-600 underline">Remove the picture</button>}
          </div>
        </div>
      )}

      {msg && <p className={`text-sm rounded-lg px-3 py-2 ${msg.bad ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-800 border border-blue-200'}`}>{busy && !msg.bad ? '⏳ ' : ''}{msg.text}</p>}
      {hint && <p className="text-sm rounded-lg px-3 py-2 bg-amber-50 text-amber-900 border border-amber-200 flex items-center gap-2"><span className="flex-1">{hint}</span><button type="button" onClick={() => setMode({ kind: 'select' })} className="px-3 py-1 rounded-md bg-amber-600 text-white text-xs font-semibold">Done</button></p>}

      {!locked && (
        <div className="flex flex-wrap gap-1.5">
          {SHAPES.map(s => <button key={s.type} type="button" onClick={() => add(s.type)} className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-card px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"><span className="inline-block w-3 h-3 border" style={{ background: s.fill === 'none' ? '#fff' : s.fill, borderColor: s.stroke === 'none' ? '#9ca3af' : s.stroke, borderRadius: s.round ? 999 : 2 }} />+ {s.label}</button>)}
          {LINES.map(l => {
            const on = (mode.kind === 'line' && mode.type === l.type) || (mode.kind === 'pen' && l.type === 'pen')
            return <button key={l.type} type="button" onClick={() => { setSel(null); setMode(on ? { kind: 'select' } : l.type === 'pen' ? { kind: 'pen', id: null } : { kind: 'line', type: l.type, id: null }) }} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs ${on ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-gray-700 border-gray-300 hover:bg-gray-50'}`}>{l.type === 'pen' ? <Pencil className="w-3 h-3" /> : <span className="inline-block w-4 h-0.5" style={{ background: l.color }} />}{l.label}</button>
          })}
        </div>
      )}

      <div className="relative w-full max-w-[820px] mx-auto aspect-square rounded-xl border-2 border-gray-800 overflow-hidden bg-white select-none">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed redirect, not a static asset */}
        {a && showAerial && <img src={`/forms/site-survey/${surveyId}/aerial?v=${encodeURIComponent(a.path.slice(-22))}`} alt="Aerial picture of the site" className="absolute inset-0 w-full h-full" draggable={false} />}
        {!a && !plan.elements.length && <p className="absolute inset-0 flex items-center justify-center text-center text-sm text-gray-400 p-8">Nothing drawn yet. Get the picture from above and scan it, draw from the survey, or add shapes by hand.</p>}
        <svg ref={svg} viewBox={`0 0 ${BOARD} ${BOARD}`} className="absolute inset-0 w-full h-full" style={{ touchAction: 'none', cursor: mode.kind === 'select' ? 'default' : 'crosshair' }} onPointerDown={boardDown} onPointerMove={boardMove} onPointerUp={boardUp} onPointerCancel={boardUp}>
          {!(a && showAerial) && <g stroke="#e5e7eb" strokeWidth={1}>{Array.from({ length: 9 }, (_, i) => <g key={i}><line x1={(i + 1) * 100} y1={0} x2={(i + 1) * 100} y2={BOARD} /><line x1={0} y1={(i + 1) * 100} x2={BOARD} y2={(i + 1) * 100} /></g>)}</g>}
          {lines.map(l => {
            const d = lineDef(l.type)
            const pts = l.pts.map(p => p.join(',')).join(' ')
            return (
              <g key={l.id} onPointerDown={e => grab(e, l)}>
                <polyline points={pts} fill="none" stroke="transparent" strokeWidth={26} />
                {a && showAerial && <polyline points={pts} fill="none" stroke="#fff" strokeWidth={d.width * 2 + 4} strokeLinejoin="round" strokeLinecap="round" opacity={0.7} />}
                <polyline points={pts} fill="none" stroke={sel === l.id ? '#2563eb' : d.color} strokeWidth={d.width * 2} strokeDasharray={d.dash} strokeLinejoin="round" strokeLinecap="round" />
              </g>
            )
          })}
          {[...shapes.filter(s => BIG.includes(s.type)).sort((x, y) => BIG.indexOf(x.type) - BIG.indexOf(y.type)), ...shapes.filter(s => !BIG.includes(s.type))].map(s => {
            const d = shapeDef(s.type)
            const on = sel === s.id
            const over = !!(a && showAerial)
            const isLabel = s.type === 'label'
            const fs = isLabel ? 22 : d.small ? 15 : s.type === 'dispenser' ? 16 : 20
            const below = d.small || s.type === 'dispenser'
            const fa = feet(s.w, plan), fb = feet(s.h, plan)
            const turn = (s.rot * Math.PI) / 180
            const tall = Math.abs(s.w * Math.sin(turn)) + Math.abs(s.h * Math.cos(turn))   // how tall the turned shape stands on the board
            const dims = ['building', 'canopy', 'tank_pad'].includes(s.type) && fa && fb ? ` ${fmtFeet(Math.max(fa, fb))} x ${fmtFeet(Math.min(fa, fb))}` : ''
            return (
              <g key={s.id}>
                <g transform={`translate(${s.x} ${s.y}) rotate(${s.rot})`} onPointerDown={e => grab(e, s)} style={{ cursor: locked ? 'default' : 'move' }}>
                  {/* A generous invisible target so a small mark can be caught with a thumb. */}
                  <rect x={-Math.max(s.w, 44) / 2} y={-Math.max(s.h, 44) / 2} width={Math.max(s.w, 44)} height={Math.max(s.h, 44)} fill="transparent" />
                  {isLabel ? null : d.round && s.type !== 'tank'
                    ? <ellipse rx={s.w / 2} ry={s.h / 2} fill={d.fill} fillOpacity={over ? 0.8 : 1} stroke={d.stroke} strokeWidth={3} />
                    : <rect x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h} rx={s.type === 'tank' ? s.h / 2 : 0} fill={d.fill} fillOpacity={over ? (BIG.includes(s.type) && s.type !== 'tank' ? 0.22 : 0.8) : 1} stroke={d.stroke} strokeWidth={BIG.includes(s.type) ? 4 : 3} />}
                  {on && <rect x={-s.w / 2 - 5} y={-s.h / 2 - 5} width={s.w + 10} height={s.h + 10} fill="none" stroke="#2563eb" strokeWidth={3} strokeDasharray="8 5" />}
                  {on && !locked && !isLabel && <circle cx={s.w / 2} cy={s.h / 2} r={15} fill="#2563eb" stroke="#fff" strokeWidth={3} style={{ cursor: 'nwse-resize' }} onPointerDown={e => grab(e, s, 'size')} />}
                </g>
                <text x={s.x} y={below ? s.y + tall / 2 + fs : s.type === 'tank_pad' || s.type === 'canopy' ? s.y - tall / 2 - 8 : s.y + fs / 3} textAnchor="middle" fontSize={fs} fontWeight={700} fill={over ? '#fff' : '#111827'} stroke={over ? '#111827' : '#fff'} strokeWidth={over ? 5 : 4} paintOrder="stroke" style={{ pointerEvents: 'none' }}>{s.label}{dims}</text>
              </g>
            )
          })}
          <g transform="translate(955 44)" style={{ pointerEvents: 'none' }}><polygon points="0,-30 14,16 0,6 -14,16" fill="#111827" stroke="#fff" strokeWidth={3} /><text y={40} textAnchor="middle" fontSize={22} fontWeight={700} fill="#111827" stroke="#fff" strokeWidth={5} paintOrder="stroke">N</text></g>
        </svg>
      </div>

      {picked && !locked && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 flex flex-wrap items-end gap-3">
          {pickedShape ? (<>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">{shapeDef(pickedShape.type).label} label</label><input value={pickedShape.label} onChange={e => patch(pickedShape.id, { label: e.target.value })} className={`${inp} w-44`} /></div>
            <div className="flex-1 min-w-[10rem]"><label className="block text-xs font-medium text-gray-600 mb-1"><RotateCw className="inline w-3 h-3" /> Turn · {Math.round(pickedShape.rot)}°</label><input type="range" min={-90} max={90} step={1} value={Math.max(-90, Math.min(90, pickedShape.rot))} onChange={e => patch(pickedShape.id, { rot: Number(e.target.value) })} className="w-full" /></div>
            <button type="button" onClick={() => patch(pickedShape.id, { w: pickedShape.h, h: pickedShape.w })} className={btn}>Swap length / width</button>
            {sizeFt?.[0] ? <span className="text-xs text-gray-600 pb-2">{fmtFeet(sizeFt[0])} x {fmtFeet(sizeFt[1])}</span> : null}
            <button type="button" onClick={() => change(els => [...els, { ...pickedShape, id: newId(), x: pickedShape.x + 40, y: pickedShape.y + 40 }])} className={btn}>Copy</button>
          </>) : <span className="text-sm text-gray-700 flex-1 pb-2">{lineDef((picked as PlanLine).type).label} selected. Drag it to move it.</span>}
          <button type="button" onClick={() => { change(els => els.filter(e => e.id !== picked.id)); setSel(null) }} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-card px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /> Delete</button>
        </div>
      )}
      {!locked && <p className="text-[11px] text-gray-500">{state === 'saved' ? 'Drawing saved.' : state === 'saving' ? 'Saving the drawing…' : 'Drawing not saved yet.'} Tap a shape to pick it, drag to move, drag the blue dot to size it. {plan.elements.length > 0 && <button type="button" onClick={() => { if (confirm('Erase everything drawn?')) { change(() => []); setSel(null) } }} className="underline hover:text-red-600">Erase all</button>}</p>}
    </div>
  )
}
