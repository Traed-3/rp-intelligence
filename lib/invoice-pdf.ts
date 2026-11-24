import type { createAdminClient } from '@/lib/supabase/admin'
import { renderBillingPdf, docFromRow } from '@/lib/billing-pdf'

type Admin = ReturnType<typeof createAdminClient>

/** Render an invoice to PDF bytes (face + breakdown). Shared by the PDF route and the email-out action. */
export async function buildInvoicePdf(admin: Admin, id: string, company_id: string) {
  const { data: inv } = await admin.from('con_invoices').select('*, con_customers(name, billing_address, email, billing_contact)').eq('id', id).eq('company_id', company_id).single()
  if (!inv) return null
  const customer = (inv as unknown as { con_customers: { name: string; billing_address: string | null; email: string | null; billing_contact: string | null } | null }).con_customers
  const { data: items } = await admin.from('con_invoice_line_items').select('*').eq('invoice_id', id).order('sort_order', { nullsFirst: false }).order('section').order('line_no')
  const { doc, items: lines } = docFromRow('invoice', inv as Record<string, unknown>, customer, (items ?? []) as Record<string, unknown>[])
  const pdf = await renderBillingPdf(doc, lines, 'both')
  return { pdf, invoice: inv, customer }
}
