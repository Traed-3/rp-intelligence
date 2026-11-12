'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PartPicker, type PickedPart } from '@/components/construction/part-picker'
import { SitePicker, type PickedSite } from '@/components/construction/site-picker'
import { classifySite } from '@/lib/site-number'
import { money } from '@/lib/billing'
import { REV19_CATEGORIES, REV19_DEFAULTS, LABOR_RATES, TAX_PRESETS, PRICE_FLAG_LABEL, TAXABLE_CATS, CONCRETE_EQUIP_CATS, categoryMeta, computeRev19, type Rev19Inputs, type Rev19LineInput } from '@/lib/rev19'
import type { QuickPick } from '@/lib/billing-data'
import { newRow, type Rev19Row } from '@/lib/rev19-rows'
import type { ActionState } from '@/app/(app)/billing/actions'

const inp = 'w-full rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50'
// Number cells carry their own width (w-16/w-20/w-24) — no w-full, or the table squeezes them to nothing.
const numInp = `${inp.replace('w-full ', '')} text-right tabular-nums`
const lbl = 'block text-[11px] font-medium text-gray-600 mb-0.5 uppercase tracking-wide'

export type Rev19Header = {
  id?: string; kind: 'quote' | 'invoice'
  job_id?: string | null; customer_id?: string | null; quote_id?: string | null; service_ticket_id?: string | null
  department?: string | null; status?: string
  attn?: string | null; customer_email?: string | null; store_label?: string | null; site_number?: string | null
  facility_address?: string | null; city_state_zip?: string | null; project_description?: string | null
  csr_number?: string | null; po_number?: string | null; portal_wo_number?: string | null; work_order_number?: string | null
  proposal_date?: string | null; bid_due?: string | null; valid_until?: string | null; nte_amount?: number | null
  invoice_date?: string | null; due_date?: string | null
  project_manager?: string | null; construction_manager?: string | null; foreman?: string | null; compiled_by?: string | null; prepared_by?: string | null; signer_id?: string | null
  rate_card_id?: string | null
  material_markup_pct?: number | null; material_tax_pct?: number | null; sub_markup_pct?: number | null; labor_rate?: number | null
  contingency_pct?: number | null; contingency_flat?: number | null; profit_overhead_percent?: number | null; sales_tax_percent?: number | null
  scope_rows?: { scope: string; description: string }[] | null; exclusions?: string | null; warranty_line?: string | null; is_starting_quote?: boolean | null
}
type Customer = { id: string; name: string; brand?: string | null; rate_card_id?: string | null }
type Job = { id: string; site_number: string | null; work_order_number: string | null }
type RateCard = { id: string; name: string; labor_rate: number; sales_tax_pct: number | null }
type TeamMember = { id: string; full_name: string; job_title: string | null; role: string }

const N = (s: string) => (s === '' ? null : isFinite(Number(s)) ? Number(s) : null)
const toInput = (r: Rev19Row): Rev19LineInput => ({
  section: r.section, category: r.category, description: r.description || null, part_number: r.part_number || null, part_id: r.part_id, subcategory: r.subcategory || null,
  quantity: N(r.quantity), unit_cost: N(r.unit_cost), sales_tax_pct: r.sales_tax_pct === '' ? null : N(r.sales_tax_pct)! / 100, markup_pct: r.markup_pct === '' ? null : N(r.markup_pct)! / 100,
  freight_per_unit: N(r.freight_per_unit), markup_applies: r.markup_applies, men: N(r.men), hrs_each: N(r.hrs_each), labor_rate: N(r.labor_rate), travel_days: N(r.travel_days), techs: N(r.techs),
  day_label: r.day_label || null, crew: r.crew, source_note: r.source_note || null, price_flag: r.price_flag, is_stock: r.is_stock, item_type: r.item_type,
})
const pctStr = (v: number | null | undefined, dflt: number) => String(Math.round(((v ?? dflt) * 100 + Number.EPSILON) * 100) / 100)

/** What a catalog pick writes onto a builder row (shared by the row picker and the quick-add chips). */
function pickPatch(r: Rev19Row, p: PickedPart, kind: string): Partial<Rev19Row> {
  const isMaterial = kind === 'material'
  return {
    description: p.description, part_number: p.part_number ?? '', part_id: p.id, unit_cost: p.unit_cost != null ? String(p.unit_cost) : '', freight_per_unit: p.freight_per_unit ? String(p.freight_per_unit) : '',
    sales_tax_pct: isMaterial && p.taxable === false ? '0' : r.sales_tax_pct, item_type: p.item_type ?? r.item_type,
    source_note: [p.cost_source?.toUpperCase(), p.cost_vendor, p.cost_invoice_ref, p.cost_date ? p.cost_date.slice(0, 10) : null].filter(Boolean).join(' · '),
    price_flag: p.unit_cost == null ? 'price_needed' : p.price_status === 'held_high' ? 'held_high' : p.price_status === 'price_needed' ? 'price_needed' : p.price_status === 'verify' || (p.cost_date && Date.now() - new Date(p.cost_date).getTime() > 183 * 86_400_000) ? 'verify' : 'ok',
  }
}

// The builder lays the twelve categories out the way the face rolls them up.
const CATEGORY_GROUPS: { title: string; hint: string; cats: readonly number[] }[] = [
  { title: 'Taxable materials', hint: 'Categories 1–4 · (cost + tax) × (1 + markup) + freight, × qty. Search the catalog — receipts beat quotes beat book prices.', cats: TAXABLE_CATS },
  { title: 'Concrete · equipment · disposables · subcontractors · permits', hint: 'Categories 5, 9, 10, 11, 12 · open the Add list under each category for the rate-card items (concrete, disposal, equipment, disposables, subs, permits). Subs get 15% on the category.', cats: CONCRETE_EQUIP_CATS },
  { title: 'Labor · mobilization · lodging', hint: 'Categories 7, 8, 6 · labor is one row per day (men × hours × the customer rate); mobilization is $100 per tech per travel day.', cats: [7, 8, 6] },
]

