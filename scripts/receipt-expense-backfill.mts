// Backfill emailed receipts (Construction Receipts inbox) into Expenses & Receipts for a date range.
//   npx tsx --env-file=.env.local scripts/receipt-expense-backfill.mts 2026-07-01 2026-09-22          (dry run)
//   npx tsx --env-file=.env.local scripts/receipt-expense-backfill.mts 2026-07-01 2026-09-22 --apply
// Safe to re-run: a receipt already imported (or already keyed in by hand) is skipped.
import { importReceiptExpenses } from '../lib/receipt-expense-import'

const [since, until] = process.argv.slice(2).filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a))
const apply = process.argv.includes('--apply')
if (!since || !until) { console.error('usage: <since YYYY-MM-DD> <until YYYY-MM-DD> [--apply]'); process.exit(1) }

const out = await importReceiptExpenses({ since, until, apply, limit: 1000 })
const rows = (out.rows ?? []) as { amount: number; payment_method_code: string | null; expense_date: string }[]
const byCode: Record<string, { n: number; total: number }> = {}
for (const r of rows) { const k = r.payment_method_code ?? '(none)'; byCode[k] ??= { n: 0, total: 0 }; byCode[k].n++; byCode[k].total += Number(r.amount) }
console.log(JSON.stringify({ apply, since, until, checked: out.checked, imported: out.imported, skipped: out.skipped, errors: out.errors, byCode }, null, 1))
