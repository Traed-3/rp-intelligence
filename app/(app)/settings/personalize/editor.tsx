'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { RingLoader } from '@/components/ui/ring-loader'
import { savePrefs } from './actions'

type Row = { key: string; label: string; desc?: string; hidden: boolean; locked?: boolean }
type Choice = { key: string; label: string }

function move<T>(list: T[], i: number, by: number): T[] {
  const j = i + by
  if (j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

const iconBtn = 'inline-flex size-9 items-center justify-center rounded-md border border-border bg-card text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-card'

/** A list you can reorder with the arrows and switch entries on or off. */
function OrderList({ rows, onChange, noun }: { rows: Row[]; onChange: (rows: Row[]) => void; noun: string }) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <li key={r.key} className="rp-item flex items-center gap-3" data-tone={r.hidden ? 'muted' : 'brand'}>
          <div className={cn('min-w-0 flex-1', r.hidden && 'opacity-55')}>
            <div className="rp-item-title">{r.label}</div>
            {r.desc && <div className="rp-item-detail">{r.desc}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" className={iconBtn} disabled={i === 0} onClick={() => onChange(move(rows, i, -1))} aria-label={`Move ${r.label} up`}><ArrowUp className="size-4" /></button>
            <button type="button" className={iconBtn} disabled={i === rows.length - 1} onClick={() => onChange(move(rows, i, 1))} aria-label={`Move ${r.label} down`}><ArrowDown className="size-4" /></button>
            {r.locked ? (
              <span className={cn(iconBtn, 'opacity-50')} title={`${r.label} always stays in the ${noun}`}><Lock className="size-4" /></span>
            ) : (
              <button type="button" role="switch" aria-checked={!r.hidden} aria-label={`Show ${r.label}`}
                className={cn(iconBtn, !r.hidden && 'border-primary bg-primary text-primary-foreground hover:bg-primary/90')}
                onClick={() => onChange(rows.map((x, k) => k === i ? { ...x, hidden: !x.hidden } : x))}>
                {r.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

function SaveBar({ dirty }: { dirty: boolean }) {
  const { pending } = useFormStatus()
  return (
    <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-lg">
      <span className="text-sm text-muted-foreground">{pending ? 'Saving…' : dirty ? 'You have changes that are not saved yet.' : 'Everything is saved.'}</span>
      <div className="flex items-center gap-2">
        <button name="reset" value="1" disabled={pending} className="rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50">Back to standard</button>
        <button disabled={pending || !dirty} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {pending && <RingLoader />}Save
        </button>
      </div>
    </div>
  )
}

export function PersonalizeEditor({ cards: cards0, menu: menu0, tabChoices, tabs: tabs0, standardTabs, maxTabs }: {
  cards: Row[]; menu: Row[]; tabChoices: Choice[]; tabs: string[]; standardTabs: string[]; maxTabs: number
}) {
  const [cards, setCards] = useState(cards0)
  const [menu, setMenu] = useState(menu0)
  const [tabs, setTabs] = useState(tabs0)
  const [dirty, setDirty] = useState(false)
  const touch = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true) }

  const prefs = {
    dashboard: { order: cards.map(c => c.key), hidden: cards.filter(c => c.hidden).map(c => c.key) },
    nav: { order: menu.map(m => m.key), hidden: menu.filter(m => m.hidden).map(m => m.key) },
    tabs,
  }
  const custom = tabs.length > 0
  const label = (k: string) => tabChoices.find(c => c.key === k)?.label ?? k
  const toggleTab = (k: string) => touch(setTabs)(tabs.includes(k) ? tabs.filter(t => t !== k) : tabs.length < maxTabs ? [...tabs, k] : tabs)

  return (
    <form action={async fd => { await savePrefs(fd); setDirty(false); if (fd.get('reset')) window.location.reload() }} className="space-y-8">
      <input type="hidden" name="prefs" value={JSON.stringify(prefs)} />

      <section className="space-y-3">
        <div>
          <h2>Dashboard cards</h2>
          <p className="rp-subtitle">Switch a card off to take it off your dashboard. Use the arrows to put the ones you check first at the top.</p>
        </div>
        {cards.length ? <OrderList rows={cards} onChange={touch(setCards)} noun="dashboard" /> : <p className="rp-empty">No dashboard cards are available for your role.</p>}
      </section>

      <section className="space-y-3">
        <div>
          <h2>Side menu</h2>
          <p className="rp-subtitle">Hide the sections you never use and reorder the rest. A hidden section is not locked: you can still open it from a link, and you can bring it back here any time.</p>
        </div>
        <OrderList rows={menu} onChange={touch(setMenu)} noun="menu" />
      </section>

      <section className="space-y-3">
        <div>
          <h2>Phone bottom bar</h2>
          <p className="rp-subtitle">Pick up to {maxTabs} buttons for the bar at the bottom of your phone, in the order you tap them. Everything else stays under More.</p>
        </div>
        <div className="rp-card p-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rp-chip" data-on={!custom} onClick={() => touch(setTabs)([])}>Standard bar</button>
            <button type="button" className="rp-chip" data-on={custom} onClick={() => { if (!custom) touch(setTabs)(standardTabs.slice(0, maxTabs)) }}>My own buttons</button>
          </div>
          {custom && (
            <>
              <ol className="flex flex-col gap-2">
                {tabs.map((k, i) => (
                  <li key={k} className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                    <span className="min-w-0 flex-1 font-semibold text-sm">{label(k)}</span>
                    <button type="button" className={iconBtn} disabled={i === 0} onClick={() => touch(setTabs)(move(tabs, i, -1))} aria-label={`Move ${label(k)} left`}><ArrowUp className="size-4" /></button>
                    <button type="button" className={iconBtn} disabled={i === tabs.length - 1} onClick={() => touch(setTabs)(move(tabs, i, 1))} aria-label={`Move ${label(k)} right`}><ArrowDown className="size-4" /></button>
                  </li>
                ))}
              </ol>
              <div>
                <p className="rp-label mb-2">Tap to add or remove ({tabs.length} of {maxTabs})</p>
                <div className="flex flex-wrap gap-2">
                  {tabChoices.map(c => {
                    const on = tabs.includes(c.key)
                    return <button key={c.key} type="button" className="rp-chip disabled:opacity-40" data-on={on} disabled={!on && tabs.length >= maxTabs} onClick={() => toggleTab(c.key)}>{c.label}</button>
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      <SaveBar dirty={dirty} />
    </form>
  )
}
