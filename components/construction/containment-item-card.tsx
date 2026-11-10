'use client'

import { useState, useTransition } from 'react'
import { Trash2, Check } from 'lucide-react'
import { type ItemRow, type TestState, type ItemKind, ITEM_KINDS, METHODS, INSTALL_TYPES, isBucket, itemTitle, fillRule, thresholdFor, computeChange } from '@/lib/containment-test'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white disabled:bg-gray-50'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'
const chip = (on: boolean, tone: 'blue' | 'green' | 'red' = 'blue') => `px-3 py-2 rounded-lg border text-sm font-medium ${on ? (tone === 'green' ? 'bg-emerald-600 text-white border-emerald-600' : tone === 'red' ? 'bg-red-600 text-white border-red-600' : 'bg-blue-600 text-white border-blue-600') : 'bg-white text-gray-700 border-gray-300'}`

type Props = { item: ItemRow; state: TestState; lowLevel: boolean; locked: boolean; saveAction: (fd: FormData) => Promise<void>; deleteAction: () => Promise<void> }

/** Tap-choice row that posts its value through a hidden input. */
function Choice({ name, value, set, opts, locked, tone }: { name: string; value: string; set: (v: string) => void; opts: { value: string; label: string; tone?: 'green' | 'red' }[]; locked: boolean; tone?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <input type="hidden" name={name} value={value} />
      {opts.map(o => <button key={o.value} type="button" disabled={locked} onClick={() => set(value === o.value ? '' : o.value)} className={chip(value === o.value, tone ? o.tone : 'blue')}>{o.label}</button>)}
    </div>
  )
}
const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
const YES_NO_NA = [...YES_NO, { value: 'na', label: 'N/A' }]
const b2s = (v: boolean | null) => (v === true ? 'yes' : v === false ? 'no' : '')

