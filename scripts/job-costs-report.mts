/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Job cost audit: what every Construction job has cost, by the same rules as the job's Cost Summary tab.
 *   npx tsx --env-file=.env.local scripts/job-costs-report.mts [--open] [--job <job number or site>] [--json]
 * Read-only.
 */
import { createClient } from '@supabase/supabase-js'
import { loadAllJobCosts, loadJobCosts, allRows } from '../lib/job-costs'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY)!, { auth: { persistSession: false } }) as any
const args = process.argv.slice(2)
const one = args.includes('--job') ? args[args.indexOf('--job') + 1] : null
const { data: company } = await admin.from('companies').select('id').limit(1).single()
const jobs = await allRows<any>((f, t) => admin.from('con_jobs').select('id, job_number, site_number, po_number, gas_brand, stage, con_customers(name)').eq('company_id', company.id).order('id').range(f, t))
const forCosts = (j: any) => ({ id: j.id, site_number: j.site_number, po_number: j.po_number, gas_brand: j.gas_brand, customer: j.con_customers?.name ?? null })
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

if (one) {
  for (const j of jobs.filter((j: any) => j.job_number === one || j.site_number === one)) {
    const c = await loadJobCosts(admin, company.id, forCosts(j))
    console.log(`\n== ${j.job_number ?? j.site_number} (${j.stage})  materials ${usd(c.materialCost)}  other ${usd(c.otherCost)}  labor ${c.laborHours} hr ${usd(c.laborCost)} @ ${c.laborRate} (${c.laborRateSource})  total ${usd(c.totalCost)}\n   INVOICE PREVIEW ${usd(c.invoice.total)} = labor ${usd(c.invoice.labor)} + ${c.invoice.tripCount} trips ${usd(c.invoice.trips)} + disposables ${usd(c.invoice.disposables)} + materials ${usd(c.invoice.materials)} + other ${usd(c.invoice.other)}`)
    for (const p of c.purchases) console.log(`  ${p.group === 'material' ? 'MAT' : 'OTH'} ${p.date} ${(p.amount == null ? 'no total' : usd(p.amount)).padStart(11)}  ${p.source.padEnd(14)} ${(p.vendor ?? '').slice(0, 26).padEnd(26)} ${p.description.slice(0, 50)}${p.received ? ' [received]' : ''} (${p.lines.length} lines)${p.notes.length ? ' !! ' + p.notes.join('; ') : ''}`)
    for (const l of c.labor) console.log(`  LAB ${l.date} ${String(l.manHours).padStart(6)} hr  ${l.source.padEnd(13)} ${l.who}`)
  }
} else {
  const costs = await loadAllJobCosts(admin, company.id, jobs.map(forCosts))
  let rows = jobs.filter((j: any) => costs.has(j.id)).map((j: any) => ({ job: j.job_number ?? `${j.site_number} (no #)`, stage: j.stage, ...costs.get(j.id)! }))
  if (args.includes('--open')) rows = rows.filter((r: any) => r.stage !== 'complete')
  rows.sort((a: any, b: any) => b.totalCost - a.totalCost)
  if (args.includes('--json')) console.log(JSON.stringify(rows, null, 1))
  else {
    const t = rows.reduce((a: any, r: any) => ({ m: a.m + r.materialCost, o: a.o + r.otherCost, h: a.h + r.laborHours, l: a.l + r.laborCost }), { m: 0, o: 0, h: 0, l: 0 })
    console.log(`${rows.length} jobs with cost.  materials ${usd(t.m)}  other ${usd(t.o)}  labor ${Math.round(t.h)} hr ${usd(t.l)}`)
    for (const r of rows.slice(0, 40)) console.log(`${r.job.padEnd(26)} ${r.stage.padEnd(18)} mat ${usd(r.materialCost).padStart(12)}  other ${usd(r.otherCost).padStart(11)}  labor ${String(r.laborHours).padStart(6)} hr ${usd(r.laborCost).padStart(11)}  total ${usd(r.totalCost).padStart(12)}`)
  }
}
