/**
 * Material lists carried on a My Plate row (action.materials), shown on the row itself so they can be
 * reviewed without opening a file. One collapsible block per site, grouped by vendor.
 */
export type MaterialItem = { pn?: string; desc: string; qty: number; unit?: string; cost?: number; src?: string }
export type MaterialGroup = { vendor: string; subtotal?: number; items: MaterialItem[] }
export type MaterialList = { site: string; address?: string; basis?: string; status?: string; prepared?: string; total?: number; groups: MaterialGroup[]; checks?: string[] }

export function materialLists(action: Record<string, unknown> | null): MaterialList[] {
  const v = (action as { materials?: unknown } | null)?.materials
  return Array.isArray(v) ? (v as MaterialList[]).filter(m => m && typeof m.site === 'string' && Array.isArray(m.groups)) : []
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const unitCost = (n: number) => n < 1 ? `$${n.toFixed(3)}` : usd(n)

export function MaterialLists({ lists }: { lists: MaterialList[] }) {
  if (!lists.length) return null
  return (
    <div className="space-y-1.5 pt-0.5 min-w-0 max-w-full">
      {lists.map(m => {
        const lines = m.groups.reduce((n, g) => n + g.items.length, 0)
        const total = m.total ?? m.groups.reduce((n, g) => n + g.items.reduce((s, i) => s + i.qty * (i.cost ?? 0), 0), 0)
        return (
          <details key={m.site} className="group/mat rounded-md border border-border bg-card min-w-0 max-w-full overflow-hidden">
            <summary className="cursor-pointer list-none select-none flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2.5 py-1.5 text-[13px]">
              <span className="inline-block text-blue-700 transition-transform group-open/mat:rotate-90">▸</span>
              <span className="font-semibold text-foreground">{m.site} material list</span>
              <span className="text-muted-foreground">{lines} lines · {usd(total)} cost</span>
              {m.checks?.length ? <span className="px-1.5 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-800 text-[11px]">{m.checks.length} to check</span> : null}
            </summary>
            <div className="border-t border-border px-2.5 py-2 space-y-2.5 text-[12.5px]">
              <div className="text-muted-foreground leading-snug">
                {m.address && <div>{m.address}</div>}
                {m.basis && <div>Quantities from: {m.basis}</div>}
                {m.status && <div>{m.status}</div>}
              </div>
              {m.checks?.length ? (
                <div className="rounded-md border border-amber-200 bg-amber-50/70 px-2.5 py-1.5">
                  <div className="font-semibold text-amber-900">Check before ordering</div>
                  <ul className="list-disc pl-4 mt-0.5 space-y-0.5 text-amber-950">{m.checks.map((c, i) => <li key={i}>{c}</li>)}</ul>
                </div>
              ) : null}
              {m.groups.map(g => {
                const sub = g.subtotal ?? g.items.reduce((s, i) => s + i.qty * (i.cost ?? 0), 0)
                return (
                  <div key={g.vendor} className="rounded-md border border-border overflow-hidden">
                    <div className="flex items-center justify-between gap-2 bg-slate-800 text-white px-2 py-1 font-semibold">
                      <span className="min-w-0 [overflow-wrap:anywhere]">{g.vendor}</span><span className="tabular-nums shrink-0">{usd(sub)}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[34rem] border-collapse">
                        <thead>
                          <tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-muted-foreground text-left">
                            <th className="px-2 py-1 font-semibold">Part #</th><th className="px-2 py-1 font-semibold">Description</th>
                            <th className="px-2 py-1 font-semibold text-right">Qty</th><th className="px-2 py-1 font-semibold text-right">Unit cost</th>
                            <th className="px-2 py-1 font-semibold text-right">Ext</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.items.map((i, k) => (
                            <tr key={k} className="border-t border-border align-top">
                              <td className="px-2 py-1 font-mono text-[11.5px] whitespace-nowrap">{i.pn && i.pn !== '-' ? i.pn : ''}</td>
                              <td className="px-2 py-1">{i.desc}{i.src && <div className="text-[11px] text-muted-foreground">{i.src}</div>}</td>
                              <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{i.qty.toLocaleString('en-US')} {i.unit}</td>
                              <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{i.cost != null ? unitCost(i.cost) : ''}</td>
                              <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{i.cost != null ? usd(i.qty * i.cost) : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
              <div className="text-right font-semibold text-foreground">Estimated material cost: {usd(total)}</div>
            </div>
          </details>
        )
      })}
    </div>
  )
}
