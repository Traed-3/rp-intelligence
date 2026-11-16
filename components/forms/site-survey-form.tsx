'use client'

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Camera, ChevronDown, Copy, Plus, Trash2 } from 'lucide-react'
import {
  type SiteHit, type Section, type Field, type Item, type Extra, type Row, penRef, type SurveyData, type SurveyPhoto, type SiteSurveyRow,
  SECTIONS, blankItem, blankData, itemFilled, itemName, photoRef, newId,
} from '@/lib/site-survey'
import { SitePicker } from '@/components/forms/site-picker'
import type { SaveResult, PhotoResult, FinishResult, EmailResult } from '@/app/(app)/forms/site-survey/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-card disabled:bg-gray-50 disabled:text-gray-600'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'
const chip = (on: boolean) => `px-3 py-2 rounded-lg border text-sm font-medium ${on ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-gray-700 border-gray-300'} disabled:cursor-default`
const ghost = 'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-card px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50'

type Header = { site_number: string; site_name: string; address: string; survey_date: string; tech_name: string; survey_company: string }
export type SurveyActions = {
  save: (header: Record<string, string>, data: unknown) => Promise<SaveResult>
  addPhotos: (fd: FormData) => Promise<PhotoResult>
  updatePhoto: (photoId: string, caption: string) => Promise<PhotoResult>
  removePhoto: (photoId: string) => Promise<PhotoResult>
  finish: () => Promise<FinishResult>
  findSites: (q: string) => Promise<SiteHit[]>
}

/** Phone photos are shrunk before they upload so a sump full of pictures goes up on one bar of signal. */
async function shrink(file: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.82))
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file
  } catch { return file }
}

function FieldInput({ f, value, locked, onChange }: { f: Field; value: string; locked: boolean; onChange: (v: string) => void }) {
  if (f.type === 'yn') {
    return (
      <div className="flex gap-2">
        {(['yes', 'no'] as const).map(o => <button key={o} type="button" disabled={locked} aria-pressed={value === o} onClick={() => onChange(value === o ? '' : o)} className={chip(value === o)}>{o === 'yes' ? 'Yes' : 'No'}</button>)}
        <button type="button" disabled={locked} aria-pressed={value === 'Unknown'} onClick={() => onChange(value === 'Unknown' ? '' : 'Unknown')} className={chip(value === 'Unknown')}>?</button>
      </div>
    )
  }
  if (f.type === 'select') {
    // A pick list that still takes anything typed: the old surveys are full of answers that are not on any list.
    const id = `opt-${f.key}-${f.options!.length}-${f.label.length}`
    return (<><input list={id} value={value} disabled={locked} onChange={e => onChange(e.target.value)} placeholder={f.hint ?? 'pick or type'} className={inp} autoComplete="off" /><datalist id={id}>{f.options!.map(o => <option key={o} value={o} />)}</datalist></>)
  }
  if (f.type === 'textarea') return <textarea rows={3} value={value} disabled={locked} onChange={e => onChange(e.target.value)} placeholder={f.hint} className={inp} />
  return <input value={value} disabled={locked} type={f.type === 'date' ? 'date' : 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined} onChange={e => onChange(e.target.value)} placeholder={f.hint} className={inp} autoComplete="off" />
}

