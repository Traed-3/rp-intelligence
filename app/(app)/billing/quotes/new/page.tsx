import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireBilling } from '@/lib/billing-guard'
import { loadBuilderLists } from '@/lib/billing-data'
import { Rev19Builder } from '@/components/billing/rev19-builder'
import { rowsFromLines } from '@/lib/rev19-rows'
import { saveQuote } from '../../actions'
import { LayoutTemplate, ArrowRight } from 'lucide-react'

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ job?: string; department?: string; customer?: string; template?: string; blank?: string }> }) {
  const { job, department, customer, template, blank } = await searchParams
  const { id: userId, company_id, canWrite } = await requireBilling()
  if (!canWrite) redirect('/billing/quotes')
  const admin = createAdminClient()

  // Coming straight from "New Quote" with no job and no template picked yet —
  // offer the starting-point templates instead of dropping straight into a
  // blank 12-category builder.
  if (!job && !template && !blank) {
    const { data: templates } = await admin
      .from('con_quote_templates').select('id, name, category, description')
      .eq('company_id', company_id).eq('is_active', true).order('category').order('name')
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6"><Link href="/billing/quotes" className="text-sm text-gray-500 hover:text-gray-700">← Quotes</Link><h1 className="rp-title mt-2">Start a Quote</h1><p className="text-sm text-gray-500 mt-1">Start from a template that already has the scope and a checklist of typical line items, or start blank.</p></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {(templates ?? []).map(t => (
            <Link key={t.id} href={`/billing/quotes/new?template=${t.id}`} className="rp-card rp-card-link p-4 flex items-start gap-3">
              <LayoutTemplate className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 text-sm">{t.name}</p>
                {t.category && <p className="text-xs text-gray-400">{t.category}</p>}
                {t.description && <p className="text-xs text-gray-500 mt-1">{t.description}</p>}
              </div>
            </Link>
          ))}
        </div>
        {!templates?.length && <p className="text-sm text-gray-400 mb-4">No templates yet — <Link href="/billing/quotes/templates/new" className="text-blue-600 hover:underline">create one</Link> to see it here next time.</p>}
        <div className="flex items-center justify-between">
          <Link href="/billing/quotes/new?blank=1" className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900">Start blank <ArrowRight className="w-3.5 h-3.5" /></Link>
          <Link href="/billing/quotes/templates" className="text-sm text-gray-400 hover:text-gray-600">Manage templates</Link>
        </div>
      </div>
    )
  }

  const lists = await loadBuilderLists(admin, company_id)
  let header: Record<string, unknown> = { kind: 'quote', job_id: job ?? null, department: department ?? 'construction', customer_id: customer ?? null }
  let initialLines: ReturnType<typeof rowsFromLines> = []
  let templateBrandNotes: Record<string, string> | null = null
  let templateName: string | null = null
  if (job) {
    const { data: j } = await admin.from('con_jobs').select('customer_id, site_number, work_order_number, facility_address, scope_of_work').eq('id', job).eq('company_id', company_id).maybeSingle()
    if (j) header = { ...header, customer_id: j.customer_id, site_number: j.site_number, work_order_number: j.work_order_number, facility_address: j.facility_address, project_description: j.scope_of_work }
  }
  if (template) {
    const { data: tpl } = await admin.from('con_quote_templates').select('*').eq('id', template).eq('company_id', company_id).maybeSingle()
    if (tpl) {
      header = { ...header, department: tpl.department ?? header.department, scope_rows: tpl.scope_rows ?? [], exclusions: tpl.exclusions, warranty_line: tpl.warranty_line }
      initialLines = rowsFromLines(Array.isArray(tpl.lines) ? tpl.lines : [])
      templateBrandNotes = tpl.notes_by_brand && Object.keys(tpl.notes_by_brand).length ? tpl.notes_by_brand : null
      templateName = tpl.name
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-5">
        <Link href="/billing/quotes/new" className="text-sm text-gray-500 hover:text-gray-700">← {templateName ? 'Change template' : 'Quotes'}</Link>
        <h1 className="rp-title mt-1">{templateName ? `New quote — ${templateName}` : 'New starting quote'}</h1>
        <p className="text-sm text-gray-500">Twelve REV19 categories. Quantities and costs come from the catalog with their source and date; the face and breakdown print from what you enter here.</p>
      </div>
      {templateBrandNotes && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold mb-1">Brand notes for this template</p>
          <ul className="space-y-0.5">
            {Object.entries(templateBrandNotes).map(([brand, note]) => <li key={brand}><b>{brand}:</b> {note}</li>)}
          </ul>
        </div>
      )}
      <Rev19Builder action={saveQuote.bind(null, null)} header={header as never} initialLines={initialLines} customers={lists.customers} jobs={lists.jobs} rateCards={lists.rateCards} team={lists.team} quickPicks={lists.quickPicks} currentUser={lists.team.find(t => t.id === userId) ?? null} />
    </div>
  )
}