export function Rev19Builder({ action, header, initialLines, customers, jobs, rateCards, team, currentUser, quickPicks = [] }: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  header: Rev19Header; initialLines?: Rev19Row[]; customers: Customer[]; jobs: Job[]; rateCards: RateCard[]; team: TeamMember[]; currentUser: TeamMember | null; quickPicks?: QuickPick[]
}) {
  const [state, formAction, pending] = useActionState(action, null)
  const isQuote = header.kind === 'quote'
  // Who signs: saved signer, else whoever is building the document. Name and title stay editable.
  const savedName = header.prepared_by?.split(',')[0]?.trim() ?? ''
  const savedTitle = header.prepared_by?.split(',').slice(1).join(',').trim() ?? ''
  const [signerId, setSignerId] = useState(header.signer_id ?? (header.prepared_by ? '' : currentUser?.id ?? ''))
  const [signerName, setSignerName] = useState(savedName || currentUser?.full_name || '')
  const [signerTitle, setSignerTitle] = useState(savedTitle || currentUser?.job_title || '')
  function pickSigner(id: string) {
    setSignerId(id)
    const m = team.find(t => t.id === id)
    if (m) { setSignerName(m.full_name); setSignerTitle(m.job_title ?? '') }
  }
  const [dept, setDept] = useState<'construction' | 'service'>(header.department === 'service' ? 'service' : 'construction')
  const [inputs, setInputs] = useState({
    material_markup_pct: pctStr(header.material_markup_pct, REV19_DEFAULTS.material_markup_pct),
    material_tax_pct: pctStr(header.material_tax_pct, REV19_DEFAULTS.material_tax_pct),
    sub_markup_pct: pctStr(header.sub_markup_pct, REV19_DEFAULTS.sub_markup_pct),
    labor_rate: String(header.labor_rate ?? ''),
    contingency_pct: pctStr(header.contingency_pct, 0), contingency_flat: String(header.contingency_flat ?? 0),
    profit_overhead_percent: pctStr(header.profit_overhead_percent, 0), sales_tax_percent: pctStr(header.sales_tax_percent, 0),
  })
  const [rateCardId, setRateCardId] = useState(header.rate_card_id ?? '')
  const [customerId, setCustomerId] = useState(header.customer_id ?? '')
  // Site box: type a site number to search con_sites and autofill the address, or type a brand-new one.
  const [siteNumber, setSiteNumber] = useState(header.site_number ?? header.store_label ?? '')
  const [facilityAddress, setFacilityAddress] = useState(header.facility_address ?? '')
  const [cityStateZip, setCityStateZip] = useState(header.city_state_zip ?? '')
  function pickSite(sIte: PickedSite) {
    if (sIte.site_number) setSiteNumber(sIte.site_number)
    if (sIte.address) setFacilityAddress(sIte.address)
    const csz = [sIte.city, sIte.state].filter(Boolean).join(', ') + (sIte.zip ? ` ${sIte.zip}` : '')
    if (csz.trim()) setCityStateZip(csz.trim())
    applyBrandToCustomer(sIte.store_brand || classifySite(sIte.site_number ?? '').brand)
  }
  /** The brand — and so the customer — is dictated by the site number (a
   * 5-digit number is 7-Eleven, SU-#### is Sunoco, etc.), so pick the matching
   * customer automatically. A manual pick from the Customer dropdown always
   * wins afterward, until the site changes again. */
  function applyBrandToCustomer(brand: string | null) {
    if (!brand) return
    const match = customers.find(c => c.brand && c.brand.toLowerCase() === brand.toLowerCase())
    if (match) pickCustomer(match.id)
  }
  const hasMountedSiteText = useRef(false)
  useEffect(() => {
    if (!hasMountedSiteText.current) { hasMountedSiteText.current = true; return }
    applyBrandToCustomer(classifySite(siteNumber).brand)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteNumber])
  const [scope, setScope] = useState<{ scope: string; description: string }[]>(header.scope_rows?.length ? header.scope_rows : [{ scope: '', description: '' }])
  const [lines, setLines] = useState<Rev19Row[]>(initialLines?.length ? initialLines : [])
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [anyPart, setAnyPart] = useState('')

  const setInp = (k: keyof typeof inputs, v: string) => setInputs(s => ({ ...s, [k]: v }))
  const upd = (key: string, patch: Partial<Rev19Row>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)))
  const del = (key: string) => setLines(ls => ls.filter(l => l.key !== key))
  const add = (section: 'basic' | 'additional', category: number) => { setLines(ls => [...ls, newRow(section, category, dept)]); setOpen(o => ({ ...o, [`${section}-${category}`]: true })) }
  // Crew size and days off the labor rows drive the per-tech defaults (disposables, lodging, mobilization).
  const laborDays = lines.filter(l => l.category === 7 && l.section === 'basic')
  const techDays = laborDays.reduce((a, l) => a + (N(l.men) ?? 0), 0)
  const crewSize = Math.max(0, ...laborDays.map(l => N(l.men) ?? 0))
  /** Add a catalog / rate-card item as a new row in its category, with a sensible quantity. */
  const addPicked = (section: 'basic' | 'additional', category: number, p: PickedPart) => {
    const base = newRow(section, category, dept)
    const perTech = /PER TECH|PER MAN/i.test(p.description)
    const qty = category === 8 ? '' : perTech && techDays ? String(techDays) : base.quantity || '1'
    // Concrete, rebar and backfill carry the 20% markup; disposal / tipping / hauling fees pass through at cost.
    const markup = category === 5 && !/DISPOSAL|TIPPING|HAUL|FEE/i.test(p.description)
    const row: Rev19Row = { ...base, ...pickPatch(base, p, categoryMeta(category).kind), quantity: qty, markup_applies: category === 5 ? markup : false, ...(category === 8 ? { techs: crewSize ? String(crewSize) : base.techs, travel_days: base.travel_days || '2' } : {}) }
    setLines(ls => [...ls, row]); setOpen(o => ({ ...o, [`${section}-${category}`]: true }))
  }
  const addLaborDay = (section: 'basic' | 'additional', crew: 'construction' | 'service') => {
    const n = lines.filter(l => l.section === section && l.category === 7 && l.crew === crew).length + 1
    const last = [...lines].reverse().find(l => l.section === section && l.category === 7 && l.crew === crew)
    const row = { ...newRow(section, 7, crew), day_label: crew === 'service' ? 'SERVICE TECH' : `DAY ${n}`, men: last?.men ?? (crew === 'service' ? '1' : ''), hrs_each: last?.hrs_each ?? '8' }
    setLines(ls => [...ls, row])
  }
  const addTrip = (section: 'basic' | 'additional', crew: 'construction' | 'service') => {
    const n = lines.filter(l => l.section === section && l.category === 8 && l.crew === crew).length + 1
    const row = { ...newRow(section, 8, crew), unit_cost: String(REV19_DEFAULTS.mobilization_rate), day_label: crew === 'service' ? 'SERVICE TECH' : `WEEK ${n}`, description: crew === 'service' ? 'OUT AND BACK' : n === 1 ? 'OUT MONDAY, HOME FRIDAY' : '', travel_days: crew === 'service' ? '1' : '2', techs: crew === 'service' ? '1' : crewSize ? String(crewSize) : '' }
    setLines(ls => [...ls, row])
  }

  function pickCustomer(id: string) {
    setCustomerId(id)
    const c = customers.find(x => x.id === id)
    const rc = c?.rate_card_id ? rateCards.find(r => r.id === c.rate_card_id) : rateCards.find(r => c?.brand && r.name.toLowerCase() === c.brand.toLowerCase())
    if (rc) applyRateCard(rc.id)
  }
  function applyRateCard(id: string) {
    setRateCardId(id)
    const rc = rateCards.find(r => r.id === id)
    if (rc) setInp('labor_rate', String(rc.labor_rate))
  }

  const rev19Inputs: Rev19Inputs = useMemo(() => ({
    material_markup_pct: (N(inputs.material_markup_pct) ?? 20) / 100, material_tax_pct: (N(inputs.material_tax_pct) ?? 5.3) / 100, sub_markup_pct: (N(inputs.sub_markup_pct) ?? 15) / 100,
    labor_rate: N(inputs.labor_rate) ?? 0, contingency_pct: (N(inputs.contingency_pct) ?? 0) / 100, contingency_flat: N(inputs.contingency_flat) ?? 0,
    profit_overhead_pct: (N(inputs.profit_overhead_percent) ?? 0) / 100, sales_tax_pct: (N(inputs.sales_tax_percent) ?? 0) / 100,
  }), [inputs])
  const { lines: computed, totals } = useMemo(() => computeRev19(lines.map(toInput), rev19Inputs), [lines, rev19Inputs])
  const ext = (key: string) => computed[lines.findIndex(l => l.key === key)]
  const flagged = computed.filter(l => l.price_flag && l.price_flag !== 'ok')

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="line_items" value={JSON.stringify(lines.map(toInput))} />
      <input type="hidden" name="scope_rows" value={JSON.stringify(scope)} />
      <input type="hidden" name="department" value={dept} />
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="rate_card_id" value={rateCardId} />
      {header.quote_id && <input type="hidden" name="quote_id" value={header.quote_id} />}
      {header.service_ticket_id && <input type="hidden" name="service_ticket_id" value={header.service_ticket_id} />}
      {Object.entries(inputs).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {state?.error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>}

      {/* ── HEADER BLOCK ─────────────────────────────────────── */}
      <section className="rp-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold text-gray-900">{isQuote ? 'Quote header' : 'Invoice header'}</h2>
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-0.5 text-xs">
            {(['construction', 'service'] as const).map(d => <button key={d} type="button" onClick={() => setDept(d)} className={`px-3 py-1 rounded-md capitalize ${dept === d ? 'bg-primary text-primary-foreground' : 'text-gray-600'}`}>{d}</button>)}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="col-span-2"><label className={lbl} htmlFor="b-cust">Customer</label>
            <select id="b-cust" value={customerId} onChange={e => pickCustomer(e.target.value)} className={inp}><option value="">— choose —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className={lbl} htmlFor="b-site">Site / store # <span className="normal-case font-normal text-gray-400">(type to search)</span></label>
            <SitePicker value={siteNumber} onChange={setSiteNumber} onPick={pickSite} className={inp} placeholder="40107, SU-8001…" />
            <input type="hidden" name="site_number" value={siteNumber} /></div>
          <div><label className={lbl} htmlFor="b-store">Store label</label><input id="b-store" name="store_label" defaultValue={header.store_label ?? ''} className={inp} placeholder="7-Eleven #40312" /></div>
          <div className="col-span-2"><label className={lbl} htmlFor="b-addr">Address</label><input id="b-addr" name="facility_address" value={facilityAddress} onChange={e => setFacilityAddress(e.target.value)} className={inp} /></div>
          <div className="col-span-2"><label className={lbl} htmlFor="b-csz">City, State, Zip</label><input id="b-csz" name="city_state_zip" value={cityStateZip} onChange={e => setCityStateZip(e.target.value)} className={inp} /></div>
          <div><label className={lbl} htmlFor="b-attn">Attn</label><input id="b-attn" name="attn" defaultValue={header.attn ?? ''} className={inp} /></div>
          <div><label className={lbl} htmlFor="b-email">Customer email</label><input id="b-email" name="customer_email" defaultValue={header.customer_email ?? ''} className={inp} /></div>
          <div><label className={lbl} htmlFor="b-csr">SR# / CSR#</label><input id="b-csr" name="csr_number" defaultValue={header.csr_number ?? ''} className={inp} placeholder="WOT0057768" /></div>
          <div><label className={lbl} htmlFor="b-po">PO #</label><input id="b-po" name="po_number" defaultValue={header.po_number ?? ''} className={inp} /></div>
          <div><label className={lbl} htmlFor="b-wo">Portal WO #</label><input id="b-wo" name="portal_wo_number" defaultValue={header.portal_wo_number ?? ''} className={inp} /></div>
          <div><label className={lbl} htmlFor="b-job">Construction job</label>
            <select id="b-job" name="job_id" defaultValue={header.job_id ?? ''} className={inp}><option value="">— none —</option>{jobs.map(j => <option key={j.id} value={j.id}>{j.site_number ?? ''} {j.work_order_number ?? ''}</option>)}</select></div>
          {isQuote ? (<>
            <div><label className={lbl} htmlFor="b-date">Quote date</label><input id="b-date" name="proposal_date" type="date" defaultValue={header.proposal_date ?? new Date().toISOString().slice(0, 10)} className={inp} /></div>
            <div><label className={lbl} htmlFor="b-bid">Bid due</label><input id="b-bid" name="bid_due" type="date" defaultValue={header.bid_due ?? ''} className={inp} /></div>
            <div><label className={lbl} htmlFor="b-valid">Valid until</label><input id="b-valid" name="valid_until" type="date" defaultValue={header.valid_until ?? ''} className={inp} /></div>
            <div><label className={lbl} htmlFor="b-nte">NTE $</label><input id="b-nte" name="nte_amount" type="number" step="any" defaultValue={header.nte_amount ?? ''} className={`${numInp} w-full`} /></div>
          </>) : (<>
            <div><label className={lbl} htmlFor="b-idate">Invoice date</label><input id="b-idate" name="invoice_date" type="date" defaultValue={header.invoice_date ?? new Date().toISOString().slice(0, 10)} className={inp} /></div>
            <div><label className={lbl} htmlFor="b-due">Due date</label><input id="b-due" name="due_date" type="date" defaultValue={header.due_date ?? ''} className={inp} /></div>
          </>)}
          <div><label className={lbl} htmlFor="b-pm">Project manager</label><input id="b-pm" name="project_manager" list="team-names" defaultValue={header.project_manager ?? currentUser?.full_name ?? ''} className={inp} /></div>
          <div><label className={lbl} htmlFor="b-cm">Construction manager</label><input id="b-cm" name="construction_manager" list="team-names" defaultValue={header.construction_manager ?? ''} className={inp} /></div>
          <div><label className={lbl} htmlFor="b-fm">Foreman / lead</label><input id="b-fm" name="foreman" list="team-names" defaultValue={header.foreman ?? ''} className={inp} /></div>
          <div><label className={lbl} htmlFor="b-cb">Work order compiled by</label><input id="b-cb" name="compiled_by" list="team-names" defaultValue={header.compiled_by ?? currentUser?.full_name ?? ''} className={inp} /></div>
          <datalist id="team-names">{team.map(t => <option key={t.id} value={t.full_name} />)}</datalist>
          <div className="col-span-2 md:col-span-4 grid grid-cols-2 md:grid-cols-4 gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div><label className={lbl} htmlFor="b-signer">Signed by</label>
              <select id="b-signer" value={signerId} onChange={e => pickSigner(e.target.value)} className={inp}><option value="">— type a name —</option>{team.map(t => <option key={t.id} value={t.id}>{t.full_name}{t.job_title ? ` · ${t.job_title}` : ''}</option>)}</select>
              <input type="hidden" name="signer_id" value={signerId} /></div>
            <div><label className={lbl} htmlFor="b-signer-name">Name on the signature line</label><input id="b-signer-name" name="signer_name" value={signerName} onChange={e => setSignerName(e.target.value)} className={inp} required /></div>
            <div className="col-span-2"><label className={lbl} htmlFor="b-signer-title">Title under the name</label><input id="b-signer-title" name="signer_title" value={signerTitle} onChange={e => setSignerTitle(e.target.value)} className={inp} placeholder="Construction Manager" /></div>
          </div>
          <div className="col-span-2 md:col-span-4"><label className={lbl} htmlFor="b-desc">Project description</label><input id="b-desc" name="project_description" defaultValue={header.project_description ?? ''} className={inp} placeholder="PRODUCT LINE REPLACEMENT — SU-8001, GLEN BURNIE MD" /></div>
          <div><label className={lbl} htmlFor="b-status">Status</label>
            <select id="b-status" name="status" defaultValue={header.status ?? 'draft'} className={inp}>
              {(isQuote ? [['draft', 'Draft'], ['sent', 'Sent'], ['approved', 'Approved'], ['rejected', 'Rejected']] : [['draft', 'Draft'], ['sent', 'Invoiced'], ['void', 'Void']]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          {isQuote && <div className="col-span-2 flex items-end pb-1"><label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" name="is_starting_quote" value="true" defaultChecked={header.is_starting_quote !== false} />Starting quote (not final until the signer reviews it)</label></div>}
        </div>
      </section>

      {/* ── INPUTS BLOCK ─────────────────────────────────────── */}
      <section className="rp-card p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Inputs</h2>
        <p className="text-xs text-gray-500 mb-3">Change these and every line re-prices. Tax lives on the material line (categories 1–4) and is recovered through markup, so the quote-level sales tax stays 0.00%.</p>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <div><label className={lbl} htmlFor="i-rc">Rate card</label>
            <select id="i-rc" value={rateCardId} onChange={e => applyRateCard(e.target.value)} className={inp}><option value="">— pick —</option>{rateCards.map(r => <option key={r.id} value={r.id}>{r.name} ${Number(r.labor_rate).toFixed(2)}</option>)}</select></div>
          <div><label className={lbl} htmlFor="i-rate">Labor $/hr</label>
            <input id="i-rate" list="rates" value={inputs.labor_rate} onChange={e => setInp('labor_rate', e.target.value)} type="number" step="0.5" className={`${numInp} w-full`} required />
            <datalist id="rates">{LABOR_RATES.map(r => <option key={r.brand} value={r.rate}>{r.brand}</option>)}</datalist></div>
          <div><label className={lbl} htmlFor="i-mk">Material markup %</label><input id="i-mk" value={inputs.material_markup_pct} onChange={e => setInp('material_markup_pct', e.target.value)} type="number" step="0.5" className={`${numInp} w-full`} /></div>
          <div><label className={lbl} htmlFor="i-tax">Tax on material %</label>
            <input id="i-tax" list="taxes" value={inputs.material_tax_pct} onChange={e => setInp('material_tax_pct', e.target.value)} type="number" step="0.1" className={`${numInp} w-full`} />
            <datalist id="taxes">{TAX_PRESETS.map(t => <option key={t.label} value={t.value * 100}>{t.label}</option>)}</datalist></div>
          <div><label className={lbl} htmlFor="i-sub">Sub markup %</label><input id="i-sub" value={inputs.sub_markup_pct} onChange={e => setInp('sub_markup_pct', e.target.value)} type="number" step="0.5" className={`${numInp} w-full`} /></div>
          <div><label className={lbl} htmlFor="i-cont">Contingency %</label><input id="i-cont" value={inputs.contingency_pct} onChange={e => setInp('contingency_pct', e.target.value)} type="number" step="0.5" className={`${numInp} w-full`} /></div>
          <div><label className={lbl} htmlFor="i-contf">Contingency $</label><input id="i-contf" value={inputs.contingency_flat} onChange={e => setInp('contingency_flat', e.target.value)} type="number" step="any" className={`${numInp} w-full`} /></div>
          <div><label className={lbl} htmlFor="i-po">Profit &amp; overhead %</label><input id="i-po" value={inputs.profit_overhead_percent} onChange={e => setInp('profit_overhead_percent', e.target.value)} type="number" step="0.5" className={`${numInp} w-full`} /></div>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">Project management fee: none, ever. Quote-level sales tax: {inputs.sales_tax_percent}% (leave at 0).</p>
      </section>

      {/* ── SCOPE ────────────────────────────────────────────── */}
      <section className="rp-card p-5">
        <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-gray-900">Scope of work</h2><button type="button" onClick={() => setScope(s => [...s, { scope: '', description: '' }])} className="text-sm text-blue-600">+ Row</button></div>
        <div className="space-y-2">
          {scope.map((r, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <input value={r.scope} onChange={e => setScope(s => s.map((x, j) => (j === i ? { ...x, scope: e.target.value } : x)))} className={`${inp} md:col-span-2 font-medium`} placeholder="SCOPE (e.g. FURNISH & INSTALL FL100'S (3))" aria-label="Scope" />
              <div className="md:col-span-3 flex gap-2"><textarea value={r.description} onChange={e => setScope(s => s.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} rows={2} className={inp} placeholder="DESCRIPTION OF WORK in RPS voice" aria-label="Description" />
                <button type="button" onClick={() => setScope(s => s.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" aria-label="Remove scope row"><Trash2 className="w-4 h-4" /></button></div>
            </div>
          ))}
        </div>
      </section>

      {/* ── SECTIONS × CATEGORIES ────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        <div className="xl:col-span-2 space-y-5">
          {/* Basic installation: every category is on the page, grouped the way the face rolls up. */}
          <section className="rp-card">
            <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
              <h2 className="font-semibold text-gray-900">Basic installation</h2>
              {/* One search across the whole catalog: the part lands in whichever category it is filed under. */}
              <div className="relative flex-1 min-w-[280px]">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-2" />
                <PartPicker value={anyPart} onChange={setAnyPart} onPick={p => { addPicked('basic', p.category && p.category >= 1 && p.category <= 12 ? p.category : 4, p); setAnyPart('') }} className={`${inp} pl-7`} placeholder="Search all parts and supplies — part number or description — and it goes into its category…" />
              </div>
              <span className="ml-auto text-sm tabular-nums text-gray-700">{money(totals.basic.total)}</span>
            </div>
            {CATEGORY_GROUPS.map(g => (
              <div key={g.title} className="border-b border-gray-100 last:border-b-0">
                <div className="px-5 pt-3 pb-1"><div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{g.title}</div><div className="text-[11px] text-gray-400">{g.hint}</div></div>
                {g.cats.map(n => {
                  const c = categoryMeta(n)
                  const rows = lines.filter(l => l.section === 'basic' && l.category === n)
                  const k = `basic-${n}`
                  const isOpen = open[k] ?? true
                  const faceRow = totals.basic.rows.find(r => r.n === n)
                  return (
                    <div key={k} className="mx-3 mb-2 rounded-xl border border-gray-200">
                      <button type="button" onClick={() => setOpen(o => ({ ...o, [k]: !isOpen }))} className={`w-full px-3 py-2 flex items-center gap-2 text-left rounded-t-xl ${isOpen ? '' : 'rounded-b-xl'} ${rows.length ? 'bg-[#FBE5D6]' : 'bg-gray-50'} hover:brightness-95`}>
                        {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                        <span className="text-xs font-mono text-gray-500 w-5">{n}</span>
                        <span className="font-medium text-gray-900 text-sm">{c.name}</span>
                        <span className="text-xs text-gray-400">{rows.length ? `${rows.length} line${rows.length === 1 ? '' : 's'}` : 'empty'}</span>
                        <span className="ml-auto text-sm tabular-nums text-gray-800">{faceRow ? money(faceRow.total) : '—'}</span>
                      </button>
                      {isOpen && (
                        <div className="p-2 space-y-2">
                          {rows.length > 0 && <CategoryTable kind={c.kind} category={n} rows={rows} upd={upd} del={del} ext={ext} inputs={rev19Inputs} dept={dept} />}
                          <AddBar category={n} kind={c.kind} picks={quickPicks.filter(q => q.category === n)} techDays={techDays} crewSize={crewSize}
                            onPick={p => addPicked('basic', n, p)} onBlank={() => add('basic', n)} onLaborDay={crew => addLaborDay('basic', crew)} onTrip={crew => addTrip('basic', crew)} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </section>

          {/* Additional scope (change order): opt-in, only the categories you add. */}
          <section className="rp-card">
            <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-gray-900">Additional scope of work <span className="text-sm font-normal text-gray-400">(change order — leave empty on a normal quote)</span></h2>
              <AddMenu onAdd={c => add('additional', c)} />
            </div>
            <div className="divide-y divide-gray-100">
              {REV19_CATEGORIES.map(c => {
                const rows = lines.filter(l => l.section === 'additional' && l.category === c.n)
                const k = `additional-${c.n}`
                const isOpen = open[k] ?? rows.length > 0
                const faceRow = totals.additional.rows.find(r => r.n === c.n)
                if (!rows.length && !open[k]) return null
                return (
                  <div key={k}>
                    <button type="button" onClick={() => setOpen(o => ({ ...o, [k]: !isOpen }))} className="w-full px-5 py-2.5 flex items-center gap-2 text-left hover:bg-gray-50">
                      {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                      <span className="text-xs font-mono text-gray-400 w-6">{c.n}</span>
                      <span className="font-medium text-gray-900 text-sm">{c.name}</span>
                      <span className="ml-auto text-sm tabular-nums text-gray-700">{faceRow ? money(faceRow.total) : '—'}</span>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 space-y-2">
                        {rows.length > 0 && <CategoryTable kind={c.kind} category={c.n} rows={rows} upd={upd} del={del} ext={ext} inputs={rev19Inputs} dept={dept} />}
                        <AddBar category={c.n} kind={c.kind} picks={quickPicks.filter(q => q.category === c.n)} techDays={techDays} crewSize={crewSize}
                          onPick={p => addPicked('additional', c.n, p)} onBlank={() => add('additional', c.n)} onLaborDay={crew => addLaborDay('additional', crew)} onTrip={crew => addTrip('additional', crew)} />
                      </div>
                    )}
                  </div>
                )
              })}
              {!lines.some(l => l.section === 'additional') && !Object.keys(open).some(k => k.startsWith('additional-') && open[k]) && <p className="px-5 py-4 text-sm text-gray-400">No change-order lines.</p>}
            </div>
          </section>

          <section className="rp-card p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className={lbl} htmlFor="b-excl">Exclusions and clarifications</label><textarea id="b-excl" name="exclusions" rows={4} defaultValue={header.exclusions ?? ''} className={inp} placeholder="Price does not include… Dewatering priced per day… Third-party testing by others…" /></div>
            <div><label className={lbl} htmlFor="b-warr">Warranty line</label><textarea id="b-warr" name="warranty_line" rows={4} defaultValue={header.warranty_line ?? ''} className={inp} placeholder="Work warranty 1 year." /></div>
          </section>
        </div>

        {/* ── LIVE FACE ──────────────────────────────────────── */}
        <aside className="xl:sticky xl:top-4 space-y-4">
          <div className="rp-card overflow-hidden">
            <h2 className="px-4 py-3 font-semibold text-gray-900 border-b border-gray-100 text-sm">{isQuote ? 'Quote face' : 'Invoice face'}</h2>
            {(['basic', 'additional'] as const).map(s => totals[s].rows.length > 0 && (
              <div key={s}>
                <div className="px-4 py-1.5 bg-gray-50 text-[11px] font-semibold text-gray-600 uppercase">{s === 'basic' ? 'Basic installation' : 'Additional scope'}</div>
                <table className="rp-table w-full text-xs"><tbody>
                  {totals[s].rows.map(r => <tr key={r.n} className="border-b border-gray-50"><td className="px-4 py-1 text-gray-400 w-6">{r.n}</td><td className="py-1 text-gray-800">{categoryMeta(r.n).short}{r.n === 7 && r.labor_hours ? <span className="text-gray-400"> · {r.labor_hours} hrs @ {money(r.labor_rate)}</span> : null}</td><td className="px-4 py-1 text-right tabular-nums">{money(r.total)}</td></tr>)}
                  <tr className="bg-gray-50 font-medium"><td /><td className="py-1 text-gray-700">Material {money(totals[s].subtotal_material)} · Labor {money(totals[s].subtotal_labor)}</td><td className="px-4 py-1 text-right tabular-nums">{money(totals[s].total)}</td></tr>
                </tbody></table>
              </div>
            ))}
            <table className="rp-table w-full text-xs"><tbody>
              <tr><td className="px-4 py-1 text-gray-500">Taxable materials (1–4)</td><td className="px-4 py-1 text-right tabular-nums">{money(totals.taxable_material_total)}</td></tr>
              <tr><td className="px-4 py-1 text-gray-500">Concrete, equipment, subs, disposal, permits (5+9+10+11+12)</td><td className="px-4 py-1 text-right tabular-nums">{money(totals.concrete_equipment_total)}</td></tr>
              <tr><td className="px-4 py-1 text-gray-500">Labor, mobilization, lodging (6+7+8)</td><td className="px-4 py-1 text-right tabular-nums">{money(totals.labor_mobilization_total)}</td></tr>
              <tr className="border-t border-gray-200"><td className="px-4 py-1.5 font-medium text-gray-800">Grand total</td><td className="px-4 py-1.5 text-right tabular-nums font-medium">{money(totals.grand_total)}</td></tr>
              {totals.contingency_amount !== 0 && <tr><td className="px-4 py-1 text-gray-500">Contingency</td><td className="px-4 py-1 text-right tabular-nums">{money(totals.contingency_amount)}</td></tr>}
              {totals.profit_overhead_amount !== 0 && <tr><td className="px-4 py-1 text-gray-500">Profit &amp; overhead</td><td className="px-4 py-1 text-right tabular-nums">{money(totals.profit_overhead_amount)}</td></tr>}
              {totals.tax_amount !== 0 && <tr><td className="px-4 py-1 text-gray-500">Sales tax</td><td className="px-4 py-1 text-right tabular-nums">{money(totals.tax_amount)}</td></tr>}
              <tr className="bg-blue-50 border-t border-blue-100"><td className="px-4 py-2 font-semibold text-blue-900">{isQuote ? 'Proposal grand total' : 'Invoice grand total'}</td><td className="px-4 py-2 text-right tabular-nums font-bold text-blue-900">{money(totals.final_total)}</td></tr>
            </tbody></table>
          </div>
          {flagged.length > 0 && (
            <div className="rounded-xl border border-pink-200 bg-pink-50 px-4 py-3 text-xs text-pink-900">
              <b>Price gap list ({flagged.length})</b>
              <ul className="mt-1 space-y-0.5">{flagged.slice(0, 8).map((l, i) => <li key={i}>{PRICE_FLAG_LABEL[l.price_flag ?? ''] || l.price_flag} — {l.description || l.part_number || `category ${l.category}`}</li>)}</ul>
            </div>
          )}
          <Button type="submit" disabled={pending} className="w-full">{pending ? 'Saving…' : isQuote ? (header.id ? 'Save quote' : 'Create quote') : (header.id ? 'Save invoice' : 'Create invoice')}</Button>
        </aside>
      </div>
    </form>
  )
}

function AddMenu({ onAdd }: { onAdd: (category: number) => void }) {
  const [v, setV] = useState('')
  return (
    <select value={v} onChange={e => { const c = Number(e.target.value); if (c) onAdd(c); setV('') }} className="rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-sm px-3 py-1.5" aria-label="Add to category">
      <option value="">+ Add to category…</option>
      {REV19_CATEGORIES.map(c => <option key={c.n} value={c.n}>{c.n} · {c.name}</option>)}
    </select>
  )
}

/** The add controls under each category: catalog search scoped to the category, rate-card chips, blank line, labor day / trip buttons. */
function AddBar({ category, kind, picks, techDays, crewSize, onPick, onBlank, onLaborDay, onTrip }: {
  category: number; kind: string; picks: QuickPick[]; techDays: number; crewSize: number
  onPick: (p: PickedPart) => void; onBlank: () => void; onLaborDay: (crew: 'construction' | 'service') => void; onTrip: (crew: 'construction' | 'service') => void
}) {
  const [q, setQ] = useState('')
  const btn = 'inline-flex items-center gap-1 rounded-md border border-gray-300 bg-card px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50'
  if (kind === 'labor') return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      <button type="button" onClick={() => onLaborDay('construction')} className={btn}><Plus className="w-3 h-3" />Construction day</button>
      <button type="button" onClick={() => onLaborDay('service')} className={btn}><Plus className="w-3 h-3" />Service tech day</button>
      <span className="text-[11px] text-gray-400">One row per day on site. Men × hours each × the customer rate.{techDays ? ` Crew so far: ${crewSize} men, ${techDays} tech-days.` : ''}</span>
    </div>
  )
  if (kind === 'trip') return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      <button type="button" onClick={() => onTrip('construction')} className={btn}><Plus className="w-3 h-3" />Construction team week</button>
      <button type="button" onClick={() => onTrip('service')} className={btn}><Plus className="w-3 h-3" />Service tech out and back</button>
      <span className="text-[11px] text-gray-400">$100 per tech per travel day — first and last day of each week on site.{crewSize ? ` Techs defaults to ${crewSize} from the labor rows.` : ''}</span>
    </div>
  )
  // Categories 1–4 are searched (thousands of parts); everything else is a short rate-card list behind one button.
  const isParts = kind === 'material'
  return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      {isParts ? (
        <div className="relative flex-1 min-w-[260px]">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-2" />
          <PartPicker value={q} onChange={setQ} category={category} onPick={p => { onPick(p); setQ('') }} className={`${inp} pl-7`} placeholder={`Search category ${category} parts — part number or description…`} />
        </div>
      ) : (
        <PickList picks={picks} label={`Add ${categoryMeta(category).short.toLowerCase()} item`} onPick={p => onPick({ ...p, suggested_price: null })} />
      )}
      <button type="button" onClick={onBlank} className={btn}><Plus className="w-3 h-3" />Blank line</button>
      {category === 10 && techDays > 0 && <span className="text-[11px] text-gray-400">Per-tech items default to {techDays} tech-days from the labor rows.</span>}
    </div>
  )
}

/** A dropdown of rate-card items for one category: click the button, get the grouped list (with prices and the pink / green / orange price keys), pick one. */
function PickList({ picks, label, onPick }: { picks: QuickPick[]; label: string; onPick: (p: QuickPick) => void }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  const f = filter.trim().toLowerCase()
  const shown = f ? picks.filter(p => `${p.part_number ?? ''} ${p.description} ${p.subcategory ?? ''}`.toLowerCase().includes(f)) : picks
  const groups = shown.reduce<Record<string, QuickPick[]>>((a, p) => { const g = p.subcategory ?? ''; (a[g] ??= []).push(p); return a }, {})
  const tone = (p: QuickPick) => p.unit_cost == null ? 'text-pink-800 bg-pink-50' : p.cost_source === 'receipt' || p.cost_source === 'vendor_quote' ? 'text-green-900 bg-green-50' : ''
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} disabled={!picks.length} className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-100 disabled:opacity-40" aria-expanded={open}>
        <Plus className="w-3 h-3" />{label}<ChevronDown className="w-3 h-3" /><span className="text-blue-400">({picks.length})</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-[440px] max-w-[90vw] rounded-lg border border-gray-200 bg-card shadow-lg">
          <div className="p-2 border-b border-gray-100"><input value={filter} onChange={e => setFilter(e.target.value)} autoFocus className={inp} placeholder="Filter this list…" aria-label="Filter" /></div>
          <div className="max-h-80 overflow-y-auto py-1">
            {Object.entries(groups).map(([g, ps]) => (
              <div key={g}>
                {g && <div className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wide text-gray-400">{g}</div>}
                {ps.map(p => (
                  <button key={p.id} type="button" onClick={() => { onPick(p); setOpen(false); setFilter('') }} className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-blue-50 ${tone(p)}`}>
                    <span className="flex-1 min-w-0">{(() => { const pn = p.part_number && !/^\d{5,}$/.test(p.part_number) ? p.part_number : null; const dup = !pn || p.description.toUpperCase().startsWith(pn.toUpperCase()); return dup ? <span className="font-medium">{p.description}</span> : <><span className="font-medium">{pn}</span><span className="text-gray-500"> — {p.description}</span></> })()}</span>
                    <span className="tabular-nums whitespace-nowrap">{p.unit_cost != null ? money(p.unit_cost) : 'PRICE NEEDED'}</span>
                  </button>
                ))}
              </div>
            ))}
            {!shown.length && <div className="px-3 py-3 text-xs text-gray-400">Nothing matches.</div>}
          </div>
          <div className="px-3 py-1.5 border-t border-gray-100 text-[10px] text-gray-400"><span className="bg-green-50 px-1">green</span> receipt or vendor quote · <span className="bg-pink-50 px-1">pink</span> price needed · white = RPS rate card</div>
        </div>
      )}
    </div>
  )
}

type TableProps = { kind: string; category: number; rows: Rev19Row[]; upd: (k: string, p: Partial<Rev19Row>) => void; del: (k: string) => void; ext: (k: string) => ReturnType<typeof computeRev19>['lines'][number] | undefined; inputs: Rev19Inputs; dept: 'construction' | 'service' }

function CategoryTable({ kind, category, rows, upd, del, ext, inputs }: TableProps) {
  const th = 'text-left px-2 py-1.5 font-medium text-gray-500 text-[11px] uppercase tracking-wide'
  const thr = `${th} text-right`
  // Plain render helpers, NOT components: a component defined inside render is a new type every render, so React
  // remounted the picker on every keystroke — focus and search results vanished, which read as "search does nothing".
  const pick = (r: Rev19Row, p: PickedPart) => upd(r.key, pickPatch(r, p, kind))
  const desc = (r: Rev19Row, placeholder: string) => (
    <PartPicker value={r.description} onChange={t => upd(r.key, { description: t, part_id: null })} onPick={p => pick(r, p)} category={category} className={inp} placeholder={placeholder} />
  )
  const flag = (r: Rev19Row) => (
    <select value={r.price_flag} onChange={e => upd(r.key, { price_flag: e.target.value })} className={`${inp} w-24 text-[11px] ${r.price_flag !== 'ok' ? 'bg-pink-50 border-pink-300 text-pink-800' : ''}`} aria-label="Price flag">
      <option value="ok">ok</option><option value="estimate">estimate</option><option value="price_needed">PRICE NEEDED</option><option value="held_high">HELD HIGH</option><option value="verify">verify</option>{kind === 'labor' && <option value="hours_needed">HOURS NEEDED</option>}
    </select>
  )
  const note = (r: Rev19Row) => <input value={r.source_note} onChange={e => upd(r.key, { source_note: e.target.value })} className={`${inp} min-w-[160px] text-xs`} placeholder="RECEIPT SNA 2628199 6/26/26" aria-label="Where the price came from" />
  const remove = (r: Rev19Row) => <button type="button" onClick={() => del(r.key)} className="text-gray-300 hover:text-red-600" aria-label="Remove line"><Trash2 className="w-4 h-4" /></button>

  if (kind === 'material') return (
    <div className="overflow-x-auto"><table className="rp-table w-full min-w-[880px] text-sm">
      <thead><tr><th className={`${th} min-w-[260px]`}>Part # / description</th><th className={thr}>Cost</th><th className={thr}>Tax %</th><th className={thr}>Markup %</th><th className={thr}>Freight</th><th className={thr}>Sell</th><th className={thr}>Qty</th><th className={thr}>Extended</th><th className={th}>Source</th><th /><th /></tr></thead>
      <tbody>{rows.map(r => { const c = ext(r.key); return (
        <tr key={r.key} className="align-top">
          <td className="px-1 py-1">{desc(r, "Type a part number or description…")}{r.part_number && <div className="text-[11px] font-mono text-gray-400 mt-0.5">{r.part_number}</div>}</td>
          <td className="px-1 py-1"><input value={r.unit_cost} onChange={e => upd(r.key, { unit_cost: e.target.value })} type="number" step="any" className={`${numInp} w-24`} aria-label="Unit cost" /></td>
          <td className="px-1 py-1"><input value={r.sales_tax_pct} onChange={e => upd(r.key, { sales_tax_pct: e.target.value })} type="number" step="0.1" className={`${numInp} w-16`} placeholder={String(inputs.material_tax_pct * 100)} aria-label="Tax percent" /></td>
          <td className="px-1 py-1"><input value={r.markup_pct} onChange={e => upd(r.key, { markup_pct: e.target.value })} type="number" step="0.5" className={`${numInp} w-16`} placeholder={String(inputs.material_markup_pct * 100)} aria-label="Markup percent" /></td>
          <td className="px-1 py-1"><input value={r.freight_per_unit} onChange={e => upd(r.key, { freight_per_unit: e.target.value })} type="number" step="any" className={`${numInp} w-20`} aria-label="Freight per unit" /></td>
          <td className="px-1 py-1 text-right tabular-nums text-gray-700 pt-2 whitespace-nowrap">{c ? money(c.sell_unit) : '—'}</td>
          <td className="px-1 py-1"><input value={r.quantity} onChange={e => upd(r.key, { quantity: e.target.value })} type="number" step="any" className={`${numInp} w-20`} aria-label="Quantity" /></td>
          <td className="px-1 py-1 text-right tabular-nums font-medium pt-2 whitespace-nowrap">{c ? money(c.material_total) : '—'}</td>
          <td className="px-1 py-1">{note(r)}</td><td className="px-1 py-1">{flag(r)}</td><td className="px-1 py-1 pt-2">{remove(r)}</td>
        </tr>) })}</tbody>
    </table></div>
  )
  if (kind === 'labor') return (
    <div className="overflow-x-auto"><table className="rp-table w-full min-w-[880px] text-sm">
      <thead><tr><th className={th}>Day</th><th className={`${th} min-w-[260px]`}>Scope of work for that day</th><th className={th}>Crew</th><th className={thr}>Rate</th><th className={thr}>Men</th><th className={thr}>Hrs each</th><th className={thr}>Hours</th><th className={thr}>Extended</th><th className={th}>Note</th><th /><th /></tr></thead>
      <tbody>{rows.map((r, i) => { const c = ext(r.key); return (
        <tr key={r.key} className="align-top">
          <td className="px-1 py-1"><input value={r.day_label} onChange={e => upd(r.key, { day_label: e.target.value })} className={`${inp} w-24`} placeholder={`DAY ${i + 1}`} aria-label="Day" /></td>
          <td className="px-1 py-1"><input value={r.description} onChange={e => upd(r.key, { description: e.target.value })} className={inp} placeholder="MOBILIZE, BARRICADE ISLANDS, DRAIN AND PULL…" aria-label="Scope" /></td>
          <td className="px-1 py-1"><select value={r.crew} onChange={e => upd(r.key, { crew: e.target.value as 'construction' | 'service' })} className={`${inp} w-28`} aria-label="Crew"><option value="construction">Construction</option><option value="service">Service tech</option></select></td>
          <td className="px-1 py-1"><input value={r.labor_rate} onChange={e => upd(r.key, { labor_rate: e.target.value })} type="number" step="0.5" className={`${numInp} w-20`} placeholder={String(inputs.labor_rate)} aria-label="Rate override" /></td>
          <td className="px-1 py-1"><input value={r.men} onChange={e => upd(r.key, { men: e.target.value })} type="number" step="1" className={`${numInp} w-16`} aria-label="Men" /></td>
          <td className="px-1 py-1"><input value={r.hrs_each} onChange={e => upd(r.key, { hrs_each: e.target.value })} type="number" step="0.25" className={`${numInp} w-20`} aria-label="Hours each" /></td>
          <td className="px-1 py-1 text-right tabular-nums pt-2">{c?.labor_hours ?? 0}</td>
          <td className="px-1 py-1 text-right tabular-nums font-medium pt-2 whitespace-nowrap">{c ? money(c.total_labor) : '—'}</td>
          <td className="px-1 py-1">{note(r)}</td><td className="px-1 py-1">{flag(r)}</td><td className="px-1 py-1 pt-2">{remove(r)}</td>
        </tr>) })}</tbody>
    </table></div>
  )
  if (kind === 'trip') return (
    <div className="overflow-x-auto"><table className="rp-table w-full min-w-[880px] text-sm">
      <thead><tr><th className={th}>Trip</th><th className={`${th} min-w-[220px]`}>Description</th><th className={th}>Crew</th><th className={thr}>Rate</th><th className={thr}>Travel days</th><th className={thr}>Techs</th><th className={thr}>Tech-travel-days</th><th className={thr}>Extended</th><th /></tr></thead>
      <tbody>{rows.map((r, i) => { const c = ext(r.key); return (
        <tr key={r.key} className="align-top">
          <td className="px-1 py-1"><input value={r.day_label} onChange={e => upd(r.key, { day_label: e.target.value })} className={`${inp} w-24`} placeholder={`WEEK ${i + 1}`} aria-label="Trip label" /></td>
          <td className="px-1 py-1"><input value={r.description} onChange={e => upd(r.key, { description: e.target.value })} className={inp} placeholder="OUT MONDAY, HOME FRIDAY" aria-label="Description" /></td>
          <td className="px-1 py-1"><select value={r.crew} onChange={e => upd(r.key, { crew: e.target.value as 'construction' | 'service' })} className={`${inp} w-28`} aria-label="Crew"><option value="construction">Construction</option><option value="service">Service tech</option></select></td>
          <td className="px-1 py-1"><input value={r.unit_cost} onChange={e => upd(r.key, { unit_cost: e.target.value })} type="number" step="any" className={`${numInp} w-20`} aria-label="Rate" /></td>
          <td className="px-1 py-1"><input value={r.travel_days} onChange={e => upd(r.key, { travel_days: e.target.value })} type="number" step="1" className={`${numInp} w-16`} aria-label="Travel days" /></td>
          <td className="px-1 py-1"><input value={r.techs} onChange={e => upd(r.key, { techs: e.target.value })} type="number" step="1" className={`${numInp} w-16`} aria-label="Techs" /></td>
          <td className="px-1 py-1 text-right tabular-nums pt-2">{c?.quantity_effective ?? 0}</td>
          <td className="px-1 py-1 text-right tabular-nums font-medium pt-2 whitespace-nowrap">{c ? money(c.material_total) : '—'}</td>
          <td className="px-1 py-1 pt-2">{remove(r)}</td>
        </tr>) })}</tbody>
    </table></div>
  )
  // costplus (5, 9, 10, 12), sub (11), lodging (6)
  const isSub = kind === 'sub', isLodging = kind === 'lodging'
  return (
    <div className="overflow-x-auto"><table className="rp-table w-full min-w-[880px] text-sm">
      <thead><tr><th className={`${th} min-w-[260px]`}>Item / description</th><th className={thr}>{isLodging ? 'Rate' : 'Cost'}</th>{!isSub && !isLodging && <th className={th}>Markup?</th>}<th className={thr}>Sell</th><th className={thr}>{isLodging ? 'Tech-nights' : 'Qty'}</th><th className={thr}>Extended</th><th className={th}>Source</th><th /><th /></tr></thead>
      <tbody>{rows.map(r => { const c = ext(r.key); return (
        <tr key={r.key} className="align-top">
          <td className="px-1 py-1">{desc(r, isSub ? 'Vendor and what they do (orange = sub)' : isLodging ? 'LODGING / PER DIEM COMBINED — 4 TECHS × 4 NIGHTS' : 'SKID STEER WITH FORKS — PER DAY')}</td>
          <td className="px-1 py-1"><input value={r.unit_cost} onChange={e => upd(r.key, { unit_cost: e.target.value })} type="number" step="any" className={`${numInp} w-24`} aria-label="Cost" /></td>
          {!isSub && !isLodging && <td className="px-1 py-1 text-center pt-2"><input type="checkbox" checked={r.markup_applies} onChange={e => upd(r.key, { markup_applies: e.target.checked })} aria-label="Apply markup" /></td>}
          <td className="px-1 py-1 text-right tabular-nums text-gray-700 pt-2 whitespace-nowrap">{c ? money(c.sell_unit) : '—'}</td>
          <td className="px-1 py-1"><input value={r.quantity} onChange={e => upd(r.key, { quantity: e.target.value })} type="number" step="any" className={`${numInp} w-20`} aria-label="Quantity" /></td>
          <td className="px-1 py-1 text-right tabular-nums font-medium pt-2 whitespace-nowrap">{c ? money(c.material_total) : '—'}</td>
          <td className="px-1 py-1">{note(r)}</td><td className="px-1 py-1">{flag(r)}</td><td className="px-1 py-1 pt-2">{remove(r)}</td>
        </tr>) })}</tbody>
    </table></div>
  )
}

