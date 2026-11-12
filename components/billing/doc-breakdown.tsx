import { money } from '@/lib/billing'
import { computeRev19, REV19_CATEGORIES, type Rev19Inputs, type Rev19LineInput, type Rev19Line } from '@/lib/rev19'
import type { BillingDoc } from '@/lib/billing-pdf'

/** The MATERIAL AND LABOR BREAKDOWN, on screen — the same categories, lines and colours the breakdown PDF prints. */
export function DocBreakdown({ doc, items }: { doc: BillingDoc; items: Rev19LineInput[] }) {
  const { lines, totals } = computeRev19(items, doc.inputs)
  const inp = doc.inputs
  const th = 'px-2 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap'
  const td = 'px-2 py-1.5 align-top'
  const R = `${td} text-right tabular-nums whitespace-nowrap`
  const fill = (l: Rev19Line) => l.price_flag && l.price_flag !== 'ok' ? 'bg-pink-50' : /RECEIPT|QUOTE/i.test(l.source_note ?? '') ? 'bg-green-50' : l.category === 11 ? 'bg-orange-50' : ''
  const pct = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`
  const sections = (['basic', 'additional'] as const).flatMap(section => REV19_CATEGORIES.map(c => ({ section, c, ls: lines.filter(l => l.section === section && l.category === c.n) })).filter(x => x.ls.length))
  if (!sections.length) return null
  return (
    <div className="rp-card overflow-hidden">
      <h3 className="px-4 py-2.5 bg-blue-700 text-white text-sm font-semibold flex items-center justify-between"><span>MATERIAL AND LABOR BREAKDOWN</span><span className="text-xs font-normal text-white/70">what the breakdown PDF prints</span></h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 text-xs border-b border-gray-100">
        <div className="md:col-span-2 rounded-lg border border-gray-200 p-3">
          <div className="text-[10px] font-semibold text-gray-400 uppercase">Inputs</div>
          <div className="text-gray-800">Material markup {pct(inp.material_markup_pct)} · Tax on material {pct(inp.material_tax_pct)} · Sub markup {pct(inp.sub_markup_pct)} · Labor {money(inp.labor_rate)}/hr{doc.laborRateLabel ? ` (${doc.laborRateLabel})` : ''} · Contingency {pct(inp.contingency_pct)} · P&amp;O {pct(inp.profit_overhead_pct)}</div>
          <div className="text-gray-400 mt-1">Categories 1–4: (cost + tax) × (1 + markup) + freight, × qty. Categories 5, 9, 10, 12: cost, markup only where marked. Category 11: cost + {pct(inp.sub_markup_pct, 0)} on the category. <span className="bg-pink-50 px-1">pink</span> = estimate / price needed / held · <span className="bg-green-50 px-1">green</span> = receipt or vendor quote · <span className="bg-orange-50 px-1">orange</span> = subcontractor.</div>
        </div>
        <div className="rounded-lg border border-gray-200 p-3 text-gray-800">
          <div className="text-[10px] font-semibold text-gray-400 uppercase">Team</div>
          <div>Project manager: {doc.projectManager ?? '—'}</div><div>Construction manager: {doc.constructionManager ?? '—'}</div><div>Foreman / lead: {doc.foreman ?? '—'}</div><div>Work order compiled by: {doc.compiledBy ?? '—'}</div>
        </div>
      </div>
      {sections.map(({ section, c, ls }) => {
        const catTotal = totals[section].rows.find(r => r.n === c.n)
        const kind = c.kind
        return (
          <div key={`${section}-${c.n}`} className="border-b border-gray-100 last:border-b-0">
            <div className="px-4 py-2 bg-orange-100 text-sm font-semibold text-gray-900">CATEGORY {c.n} — {c.name}{section === 'additional' ? <span className="ml-2 text-xs font-normal text-gray-600">(ADDITIONAL SCOPE)</span> : null}</div>
            <div className="overflow-x-auto"><table className="rp-table w-full text-xs">
              <thead className="bg-gray-50"><tr>
                {kind === 'material' && <><th className={`${th} text-left`}>Part #</th><th className={`${th} text-left w-full`}>Description</th><th className={`${th} text-right`}>Unit cost</th><th className={`${th} text-right`}>Tax</th><th className={`${th} text-right`}>Markup</th><th className={`${th} text-right`}>Freight</th><th className={`${th} text-right`}>Sell/unit</th><th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>Extended</th><th className={`${th} text-left min-w-[180px]`}>Source</th></>}
                {kind === 'labor' && <><th className={`${th} text-left`}>Day</th><th className={`${th} text-left w-full`}>Scope of work for that day</th><th className={`${th} text-right`}>Rate/hr</th><th className={`${th} text-right`}>Men</th><th className={`${th} text-right`}>Hrs each</th><th className={`${th} text-right`}>Hours</th><th className={`${th} text-right`}>Extended</th><th className={`${th} text-left min-w-[180px]`}>Note</th></>}
                {kind === 'trip' && <><th className={`${th} text-left`}>Trip</th><th className={`${th} text-left w-full`}>Description</th><th className={`${th} text-right`}>Rate</th><th className={`${th} text-right`}>Travel days</th><th className={`${th} text-right`}>Techs</th><th className={`${th} text-right`}>Tech-travel-days</th><th className={`${th} text-right`}>Extended</th></>}
                {(kind === 'costplus' || kind === 'sub' || kind === 'lodging') && <><th className={`${th} text-left w-full`}>Item / description</th><th className={`${th} text-right`}>{kind === 'lodging' ? 'Rate' : 'Unit cost'}</th><th className={`${th} text-right`}>Markup?</th><th className={`${th} text-right`}>Sell/unit</th><th className={`${th} text-right`}>{kind === 'lodging' ? 'Tech-nights' : 'Qty'}</th><th className={`${th} text-right`}>Extended</th><th className={`${th} text-left min-w-[180px]`}>Source</th></>}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {ls.map((l, i) => (
                  <tr key={i} className={fill(l)}>
                    {kind === 'material' && <><td className={`${td} font-mono whitespace-nowrap`}>{l.part_number}</td><td className={td}>{l.description}</td><td className={R}>{money(l.unit_cost ?? 0)}</td><td className={R}>{pct(l.sales_tax_pct ?? inp.material_tax_pct, 1)}</td><td className={R}>{pct(l.markup_pct ?? inp.material_markup_pct, 0)}</td><td className={R}>{l.freight_per_unit ? money(l.freight_per_unit) : ''}</td><td className={R}>{money(l.sell_unit)}</td><td className={R}>{l.quantity_effective}</td><td className={`${R} font-semibold`}>{money(l.material_total)}</td><td className={`${td} text-gray-500`}>{l.source_note}</td></>}
                    {kind === 'labor' && <><td className={`${td} whitespace-nowrap`}>{l.day_label}</td><td className={td}>{l.crew === 'service' ? 'SERVICE TECH — ' : ''}{l.description}</td><td className={R}>{money(l.sell_unit)}</td><td className={R}>{l.men}</td><td className={R}>{l.hrs_each}</td><td className={R}>{l.labor_hours}</td><td className={`${R} font-semibold`}>{money(l.total_labor)}</td><td className={`${td} text-gray-500`}>{l.source_note}</td></>}
                    {kind === 'trip' && <><td className={`${td} whitespace-nowrap`}>{l.day_label}</td><td className={td}>{l.crew === 'service' ? 'SERVICE TECH — ' : ''}{l.description}</td><td className={R}>{money(l.sell_unit)}</td><td className={R}>{l.travel_days}</td><td className={R}>{l.techs}</td><td className={R}>{l.quantity_effective}</td><td className={`${R} font-semibold`}>{money(l.material_total)}</td></>}
                    {(kind === 'costplus' || kind === 'sub' || kind === 'lodging') && <><td className={td}>{[l.part_number, l.description].filter(Boolean).join(' — ')}</td><td className={R}>{money(l.unit_cost ?? 0)}</td><td className={R}>{kind === 'costplus' ? (l.markup_applies ? 'Y' : 'N') : kind === 'sub' ? pct(inp.sub_markup_pct, 0) : ''}</td><td className={R}>{money(l.sell_unit)}</td><td className={R}>{l.quantity_effective}</td><td className={`${R} font-semibold`}>{money(l.material_total)}</td><td className={`${td} text-gray-500`}>{l.source_note}</td></>}
                  </tr>
                ))}
                {c.n === 11 && <tr><td colSpan={5} className={`${td} text-gray-600`}>SUBCONTRACTOR MARKUP {pct(inp.sub_markup_pct, 0)} ON THE LINES ABOVE</td><td className={R}>{money((catTotal?.material ?? 0) - ls.reduce((a, l) => a + l.material_total, 0))}</td><td /></tr>}
                <tr className="bg-gray-100 font-semibold"><td colSpan={kind === 'material' ? 8 : kind === 'labor' ? 6 : kind === 'trip' ? 6 : 5} className={td}>TOTAL CATEGORY {c.n}</td><td className={R}>{money(catTotal?.total ?? 0)}</td><td /></tr>
              </tbody>
            </table></div>
          </div>
        )
      })}
    </div>
  )
}
