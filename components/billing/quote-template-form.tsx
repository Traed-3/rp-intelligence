'use client'

import { useActionState, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { REV19_CATEGORIES } from '@/lib/rev19'
import type { ActionState } from '@/app/(app)/billing/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

// Trae's starting list — the datalist just makes these easy to pick again;
// typing anything else is fine, the category list is meant to grow.
export const TEMPLATE_CATEGORY_SUGGESTIONS = [
  'FL100 Replacements', 'Entry Boot Replacements', 'Product Line Replacements',
  'Tank Top / Dispenser Pad Remodel', 'Dispenser Replacement', 'Tank Top Replacement',
  'Spill Bucket Replacement', 'Compliance Failure Repairs', 'Drop Tube Replacements',
]

// The brands a note can be written for — matches classifySite()'s brand
// vocabulary so the right note surfaces automatically once a site is picked.
const BRANDS = ['7-Eleven', 'Sunoco', 'Sheetz', 'Wawa', 'Global', 'Capital Petroleum', 'Independent']

export type TemplateScopeRow = { scope: string; description: string }
export type TemplateLineRow = { section: 'basic' | 'additional'; category: number; description: string }

export type QuoteTemplateRecord = {
  id: string
  name: string
  category: string | null
  description: string | null
  department: string | null
  scope_rows: TemplateScopeRow[] | null
  lines: TemplateLineRow[] | null
  exclusions: string | null
  warranty_line: string | null
  notes_by_brand: Record<string, string> | null
  is_active: boolean | null
}

export function QuoteTemplateForm({
  action,
  template,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  template?: QuoteTemplateRecord
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const t = template

  const [scopeRows, setScopeRows] = useState<TemplateScopeRow[]>(t?.scope_rows?.length ? t.scope_rows : [{ scope: '', description: '' }])
  const [lines, setLines] = useState<TemplateLineRow[]>(t?.lines?.length ? t.lines : [])
  const [notesByBrand, setNotesByBrand] = useState<{ brand: string; note: string }[]>(
    t?.notes_by_brand && Object.keys(t.notes_by_brand).length
      ? Object.entries(t.notes_by_brand).map(([brand, note]) => ({ brand, note }))
      : []
  )

  return (
    <form action={formAction} className="space-y-6">
      {state?.error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>}
      <input type="hidden" name="scope_rows_json" value={JSON.stringify(scopeRows.filter(r => r.scope || r.description))} />
      <input type="hidden" name="lines_json" value={JSON.stringify(lines.filter(l => l.description))} />
      <input type="hidden" name="notes_by_brand_json" value={JSON.stringify(Object.fromEntries(notesByBrand.filter(n => n.brand && n.note).map(n => [n.brand, n.note])))} />

      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">Template</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Name <span className="text-red-500">*</span></label>
            <input name="name" className={inp} defaultValue={t?.name ?? ''} placeholder="Product Line Replacement" required />
          </div>
          <div>
            <label className={lbl}>Category</label>
            <input name="category" list="template-categories" className={inp} defaultValue={t?.category ?? ''} placeholder="Pick one or type your own" />
            <datalist id="template-categories">{TEMPLATE_CATEGORY_SUGGESTIONS.map(c => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>Description</label>
            <input name="description" className={inp} defaultValue={t?.description ?? ''} placeholder="One line — when to use this template" />
          </div>
          <div>
            <label className={lbl}>Department</label>
            <select name="department" className={inp} defaultValue={t?.department ?? 'construction'}>
              <option value="construction">Construction</option>
              <option value="service">Service</option>
            </select>
          </div>
          <div className="flex items-center pt-6">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="is_active" defaultChecked={t?.is_active !== false} />
              Active (selectable on New Quote)
            </label>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-1 pb-2 border-b border-gray-100">Scope of Work</h2>
        <p className="text-xs text-gray-500 mb-3">The SCOPE / DESCRIPTION rows a quote starting from this template opens with.</p>
        <div className="space-y-2">
          {scopeRows.map((r, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-start">
              <input
                className={`${inp} sm:col-span-2`} placeholder="SCOPE (e.g. PRODUCT LINE REPLACEMENT)"
                value={r.scope} onChange={e => setScopeRows(rows => rows.map((x, j) => (j === i ? { ...x, scope: e.target.value } : x)))}
              />
              <textarea
                className={`${inp} sm:col-span-2`} rows={2} placeholder="DESCRIPTION OF WORK in RPS voice"
                value={r.description} onChange={e => setScopeRows(rows => rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
              />
              <button type="button" onClick={() => setScopeRows(rows => rows.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600 p-2" aria-label="Remove row"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setScopeRows(rows => [...rows, { scope: '', description: '' }])} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800">
          <Plus className="w-3.5 h-3.5" />Add scope row
        </button>
      </section>

      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-1 pb-2 border-b border-gray-100">Suggested Line Items</h2>
        <p className="text-xs text-gray-500 mb-3">A checklist, not priced lines — no cost or quantity, so nothing goes stale. The real quote picks the actual part and price from the catalog.</p>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-start">
              <select
                className={`${inp} sm:col-span-2`} value={l.category}
                onChange={e => setLines(ls => ls.map((x, j) => (j === i ? { ...x, category: Number(e.target.value) } : x)))}
              >
                {REV19_CATEGORIES.map(c => <option key={c.n} value={c.n}>{c.n}. {c.short}</option>)}
              </select>
              <select
                className={inp} value={l.section}
                onChange={e => setLines(ls => ls.map((x, j) => (j === i ? { ...x, section: e.target.value as 'basic' | 'additional' } : x)))}
              >
                <option value="basic">Basic</option>
                <option value="additional">Additional</option>
              </select>
              <input
                className={`${inp} sm:col-span-2`} placeholder="Description"
                value={l.description} onChange={e => setLines(ls => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
              />
              <button type="button" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600 p-2" aria-label="Remove line"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setLines(ls => [...ls, { section: 'basic', category: 4, description: '' }])} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800">
          <Plus className="w-3.5 h-3.5" />Add line
        </button>
      </section>

      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-1 pb-2 border-b border-gray-100">Notes by Brand</h2>
        <p className="text-xs text-gray-500 mb-3">The small differences between customers — e.g. Sunoco has RPS remove the hydro-testing water; 7-Eleven has their own environmental company remove the DOT barrels. Shows automatically once that brand's site is picked.</p>
        <div className="space-y-2">
          {notesByBrand.map((n, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-start">
              <select
                className={inp} value={n.brand}
                onChange={e => setNotesByBrand(ns => ns.map((x, j) => (j === i ? { ...x, brand: e.target.value } : x)))}
              >
                <option value="">— pick a brand —</option>
                {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <textarea
                className={`${inp} sm:col-span-3`} rows={2} placeholder="e.g. Their environmental company removes the DOT barrels — do not include barrel disposal."
                value={n.note} onChange={e => setNotesByBrand(ns => ns.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))}
              />
              <button type="button" onClick={() => setNotesByBrand(ns => ns.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600 p-2" aria-label="Remove note"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setNotesByBrand(ns => [...ns, { brand: '', note: '' }])} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800">
          <Plus className="w-3.5 h-3.5" />Add brand note
        </button>
      </section>

      <section>
        <h2 className="text-base font-semibold text-gray-900 mb-4 pb-2 border-b border-gray-100">Exclusions &amp; Warranty</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Exclusions</label>
            <textarea name="exclusions" rows={2} className={inp} defaultValue={t?.exclusions ?? ''} placeholder="Ground water removal is not included. Contaminated soil is not included." />
          </div>
          <div>
            <label className={lbl}>Warranty line</label>
            <textarea name="warranty_line" rows={2} className={inp} defaultValue={t?.warranty_line ?? ''} />
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={isPending}>{isPending ? 'Saving…' : t ? 'Save Changes' : 'Create Template'}</Button>
        <a href="/billing/quotes/templates" className="text-sm text-gray-500 hover:text-gray-700">Cancel</a>
      </div>
    </form>
  )
}