/** One spill bucket or sump: the rows the state's form asks for, as taps and short text boxes. Saves as one form. */
export function ContainmentItemCard({ item, state, lowLevel, locked, saveAction, deleteAction }: Props) {
  const [kind, setKind] = useState<ItemKind>(item.kind)
  const [label, setLabel] = useState(item.label ?? '')
  const [method, setMethod] = useState(item.method ?? 'hydrostatic')
  const [construction, setConstruction] = useState(item.construction ?? '')
  const [installType, setInstallType] = useState(item.install_type ?? '')
  const [material, setMaterial] = useState(item.material ?? '')
  const [visual, setVisual] = useState(item.visual ?? '')
  const [debris, setDebris] = useState(b2s(item.debris_removed))
  const [riserCap, setRiserCap] = useState(item.riser_cap ?? '')
  const [drainValve, setDrainValve] = useState(item.drain_valve ?? '')
  const [sensorRestored, setSensorRestored] = useState(item.sensor_restored ?? '')
  const [sensorLow, setSensorLow] = useState(b2s(item.sensor_low))
  const [sensorAlarmed, setSensorAlarmed] = useState(b2s(item.sensor_alarmed))
  const [sensorShutoff, setSensorShutoff] = useState(item.sensor_shutoff ?? '')
  const [result, setResult] = useState(item.result ?? '')
  const [startReading, setStartReading] = useState(item.start_reading ?? '')
  const [endReading, setEndReading] = useState(item.end_reading ?? '')
  const [change, setChange] = useState(item.level_change ?? '')
  const [threshold, setThreshold] = useState(item.threshold ?? thresholdFor(state, item.kind, item.method))
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const bucket = isBucket(kind)
  const kinfo = ITEM_KINDS.find(k => k.value === kind)
  const d = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setDirty(true); setSaved(false) }
  const autoChange = computeChange(startReading, endReading)
  const nowTime = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  return (
    <div className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${result === 'fail' ? 'border-red-300' : result === 'pass' ? 'border-emerald-300' : 'border-gray-200'}`}>
      <form action={fd => start(async () => { setErr(null); try { await saveAction(fd); setDirty(false); setSaved(true) } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed') } })} className="p-4 space-y-4">
        <input type="hidden" name="kind" value={kind} />
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-52"><label className={lbl}>What is being tested</label>
            <select value={kind} disabled={locked} onChange={e => { const k = e.target.value as ItemKind; setKind(k); setThreshold(thresholdFor(state, k, method)); setDirty(true) }} className={inp}>{ITEM_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
          </div>
          <div className="w-36"><label className={lbl}>{kind === 'udc' ? 'Dispenser #' : bucket || kind === 'stp' ? 'Tank / product' : 'Sump ID'}</label>
            <input name="label" list={`n-${item.id}`} value={label} disabled={locked} onChange={e => d(setLabel)(e.target.value)} className={inp} /><datalist id={`n-${item.id}`}>{(kinfo?.numbers ?? []).map(n => <option key={n} value={n} />)}</datalist>
          </div>
          <div className="flex-1 min-w-[8rem] pb-2 text-sm font-semibold text-gray-900">{itemTitle({ kind, label, kind_other: item.kind_other })}</div>
          {!locked && <button type="button" onClick={() => { if (confirm('Remove this item from the test?')) start(() => deleteAction()) }} className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-red-600 hover:bg-red-50" title="Remove"><Trash2 className="w-4 h-4" /></button>}
        </div>
        {kind === 'other' && <div><label className={lbl}>Describe the sump</label><input name="kind_other" defaultValue={item.kind_other ?? ''} disabled={locked} onChange={() => setDirty(true)} className={inp} /></div>}

        <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{fillRule(state, kind)}</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={lbl}>Test method</label><Choice name="method" value={method} set={d((v: string) => { setMethod(v as typeof method); setThreshold(thresholdFor(state, kind, v)) })} opts={METHODS.filter(m => state === 'WV' || m.value !== 'pressure').map(m => ({ value: m.value, label: m.label }))} locked={locked} /></div>
          <div><label className={lbl}>Construction</label><Choice name="construction" value={construction} set={d(setConstruction)} opts={[{ value: 'sw', label: 'Single-wall' }, { value: 'dw', label: 'Double-wall' }]} locked={locked} /></div>
        </div>

        {/* What each state's form asks about the item itself */}
        {state !== 'MD' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><label className={lbl}>{bucket ? 'Bucket depth' : 'Sump depth (in)'}</label><input name="depth" defaultValue={item.depth ?? ''} disabled={locked} onChange={() => setDirty(true)} placeholder={bucket ? '12"' : '40"'} className={inp} /></div>
            {!bucket && <div><label className={lbl}>Height to top penetration</label><input name="penetration_height" defaultValue={item.penetration_height ?? ''} disabled={locked} onChange={() => setDirty(true)} placeholder='18"' className={inp} /></div>}
            <div><label className={lbl}>Wait before start (min)</label><input name="wait_minutes" inputMode="numeric" defaultValue={item.wait_minutes ?? ''} disabled={locked} onChange={() => setDirty(true)} placeholder="15" className={inp} /></div>
            {state === 'VA' && bucket && <div><label className={lbl}>Tank size</label><input name="tank_size" defaultValue={item.tank_size ?? ''} disabled={locked} onChange={() => setDirty(true)} placeholder="10,000 gal" className={inp} /></div>}
          </div>
        )}
        {(state === 'MD' || (state === 'VA' && bucket) || (state === 'WV' && !bucket)) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={lbl}>Product</label><input name="product" defaultValue={item.product ?? ''} disabled={locked} onChange={() => setDirty(true)} placeholder="Regular" className={inp} /></div>
            {state === 'VA' && bucket && <div><label className={lbl}>Bucket manufacturer / model</label><input name="manufacturer" defaultValue={item.manufacturer ?? ''} disabled={locked} onChange={() => setDirty(true)} placeholder="OPW 1-2100" className={inp} /></div>}
          </div>
        )}
        {state === 'VA' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {bucket
              ? <div><label className={lbl}>Installation</label><Choice name="install_type" value={installType} set={d(setInstallType)} opts={INSTALL_TYPES.map(o => ({ value: o.value, label: o.label }))} locked={locked} /></div>
              : <div><label className={lbl}>Sump material</label><Choice name="material" value={material} set={d(setMaterial)} opts={[{ value: 'frp', label: 'FRP' }, { value: 'plastic', label: 'Plastic' }]} locked={locked} /></div>}
            <div><label className={lbl}>Liquid & debris removed?</label><Choice name="debris_removed" value={debris} set={d(setDebris)} opts={YES_NO} locked={locked} /></div>
            <div><label className={lbl}>Visual inspection (no cracks, loose parts, separation)</label><Choice name="visual" value={visual} set={d(setVisual)} opts={[{ value: 'pass', label: 'Pass', tone: 'green' }, { value: 'fail', label: 'Fail', tone: 'red' }]} locked={locked} tone /></div>
            {bucket && <div><label className={lbl}>Tank riser cap included?</label><Choice name="riser_cap" value={riserCap} set={d(setRiserCap)} opts={YES_NO_NA} locked={locked} /></div>}
            {bucket && <div><label className={lbl}>Drain valve included?</label><Choice name="drain_valve" value={drainValve} set={d(setDrainValve)} opts={YES_NO_NA} locked={locked} /></div>}
            {!bucket && lowLevel && <>
              <div><label className={lbl}>Sensor at lowest point of sump?</label><Choice name="sensor_low" value={sensorLow} set={d(setSensorLow)} opts={YES_NO} locked={locked} /></div>
              <div><label className={lbl}>Sensor alarmed when tested?</label><Choice name="sensor_alarmed" value={sensorAlarmed} set={d(setSensorAlarmed)} opts={YES_NO} locked={locked} /></div>
              <div><label className={lbl}>STP / dispenser shut off on alarm?</label><Choice name="sensor_shutoff" value={sensorShutoff} set={d(setSensorShutoff)} opts={YES_NO_NA} locked={locked} /></div>
              <div><label className={lbl}>Alarm level above sump bottom (in)</label><input name="alarm_level" defaultValue={item.alarm_level ?? ''} disabled={locked} onChange={() => setDirty(true)} className={inp} /></div>
            </>}
          </div>
        )}

        {/* Readings */}
        <div className="rounded-xl border border-gray-200 p-3 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Readings {method === 'vacuum' ? '(" WC)' : method === 'pressure' ? '(psi)' : '(inches)'}</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Start time</label><div className="flex gap-1"><input name="start_time" defaultValue={item.start_time ?? ''} disabled={locked} onChange={() => setDirty(true)} placeholder="10:00 AM" className={inp} id={`st-${item.id}`} />{!locked && <button type="button" onClick={() => { const el = document.getElementById(`st-${item.id}`) as HTMLInputElement; el.value = nowTime(); setDirty(true) }} className="px-2 rounded-lg border border-gray-300 text-xs">Now</button>}</div></div>
            <div><label className={lbl}>Start reading</label><input name="start_reading" value={startReading} disabled={locked} onChange={e => d(setStartReading)(e.target.value)} placeholder={method === 'vacuum' ? '30" WC' : '22"'} className={inp} /></div>
            <div><label className={lbl}>End time</label><div className="flex gap-1"><input name="end_time" defaultValue={item.end_time ?? ''} disabled={locked} onChange={() => setDirty(true)} placeholder="11:00 AM" className={inp} id={`et-${item.id}`} />{!locked && <button type="button" onClick={() => { const el = document.getElementById(`et-${item.id}`) as HTMLInputElement; el.value = nowTime(); setDirty(true) }} className="px-2 rounded-lg border border-gray-300 text-xs">Now</button>}</div></div>
            <div><label className={lbl}>End reading</label><input name="end_reading" value={endReading} disabled={locked} onChange={e => d(setEndReading)(e.target.value)} placeholder={method === 'vacuum' ? '30" WC' : '22"'} className={inp} /></div>
            <div><label className={lbl}>Change {autoChange && !change ? <span className="text-gray-400">(auto: {autoChange})</span> : null}</label><input name="level_change" value={change} disabled={locked} onChange={e => d(setChange)(e.target.value)} placeholder={autoChange ?? '0'} className={inp} /></div>
            {state !== 'MD' && <div><label className={lbl}>Pass/fail threshold</label><input name="threshold" value={threshold} disabled={locked} onChange={e => d(setThreshold)(e.target.value)} className={inp} /></div>}
          </div>
          {state === 'VA' && bucket && construction === 'dw' && (
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
              <div className="col-span-2 text-xs font-semibold text-gray-500">Secondary interstice (vacuum 15&quot; WC)</div>
              <div><label className={lbl}>Begin time</label><input name="ist_start_time" defaultValue={item.ist_start_time ?? ''} disabled={locked} onChange={() => setDirty(true)} className={inp} /></div>
              <div><label className={lbl}>Begin reading</label><input name="ist_start_reading" defaultValue={item.ist_start_reading ?? ''} disabled={locked} onChange={() => setDirty(true)} className={inp} /></div>
              <div><label className={lbl}>End time</label><input name="ist_end_time" defaultValue={item.ist_end_time ?? ''} disabled={locked} onChange={() => setDirty(true)} className={inp} /></div>
              <div><label className={lbl}>End reading</label><input name="ist_end_reading" defaultValue={item.ist_end_reading ?? ''} disabled={locked} onChange={() => setDirty(true)} className={inp} /></div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={lbl}>Test result</label><Choice name="result" value={result} set={d(setResult)} opts={[{ value: 'pass', label: 'PASS', tone: 'green' }, { value: 'fail', label: 'FAIL', tone: 'red' }]} locked={locked} tone /></div>
          {state === 'WV' && !bucket && <div><label className={lbl}>Sump emptied, sensor back on the floor?</label><Choice name="sensor_restored" value={sensorRestored} set={d(setSensorRestored)} opts={YES_NO_NA} locked={locked} /></div>}
          {state === 'MD' && result === 'fail' && <div><label className={lbl}>Reported to MDE (date / time)</label><input name="failure_reported_at" defaultValue={item.failure_reported_at ?? ''} disabled={locked} onChange={() => setDirty(true)} placeholder="11/10/26 2:15 PM" className={inp} /></div>}
        </div>
        {state === 'MD' && result === 'fail' && <p className="text-xs font-semibold text-red-700">MDE must be told about a failed hydrostatic or vacuum test right away, within 2 hours.</p>}
        <div><label className={lbl}>Notes for the comments box (repairs made, follow-up)</label><textarea name="notes" rows={2} defaultValue={item.notes ?? ''} disabled={locked} onChange={() => setDirty(true)} className={inp} /></div>

        {!locked && (
          <div className="flex items-center gap-3">
            <button disabled={pending} className={`rounded-lg px-4 py-2 text-sm font-semibold ${dirty ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700'}`}>{pending ? 'Saving…' : `Save ${itemTitle({ kind, label, kind_other: item.kind_other })}`}</button>
            {saved && !dirty && <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><Check className="w-3.5 h-3.5" />Saved</span>}
            {dirty && <span className="text-xs text-amber-600">Not saved yet</span>}
            {err && <span className="text-xs text-red-600">{err}</span>}
          </div>
        )}
      </form>
    </div>
  )
}