/** A table inside a card: one line per penetration, each with its own boxes. Starts empty; add the first, then the next. */
function RowsField({ f, rows, locked, onChange }: { f: Field; rows: Row[]; locked: boolean; onChange: (next: Row[]) => void }) {
  const cols = f.columns ?? []
  const set = (i: number, k: string, val: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: val } : r)))
  return (
    <div className="space-y-2">
      <span className="block text-sm font-semibold text-gray-800">{f.label}{rows.length ? ` · ${rows.length}` : ''}</span>
      {!rows.length && <p className="text-xs text-gray-400">None listed yet.</p>}
      {rows.map((r, i) => (
        <div key={i} className="rounded-lg border border-gray-200 p-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-gray-700">{f.key === 'pens' ? penRef(rows, i) : `${i + 1}`}{r.carries ? <span className="font-normal text-gray-500"> · {r.carries}</span> : null}</span>
            {!locked && <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="p-1 text-gray-400 hover:text-red-600" title={`Remove this ${f.rowNoun ?? 'line'}`}><Trash2 className="w-4 h-4" /></button>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {cols.map(c => (
              <div key={c.key}><label className={lbl}>{c.label}</label><FieldInput f={c} value={r[c.key] ?? ''} locked={locked} onChange={val => set(i, c.key, val)} /></div>
            ))}
          </div>
        </div>
      ))}
      {!locked && (
        <div className="flex flex-wrap gap-2">
          {f.key === 'pens'
            ? ['Product', 'Vapor / vent', 'Conduit'].map(kind => <button key={kind} type="button" onClick={() => onChange([...rows, { kind }])} className={ghost}><Plus className="w-4 h-4" /> {kind}</button>)
            : <button type="button" onClick={() => onChange([...rows, {}])} className={ghost}><Plus className="w-4 h-4" /> Add {rows.length ? 'another' : 'a'} {f.rowNoun ?? 'line'}</button>}
          {rows.length > 0 && <button type="button" onClick={() => onChange([...rows, { ...rows[rows.length - 1] }])} className={ghost}><Copy className="w-4 h-4" /> Copy the last one</button>}
        </div>
      )}
    </div>
  )
}

function Fields({ sec, v, locked, set, rows, setRows }: { sec: Section; v: Record<string, string>; locked: boolean; set: (k: string, val: string) => void; rows?: Record<string, Row[]>; setRows?: (k: string, next: Row[]) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {sec.fields.map(f => f.type === 'rows' ? (
        setRows ? <div key={f.key} className="sm:col-span-2 lg:col-span-3"><RowsField f={f} rows={rows?.[f.key] ?? []} locked={locked} onChange={next => setRows(f.key, next)} /></div> : null
      ) : (
        <div key={f.key} className={f.wide || f.type === 'textarea' ? 'sm:col-span-2 lg:col-span-3' : ''}>
          <label className={lbl}>{f.label}</label>
          <FieldInput f={f} value={v[f.key] ?? ''} locked={locked} onChange={val => set(f.key, val)} />
        </div>
      ))}
    </div>
  )
}

/** Answers the form has no box for: the tech names the field and fills it in. */
function Extras({ list, locked, onChange }: { list: Extra[]; locked: boolean; onChange: (next: Extra[]) => void }) {
  return (
    <div className="space-y-2">
      {list.map((e, i) => (
        <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] gap-2 items-center">
          <input value={e.label} disabled={locked} onChange={ev => onChange(list.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)))} placeholder="What it is" className={inp} />
          <input value={e.value} disabled={locked} onChange={ev => onChange(list.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)))} placeholder="Answer" className={inp} />
          {!locked && <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i))} className="p-2 text-gray-400 hover:text-red-600" title="Remove field"><Trash2 className="w-4 h-4" /></button>}
        </div>
      ))}
      {!locked && <button type="button" onClick={() => onChange([...list, { label: '', value: '' }])} className="text-xs font-semibold text-blue-600 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add a field this form does not have</button>}
    </div>
  )
}

