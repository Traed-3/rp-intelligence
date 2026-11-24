'use client'

import { useState } from 'react'
import { Plus, Trash2, Camera } from 'lucide-react'
import { type SumpRow, type SurveyEntry, type EntryKind, type PhotoRow, type SumpType, ENTRY_KINDS, FITTINGS, BOLT_COUNTS, PIPE_OPTIONS, OD_OPTIONS, NOTE_OPTIONS, SUMP_LOCATIONS, SUMP_MATERIALS, SUMP_PROFILES, WORKSHEETS, LID_FIELDS, SUMP_TYPES, composeSumpLabel, entryRef } from '@/lib/survey'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-card'
const sel = inp
const lbl = 'block text-xs font-medium text-gray-600 mb-1'
const chip = (on: boolean) => `px-3 py-2 rounded-lg border text-sm ${on ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-gray-700 border-gray-300'}`

type Props = {
  sump: SumpRow
  photos: PhotoRow[]
  locked: boolean
  saveAction: (formData: FormData) => Promise<void>
  deleteAction: () => Promise<void>
  photosAction: (formData: FormData) => Promise<void>
  deletePhotoAction: (photoId: string) => Promise<void>
}

/** One sump of the survey: the ICON worksheet as taps and dropdowns, then the photos for that sump. Saves as one form. */
export function SurveySumpCard({ sump, photos, locked, saveAction, deleteAction, photosAction, deletePhotoAction }: Props) {
  const [entries, setEntries] = useState<SurveyEntry[]>(sump.entries?.length ? sump.entries : [{ kind: 'P', n: 1, fitting: null, bolts: null, pipe: null, od: null, notes: null }])
  const [sumpType, setSumpType] = useState<SumpType | ''>(sump.sump_type ?? '')
  const [sumpNumber, setSumpNumber] = useState(sump.sump_number ?? '')
  const [location, setLocation] = useState(sump.location ?? '')
  const [material, setMaterial] = useState(sump.material ?? '')
  const [profile, setProfile] = useState(sump.profile ?? '')
  const [leak, setLeak] = useState<'yes' | 'no' | ''>(sump.active_leak === true ? 'yes' : sump.active_leak === false ? 'no' : '')
  const [worksheets, setWorksheets] = useState<string[]>(sump.worksheets?.length ? sump.worksheets : ['fittings'])
  const [dirty, setDirty] = useState(false)

  const upd = (i: number, patch: Partial<SurveyEntry>) => { setEntries(rows => rows.map((r, j) => (j === i ? { ...r, ...patch } : r))); setDirty(true) }
  const add = (kind: EntryKind) => {
    const max = ENTRY_KINDS.find(k => k.kind === kind)!.max
    const n = entries.filter(e => e.kind === kind).length + 1
    if (n > max) return
    setEntries(rows => [...rows, { kind, n, fitting: null, bolts: null, pipe: null, od: null, notes: null }]); setDirty(true)
  }
  const remove = (i: number) => { const k = entries[i].kind; setEntries(rows => rows.filter((_, j) => j !== i).map(r => r)); setDirty(true); void k }
  const toggleWs = (w: string) => { setWorksheets(ws => (ws.includes(w) ? ws.filter(x => x !== w) : [...ws, w])); setDirty(true) }
  const refs = entries.map(entryRef)

  return (
    <div className="rp-card overflow-hidden">
      <form action={async fd => { await saveAction(fd); setDirty(false) }} className="p-4 space-y-4">
        <input type="hidden" name="entries" value={JSON.stringify(entries)} />
        <input type="hidden" name="location" value={location} /><input type="hidden" name="material" value={material} /><input type="hidden" name="profile" value={profile} /><input type="hidden" name="active_leak" value={leak} />
        {worksheets.map(w => <input key={w} type="hidden" name="worksheets" value={w} />)}

        <div className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="sump_type" value={sumpType} /><input type="hidden" name="sump_number" value={sumpNumber} />
          <div className="w-44">
            <label className={lbl}>Sump type</label>
            <select value={sumpType} disabled={locked} onChange={ev => { const v = ev.target.value as SumpType | ''; setSumpType(v); setSumpNumber(''); const loc = SUMP_TYPES.find(t => t.value === v)?.location; if (loc) setLocation(loc); setDirty(true) }} className={sel}>
              <option value="">—</option>{SUMP_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="w-40">
            <label className={lbl}>{SUMP_TYPES.find(t => t.value === sumpType)?.prompt ?? 'Number'}</label>
            <input list={`nums-${sump.id}`} value={sumpNumber} disabled={locked || !sumpType} onChange={ev => { setSumpNumber(ev.target.value); setDirty(true) }} placeholder={sumpType === 'udc' ? '3/4' : sumpType === 'stp' ? 'RUL' : 'Vent sump'} className={inp} />
            <datalist id={`nums-${sump.id}`}>{(SUMP_TYPES.find(t => t.value === sumpType)?.numbers ?? []).map(n => <option key={n} value={n} />)}</datalist>
          </div>
          <div className="flex-1 min-w-[8rem] text-sm font-semibold text-gray-800 pb-2">{composeSumpLabel(sumpType || null, sumpNumber)}</div>
          {!locked && <button type="button" onClick={() => { if (confirm('Remove this sump and its rows?')) void deleteAction() }} className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:bg-red-50" title="Remove sump"><Trash2 className="w-4 h-4" /></button>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className={lbl}>Sump type</label><div className="flex gap-2">{SUMP_LOCATIONS.map(o => <button key={o.value} type="button" disabled={locked} onClick={() => { setLocation(o.value); setDirty(true) }} className={chip(location === o.value)}>{o.label}</button>)}</div></div>
          <div><label className={lbl}>Material</label><div className="flex gap-2">{SUMP_MATERIALS.map(o => <button key={o.value} type="button" disabled={locked} onClick={() => { setMaterial(o.value); setDirty(true) }} className={chip(material === o.value)}>{o.label}</button>)}</div></div>
          <div><label className={lbl}>Wall</label><div className="flex gap-2">{SUMP_PROFILES.map(o => <button key={o.value} type="button" disabled={locked} onClick={() => { setProfile(o.value); setDirty(true) }} className={chip(profile === o.value)}>{o.label}</button>)}</div></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={lbl}>Active water leak?</label><div className="flex gap-2"><button type="button" disabled={locked} onClick={() => { setLeak('yes'); setDirty(true) }} className={chip(leak === 'yes')}>Yes</button><button type="button" disabled={locked} onClick={() => { setLeak('no'); setDirty(true) }} className={chip(leak === 'no')}>No</button></div></div>
          <div><label className={lbl}>Worksheets for this sump</label><div className="flex flex-wrap gap-2">{WORKSHEETS.map(w => <button key={w.value} type="button" disabled={locked} onClick={() => toggleWs(w.value)} className={chip(worksheets.includes(w.value))}>{w.label}</button>)}</div></div>
        </div>

        {worksheets.includes('fittings') && ENTRY_KINDS.map(k => {
          const rows = entries.map((e, i) => ({ e, i })).filter(x => x.e.kind === k.kind)
          return (
            <div key={k.kind}>
              <div className="flex items-center justify-between mb-1"><span className="text-sm font-semibold text-gray-800">{k.label}</span>{!locked && rows.length < k.max && <button type="button" onClick={() => add(k.kind)} className="text-xs text-blue-600 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> add {k.kind}{rows.length + 1}</button>}</div>
              {rows.length === 0 && <p className="text-xs text-gray-400">None.</p>}
              <div className="space-y-2">
                {rows.map(({ e, i }) => (
                  <div key={`${e.kind}${e.n}`} className="rounded-lg border border-gray-200 p-2 grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
                    <div className="col-span-2 sm:col-span-1"><span className="text-xs font-bold text-gray-700">{entryRef(e)}</span></div>
                    <div><label className={lbl}>Fitting</label><select disabled={locked} value={e.fitting ?? ''} onChange={ev => upd(i, { fitting: (ev.target.value || null) as SurveyEntry['fitting'] })} className={sel}><option value="">—</option>{FITTINGS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select></div>
                    <div><label className={lbl}># bolts</label><select disabled={locked || e.fitting !== 'bolted'} value={e.bolts ?? ''} onChange={ev => upd(i, { bolts: ev.target.value ? Number(ev.target.value) : null })} className={sel}><option value="">—</option>{BOLT_COUNTS.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
                    <div className="col-span-2 sm:col-span-1"><label className={lbl}>Pipe mfr & size</label><select disabled={locked} value={PIPE_OPTIONS.includes(e.pipe ?? '') ? e.pipe ?? '' : e.pipe ? 'Other' : ''} onChange={ev => upd(i, { pipe: ev.target.value === 'Other' ? (e.pipe && !PIPE_OPTIONS.includes(e.pipe) ? e.pipe : 'Other') : ev.target.value || null })} className={sel}><option value="">—</option>{PIPE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}</select>{(e.pipe === 'Other' || (e.pipe && !PIPE_OPTIONS.includes(e.pipe))) && <input disabled={locked} placeholder="what pipe" value={e.pipe === 'Other' ? '' : e.pipe ?? ''} onChange={ev => upd(i, { pipe: ev.target.value || 'Other' })} className={`${inp} mt-1`} />}</div>
                    <div><label className={lbl}>Pipe OD</label><select disabled={locked} value={e.od ?? ''} onChange={ev => upd(i, { od: ev.target.value || null })} className={sel}><option value="">—</option>{OD_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}</select></div>
                    <div className="col-span-2 sm:col-span-1 flex items-end gap-1"><div className="flex-1"><label className={lbl}>Notes</label><input disabled={locked} list={`notes-${sump.id}`} value={e.notes ?? ''} onChange={ev => upd(i, { notes: ev.target.value || null })} className={inp} placeholder="angled, offset, no fitting…" /></div>{!locked && <button type="button" onClick={() => remove(i)} className="p-2 text-gray-400 hover:text-red-600" title="Remove row"><Trash2 className="w-4 h-4" /></button>}</div>
                  </div>
                ))}
              </div>
              <datalist id={`notes-${sump.id}`}>{NOTE_OPTIONS.map(n => <option key={n} value={n} />)}</datalist>
            </div>
          )
        })}

        {worksheets.includes('lid') && (
          <div>
            <span className="text-sm font-semibold text-gray-800">Tank sump lid measurements (inches)</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">{LID_FIELDS.map(f => <div key={f.key}><label className={lbl}>{f.label}</label><input name={`lid_${f.key}`} inputMode="decimal" defaultValue={sump.lid?.[f.key] ?? ''} onChange={() => setDirty(true)} disabled={locked} className={inp} /></div>)}</div>
          </div>
        )}
        {worksheets.includes('damage') && (
          <div><label className={lbl}>Structural damage: description and general measurements (crack, puncture, hole, seam)</label><textarea name="damage" rows={3} defaultValue={sump.damage ?? ''} onChange={() => setDirty(true)} disabled={locked} className={inp} /></div>
        )}
        <div><label className={lbl}>Tech notes for this sump</label><textarea name="notes" rows={2} defaultValue={sump.notes ?? ''} onChange={() => setDirty(true)} disabled={locked} className={inp} placeholder="anything ICON should know" /></div>
        {!locked && <button className={`w-full rounded-lg py-2.5 text-sm font-semibold ${dirty ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-gray-100 text-gray-500'}`}>{dirty ? 'Save this sump' : 'Saved'}</button>}
      </form>

      <div className="border-t border-gray-100 bg-gray-50/60 p-4 space-y-3">
        <div className="flex items-center justify-between"><span className="text-sm font-semibold text-gray-800">Photos · {photos.length}</span></div>
        {photos.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {photos.map(ph => (
              <div key={ph.id} className="relative group">
                <a href={`/api/construction/survey-photos/${ph.id}`} target="_blank" rel="noopener"><img src={`/api/construction/survey-photos/${ph.id}`} alt={ph.caption ?? ''} className="w-full aspect-square object-cover rounded-lg border border-gray-200" loading="lazy" /></a>
                <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 text-white rounded px-1">{[ph.entry_ref, ph.caption].filter(Boolean).join(' · ') || 'sump'}</span>
                {!locked && <button type="button" onClick={() => { if (confirm('Delete this photo?')) void deletePhotoAction(ph.id) }} className="absolute top-1 right-1 bg-card/90 rounded-full p-1 text-gray-500 hover:text-red-600 opacity-0 group-hover:opacity-100" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>}
              </div>
            ))}
          </div>
        )}
        {!locked && (
          <form action={photosAction} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
            <div><label className={lbl}>For entry</label><select name="entry_ref" className={sel}><option value="">whole sump</option>{refs.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
            <div className="sm:col-span-2"><label className={lbl}>Caption</label><input name="caption" className={inp} placeholder="top view, boot, pipe OD…" /></div>
            <div className="flex gap-2">
              <label className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-semibold cursor-pointer hover:bg-primary/90"><Camera className="w-4 h-4" /> Camera<input type="file" name="photos" accept="image/*" capture="environment" multiple className="hidden" onChange={ev => ev.currentTarget.form?.requestSubmit()} /></label>
              <label className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-card px-3 py-2.5 text-sm cursor-pointer hover:bg-gray-50">Roll<input type="file" name="photos" accept="image/*" multiple className="hidden" onChange={ev => ev.currentTarget.form?.requestSubmit()} /></label>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
