import { money } from '@/lib/billing'
import { computeRev19, categoryMeta, faceLineRows, PRICE_FLAG_LABEL, type Rev19Inputs, type Rev19LineInput } from '@/lib/rev19'

/** Read-only rendering of the REV19 face + roll-up (what the PDF prints), for the detail page. */
export function DocFace({ kind, items, inputs, starting }: { kind: 'quote' | 'invoice'; items: Rev19LineInput[]; inputs: Rev19Inputs; starting: boolean }) {
  const { lines, totals } = computeRev19(items, inputs)
  const flagged = lines.filter(l => l.price_flag && l.price_flag !== 'ok')
  const th = 'px-3 py-2 text-[11px] font-medium text-gray-500 uppercase tracking-wide'
  return (
    <div className="space-y-4">
      {starting && <div className="rounded-lg bg-pink-50 border border-pink-200 px-4 py-2 text-xs text-pink-900 font-medium">STARTING QUOTE — not a final quote until the signer reviews and finalizes it.</div>}
      {(['basic', 'additional'] as const).map(s => totals[s].rows.length > 0 && (
        <div key={s} className="rp-card overflow-hidden">
          <h3 className="px-4 py-2.5 bg-blue-700 text-white text-sm font-semibold">{s === 'basic' ? 'BASIC INSTALLATION' : 'ADDITIONAL SCOPE OF WORK'}</h3>
          <div className="overflow-x-auto"><table className="rp-table w-full text-sm">
            <thead><tr className="bg-gray-50"><th className={`${th} text-left w-8`}>#</th><th className={`${th} text-left`}>Description</th><th className={`${th} text-right`}>Quantity</th><th className={`${th} text-right`}>Unit cost</th><th className={`${th} text-right`}>Material</th><th className={`${th} text-right`}>Labor hours</th><th className={`${th} text-right`}>Labor rate</th><th className={`${th} text-right`}>Total labor</th><th className={`${th} text-right`}>Total material &amp; labor</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {faceLineRows(lines, s, inputs).map(r => r.header
                ? <tr key={r.no} className="bg-orange-100/40"><td className="px-3 py-1.5 text-gray-400">{r.no}</td><td colSpan={8} className="px-3 py-1.5 font-semibold text-gray-900">{r.desc}</td></tr>
                : <tr key={r.no} className={r.flag && r.flag !== 'ok' ? 'bg-pink-50' : ''}><td className="px-3 py-2 text-gray-400">{r.no}</td><td className="px-3 py-2 text-gray-900">{r.desc}</td><td className="px-3 py-2 text-right tabular-nums">{r.qty ?? ''}</td><td className="px-3 py-2 text-right tabular-nums">{r.unit != null ? money(r.unit) : ''}</td><td className="px-3 py-2 text-right tabular-nums">{r.material ? money(r.material) : '$ -'}</td><td className="px-3 py-2 text-right tabular-nums">{r.hours ?? 0}</td><td className="px-3 py-2 text-right tabular-nums">{r.rate != null ? money(r.rate) : '$ -'}</td><td className="px-3 py-2 text-right tabular-nums">{r.labor ? money(r.labor) : '$ -'}</td><td className="px-3 py-2 text-right tabular-nums font-semibold">{money(r.total)}</td></tr>)}
              <tr className="bg-gray-50 font-medium"><td colSpan={4} className="px-3 py-2 text-gray-700">Sub Total Material: {money(totals[s].subtotal_material)}</td><td colSpan={4} className="px-3 py-2 text-gray-700">Sub Total Labor: {money(totals[s].subtotal_labor)}</td><td className="px-3 py-2 text-right tabular-nums font-semibold">{money(totals[s].total)}</td></tr>
            </tbody></table></div>
        </div>
      ))}
      <div className="rp-card p-4 text-sm">
        <div className="grid grid-cols-2 gap-y-1 max-w-lg ml-auto">
          <span className="text-gray-500">Taxable materials (1–4)</span><span className="text-right tabular-nums">{money(totals.taxable_material_total)}</span>
          <span className="text-gray-500">Concrete, equipment, subs, disposal, permits</span><span className="text-right tabular-nums">{money(totals.concrete_equipment_total)}</span>
          <span className="text-gray-500">Labor, mobilization, lodging</span><span className="text-right tabular-nums">{money(totals.labor_mobilization_total)}</span>
          <span className="font-medium text-gray-800 border-t border-gray-200 pt-1">Grand total</span><span className="text-right tabular-nums font-medium border-t border-gray-200 pt-1">{money(totals.grand_total)}</span>
          <span className="text-gray-500">Contingency {(inputs.contingency_pct * 100).toFixed(2)}%</span><span className="text-right tabular-nums">{money(totals.contingency_amount)}</span>
          <span className="text-gray-500">Profit &amp; overhead {(inputs.profit_overhead_pct * 100).toFixed(2)}%</span><span className="text-right tabular-nums">{money(totals.profit_overhead_amount)}</span>
          <span className="text-gray-500">Sales tax (material only) {(inputs.sales_tax_pct * 100).toFixed(2)}%</span><span className="text-right tabular-nums">{money(totals.tax_amount)}</span>
          <span className="text-gray-400 text-xs">Project management fee</span><span className="text-right text-xs text-gray-400">NONE</span>
          <span className="font-bold text-blue-700 text-base border-t-2 border-blue-700 pt-1">{kind === 'quote' ? 'Proposal grand total' : 'Invoice grand total'}</span><span className="text-right tabular-nums font-bold text-blue-700 text-base border-t-2 border-blue-700 pt-1">{money(totals.final_total)}</span>
        </div>
      </div>
      {flagged.length > 0 && (
        <div className="rounded-xl border border-pink-200 bg-pink-50 px-4 py-3 text-sm text-pink-900">
          <b>Price gap list — {flagged.length} line{flagged.length === 1 ? '' : 's'} need attention before this goes out</b>
          <ul className="mt-1 text-xs space-y-0.5">{flagged.map((l, i) => <li key={i}>{PRICE_FLAG_LABEL[l.price_flag ?? ''] || l.price_flag}: {categoryMeta(l.category).short} — {l.description || l.part_number}</li>)}</ul>
        </div>
      )}
    </div>
  )
}