function Photos({ surveyId, refKey, photos, wanted, locked, actions, onPhotos }: {
  surveyId: string; refKey: string; photos: SurveyPhoto[]; wanted?: string[]; locked: boolean; actions: SurveyActions; onPhotos: (p: SurveyPhoto[]) => void
}) {
  const [busy, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const mine = photos.filter(p => p.ref === refKey)
  const upload = (files: FileList | null, caption?: string) => {
    if (!files?.length) return
    const picked = Array.from(files)
    start(async () => {
      setError(null)
      const fd = new FormData()
      fd.set('ref', refKey); if (caption) fd.set('caption', caption)
      for (const f of picked) fd.append('photos', await shrink(f))
      const r = await actions.addPhotos(fd)
      if (r.error) setError(r.error); else if (r.photos) onPhotos(r.photos)
    })
  }
  if (locked && !mine.length) return null
  return (
    <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-gray-700">Photos · {mine.length}</span>
        {!locked && (<>
          <label className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-semibold cursor-pointer hover:bg-primary/90"><Camera className="w-4 h-4" /> {busy ? 'Uploading…' : 'Camera'}<input type="file" accept="image/*" capture="environment" multiple className="hidden" disabled={busy} onChange={e => { upload(e.target.files); e.target.value = '' }} /></label>
          <label className="inline-flex items-center rounded-lg border border-gray-300 bg-card px-3 py-2 text-xs font-semibold cursor-pointer hover:bg-gray-50">From the roll<input type="file" accept="image/*" multiple className="hidden" disabled={busy} onChange={e => { upload(e.target.files); e.target.value = '' }} /></label>
        </>)}
      </div>
      {!locked && wanted?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {wanted.map(w => {
            const have = mine.some(p => p.caption === w)
            return (
              <label key={w} className={`text-[11px] px-2 py-1 rounded-full border cursor-pointer ${have ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-card border-gray-300 text-gray-600 hover:bg-gray-100'}`}>
                {have ? '✓ ' : '+ '}{w}<input type="file" accept="image/*" capture="environment" multiple className="hidden" disabled={busy} onChange={e => { upload(e.target.files, w); e.target.value = '' }} />
              </label>
            )
          })}
        </div>
      ) : null}
      {mine.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          {mine.map(ph => (
            <div key={ph.id} className="space-y-1">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed redirect, not a static asset */}
                <a href={`/forms/site-survey/${surveyId}/photo/${ph.id}`} target="_blank" rel="noopener"><img src={`/forms/site-survey/${surveyId}/photo/${ph.id}`} alt={ph.caption ?? 'Survey photo'} loading="lazy" className="w-full aspect-square object-cover rounded-lg border border-gray-200" /></a>
                {!locked && <button type="button" onClick={() => { if (confirm('Delete this photo?')) start(async () => { const r = await actions.removePhoto(ph.id); if (r.photos) onPhotos(r.photos) }) }} className="absolute top-1 right-1 bg-card/90 rounded-full p-1 text-gray-600 hover:text-red-600" title="Delete photo"><Trash2 className="w-3.5 h-3.5" /></button>}
              </div>
              <input defaultValue={ph.caption ?? ''} disabled={locked} placeholder="caption" onBlur={e => { if (e.target.value !== (ph.caption ?? '')) start(async () => { const r = await actions.updatePhoto(ph.id, e.target.value); if (r.photos) onPhotos(r.photos) }) }} className="w-full rounded border border-gray-200 px-1.5 py-1 text-[11px] bg-card disabled:bg-transparent disabled:border-transparent" />
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

/** The whole survey: header, then one card per section. List sections grow one item at a time. Saves itself as you go. */
export function SiteSurveyForm({ row, locked, actions }: { row: SiteSurveyRow; locked: boolean; actions: SurveyActions }) {
  const [header, setHeader] = useState<Header>({ site_number: row.site_number ?? '', site_name: row.site_name ?? '', address: row.address ?? '', survey_date: row.survey_date, tech_name: row.tech_name ?? '', survey_company: row.survey_company ?? '' })
  const [data, setData] = useState<SurveyData>(() => { const b = blankData(); const d = row.data; return d?.lists ? { one: { ...d.one }, lists: { ...b.lists, ...d.lists }, extra: { ...(d.extra ?? {}) } } : b })
  const [photos, setPhotos] = useState<SurveyPhoto[]>(row.photos ?? [])
  const [open, setOpen] = useState<Record<string, boolean>>({ general: true, tanks: true })
  const [openItem, setOpenItem] = useState<Record<string, boolean>>({})
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [finish, setFinish] = useState<FinishResult | null>(null)
  const [finishing, startFinish] = useTransition()
  const latest = useRef({ header, data })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saving = useRef(false)
  const again = useRef(false)

  const doSave = useCallback(async (): Promise<boolean> => {
    if (saving.current) { again.current = true; return true }
    saving.current = true; setSaveState('saving')
    try {
      // Typing during a save marks `again`, so the newest answers go up as soon as this save lands.
      for (;;) {
        again.current = false
        const r = await actions.save(latest.current.header, latest.current.data).catch(e => ({ ok: false, error: String(e) }) as SaveResult)
        if (!r.ok) { setSaveState('error'); setSaveError(r.error ?? 'Could not save'); return false }
        if (!again.current) break
      }
      setSaveError(null); setSaveState('saved'); return true
    } finally { saving.current = false }
  }, [actions])

  const dirty = useCallback(() => {
    if (locked) return
    setSaveState('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void doSave() }, 2500)
  }, [doSave, locked])
  useEffect(() => { latest.current = { header, data } }, [header, data])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  // Leaving with typing not yet saved: ask first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (saveState === 'dirty' || saveState === 'saving') e.preventDefault() }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [saveState])

  const setHead = (k: keyof Header, v: string) => { setHeader(h => ({ ...h, [k]: v })); dirty() }
  // What the site lookup last filled in. Typing a valid number fills the brand and address on its own, but never over
  // something the tech typed: a box is only replaced when it is empty or still holds what the lookup put there.
  const filled = useRef<{ site_name: string; address: string }>({ site_name: '', address: '' })
  const fillSite = (h: SiteHit, picked: boolean) => {
    setHeader(cur => {
      const mine = (k: 'site_name' | 'address') => picked || !cur[k].trim() || cur[k] === filled.current[k]
      const next = { ...cur, site_number: picked ? h.site_number : cur.site_number, site_name: mine('site_name') && h.site_name ? h.site_name : cur.site_name, address: mine('address') && h.address ? h.address : cur.address }
      filled.current = { site_name: h.site_name ?? '', address: h.address ?? '' }
      return next
    })
    dirty()
  }
  const setOne = (sk: string, k: string, v: string) => { setData(d => ({ ...d, one: { ...d.one, [sk]: { ...(d.one[sk] ?? {}), [k]: v } } })); dirty() }
  const setExtra = (sk: string, list: Extra[]) => { setData(d => ({ ...d, extra: { ...d.extra, [sk]: list } })); dirty() }
  const setList = (sk: string, fn: (items: Item[]) => Item[]) => { setData(d => ({ ...d, lists: { ...d.lists, [sk]: fn(d.lists[sk] ?? []) } })); dirty() }
  // A card being typed in stays open (a blank card would otherwise fold shut the moment its first box is filled).
  const setItem = (sk: string, id: string, patch: (it: Item) => Item) => { setOpenItem(o => (o[id] === undefined ? { ...o, [id]: true } : o)); setList(sk, items => items.map(it => (it.id === id ? patch(it) : it))) }
  const addItem = (sk: string, copyFrom?: Item) => {
    const it: Item = copyFrom ? { id: newId(), v: { ...copyFrom.v }, extra: copyFrom.extra?.map(e => ({ ...e })), rows: copyFrom.rows ? Object.fromEntries(Object.entries(copyFrom.rows).map(([k, r]) => [k, r.map(x => ({ ...x }))])) : undefined } : blankItem()
    setList(sk, items => [...items, it]); setOpen(o => ({ ...o, [sk]: true })); setOpenItem(o => ({ ...o, [it.id]: true }))
  }

  const onFinish = () => startFinish(async () => {
    if (timer.current) clearTimeout(timer.current)
    if (!(await doSave())) return
    setFinish(await actions.finish())
  })

  return (
    <div className="space-y-4">
      <div className="rp-card p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 bg-amber-50/60">
        <div>
          <label className={lbl}>Site # (or search by street, city, brand)</label>
          <SitePicker value={header.site_number} disabled={locked} onChange={v => setHead('site_number', v)} onPick={h => fillSite(h, true)} onExact={h => fillSite(h, false)} search={actions.findSites} placeholder="40017, SU-13400" className={inp} />
        </div>
        <div><label className={lbl}>Brand / name</label><input value={header.site_name} disabled={locked} onChange={e => setHead('site_name', e.target.value)} placeholder="7-Eleven" className={inp} /></div>
        <div><label className={lbl}>Survey date</label><input type="date" value={header.survey_date} disabled={locked} onChange={e => setHead('survey_date', e.target.value)} className={inp} /></div>
        <div className="col-span-2 sm:col-span-3"><label className={lbl}>Address</label><input value={header.address} disabled={locked} onChange={e => setHead('address', e.target.value)} placeholder="8601 Patterson Ave, Richmond, VA 23229" className={inp} /></div>
        <div><label className={lbl}>Surveyed by</label><input value={header.tech_name} disabled={locked} onChange={e => setHead('tech_name', e.target.value)} className={inp} /></div>
        <div><label className={lbl}>Company</label><input value={header.survey_company} disabled={locked} onChange={e => setHead('survey_company', e.target.value)} className={inp} /></div>
      </div>

      {SECTIONS.map(sec => {
        const items = sec.list ? data.lists[sec.key] ?? [] : []
        const filled = sec.list ? items.filter(itemFilled).length : Object.values(data.one[sec.key] ?? {}).filter(Boolean).length + (data.extra[sec.key]?.length ?? 0)
        const nPhotos = photos.filter(p => p.ref === sec.key || p.ref.startsWith(`${sec.key}:`)).length
        const isOpen = !!open[sec.key]
        if (locked && !filled && !nPhotos) return null
        return (
          <section key={sec.key} className="rp-card overflow-hidden">
            <button type="button" onClick={() => setOpen(o => ({ ...o, [sec.key]: !o[sec.key] }))} aria-expanded={isOpen} className="w-full px-4 py-3 flex items-center gap-3 text-left bg-foreground text-background">
              <span className="flex-1 text-sm font-semibold uppercase tracking-wide">{sec.title}</span>
              <span className="text-xs opacity-80">{sec.list ? `${filled} ${filled === 1 ? sec.list.noun : `${sec.list.noun}s`}` : filled ? `${filled} filled` : 'empty'}{nPhotos ? ` · ${nPhotos} photo${nPhotos === 1 ? '' : 's'}` : ''}</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
              <div className="p-4 space-y-4">
                {sec.blurb && <p className="text-xs text-gray-500">{sec.blurb}</p>}
                {!sec.list ? (
                  <>
                    <Fields sec={sec} v={data.one[sec.key] ?? {}} locked={locked} set={(k, v) => setOne(sec.key, k, v)} />
                    <Extras list={data.extra[sec.key] ?? []} locked={locked} onChange={l => setExtra(sec.key, l)} />
                    <Photos surveyId={row.id} refKey={photoRef(sec.key)} photos={photos} wanted={sec.photos} locked={locked} actions={actions} onPhotos={setPhotos} />
                  </>
                ) : (
                  <>
                    {!items.length && <p className="text-sm text-gray-400">None yet.</p>}
                    {items.map((it, i) => {
                      // The newest card and any card still blank stay open; the rest fold to one line so a 12-dispenser site stays scrollable.
                      const show = openItem[it.id] ?? (!itemFilled(it) || items.length === 1)
                      const n = photos.filter(p => p.ref === photoRef(sec.key, it.id)).length
                      return (
                        <div key={it.id} className="rounded-xl border border-gray-200">
                          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-t-xl">
                            <button type="button" onClick={() => setOpenItem(o => ({ ...o, [it.id]: !show }))} aria-expanded={show} className="flex-1 flex items-center gap-2 text-left text-sm font-semibold text-gray-900">
                              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${show ? 'rotate-180' : ''}`} />{itemName(sec, it, i)}
                              {n ? <span className="text-xs font-normal text-gray-500">· {n} photo{n === 1 ? '' : 's'}</span> : null}
                            </button>
                            {!locked && <button type="button" onClick={() => addItem(sec.key, it)} className="p-1.5 text-gray-400 hover:text-blue-600" title={`Copy this ${sec.list!.noun}`}><Copy className="w-4 h-4" /></button>}
                            {!locked && <button type="button" onClick={() => { if (!itemFilled(it) || confirm(`Remove ${itemName(sec, it, i)}?`)) setList(sec.key, l => l.filter(x => x.id !== it.id)) }} className="p-1.5 text-gray-400 hover:text-red-600" title="Remove"><Trash2 className="w-4 h-4" /></button>}
                          </div>
                          {show && (
                            <div className="p-3 space-y-3">
                              <Fields sec={sec} v={it.v} locked={locked} set={(k, v) => setItem(sec.key, it.id, x => ({ ...x, v: { ...x.v, [k]: v } }))} rows={it.rows} setRows={(k, next) => setItem(sec.key, it.id, x => ({ ...x, rows: { ...(x.rows ?? {}), [k]: next } }))} />
                              <Extras list={it.extra ?? []} locked={locked} onChange={l => setItem(sec.key, it.id, x => ({ ...x, extra: l }))} />
                              <Photos surveyId={row.id} refKey={photoRef(sec.key, it.id)} photos={photos} wanted={sec.photos} locked={locked} actions={actions} onPhotos={setPhotos} />
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {!locked && (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => addItem(sec.key)} className={ghost}><Plus className="w-4 h-4" /> Add {items.length ? 'another' : 'a'} {sec.list.noun}</button>
                        {items.length > 0 && itemFilled(items[items.length - 1]) && <button type="button" onClick={() => addItem(sec.key, items[items.length - 1])} className={ghost}><Copy className="w-4 h-4" /> Copy the last one</button>}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        )
      })}

      {!locked && (
        <div className="sticky bottom-0 z-10 -mx-4 sm:mx-0 px-4 py-3 bg-background/95 backdrop-blur border-t border-gray-200 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs flex-1 ${saveState === 'error' ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
              {saveState === 'saved' ? 'All changes saved' : saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Not saved yet' : `Not saved: ${saveError}`}
            </span>
            <button type="button" onClick={() => { if (timer.current) clearTimeout(timer.current); void doSave() }} disabled={saveState === 'saving'} className="px-4 py-2.5 rounded-lg border border-gray-300 bg-card text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-60">Save</button>
            <button type="button" onClick={onFinish} disabled={finishing} className="px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-600/90 disabled:opacity-60">{finishing ? 'Finishing…' : 'Finish survey'}</button>
          </div>
          {finish?.missing?.length ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><span className="font-semibold">Saved. Fill these in to finish: </span>{finish.missing.join(', ')}.</div> : null}
          {finish?.error && <p className="text-sm text-red-600">{finish.error}</p>}
        </div>
      )}
    </div>
  )
}

/** Email the PDF: only goes to the addresses typed here. */
export function SiteSurveyEmail({ action, sentTo }: { action: (prev: EmailResult | null, fd: FormData) => Promise<EmailResult>; sentTo: string | null }) {
  const [state, formAction, pending] = useActionState(action, null)
  return (
    <form action={formAction} className="space-y-2">
      <label className={lbl}>Email the PDF to (comma-separated)</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input name="send_to" type="text" inputMode="email" autoComplete="off" placeholder="name@example.com" className={inp} />
        <button disabled={pending} className="shrink-0 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-600/90 disabled:opacity-60">{pending ? 'Sending…' : 'Email PDF'}</button>
      </div>
      {state?.ok && <p className="text-sm text-emerald-700">Sent to {state.sentTo?.join(', ')}.</p>}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {!state && sentTo && <p className="text-xs text-gray-500">Last emailed to {sentTo}.</p>}
    </form>
  )
}
