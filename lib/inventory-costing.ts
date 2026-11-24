import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

/**
 * A cost seen on real paperwork (packing slip, vendor invoice, counter receipt)
 * beats anything else on file — the RPS pricing rule. Refreshes unit/last/avg
 * cost, stamps where the cost came from, and appends to the price history.
 *
 * `qty` is the quantity just received into stock (0 for a cost-only update,
 * e.g. parts that went straight to a job). The caller has already inserted the
 * receive ledger row when qty > 0, so the running average subtracts it back out
 * before re-weighting.
 */
export async function applyReceiptCost(admin: Admin, o: { company_id: string; part_id: string; unit_cost: number; qty: number; vendor: string | null; reference: string | null; date: string; stocked?: boolean; note?: string }) {
  const { data: p } = await admin.from('parts').select('avg_cost').eq('id', o.part_id).eq('company_id', o.company_id).single()
  if (!p) return   // part not in this tenant — never write across companies
  let avg = o.unit_cost
  if (o.qty > 0) {
    const { data: prior } = await admin.from('inventory_transactions').select('qty').eq('part_id', o.part_id).eq('company_id', o.company_id).eq('txn_type', 'receive')
    const priorQty = (prior ?? []).reduce((a, r) => a + Number(r.qty), 0) - o.qty
    avg = p?.avg_cost != null && priorQty > 0 ? ((Number(p.avg_cost) * priorQty) + o.unit_cost * o.qty) / (priorQty + o.qty) : o.unit_cost
  } else if (p?.avg_cost != null) {
    avg = Number(p.avg_cost)
  }
  await admin.from('parts').update({
    last_cost: o.unit_cost, avg_cost: Math.round(avg * 10000) / 10000, unit_cost: o.unit_cost,
    cost_source: 'receipt', cost_vendor: o.vendor, cost_invoice_ref: o.reference, cost_date: o.date, price_status: 'ok',
    ...(o.stocked === false ? {} : { is_stocked: true }),
  }).eq('id', o.part_id).eq('company_id', o.company_id)
  await admin.from('part_price_history').insert({ part_id: o.part_id, kind: 'cost_receipt', price: o.unit_cost, vendor: o.vendor, reference: o.reference, observed_on: o.date, source_note: o.note ?? (o.qty > 0 ? 'received into stock' : 'cost update from paperwork') })
}
