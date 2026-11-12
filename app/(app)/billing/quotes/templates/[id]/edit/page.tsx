import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireBilling } from '@/lib/billing-guard'
import { QuoteTemplateForm } from '@/components/billing/quote-template-form'
import { DeleteButton } from '@/components/construction/delete-button'
import { saveQuoteTemplate, deleteQuoteTemplate } from '../../../../actions'

export default async function EditQuoteTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { company_id, canWrite } = await requireBilling()
  if (!canWrite) redirect('/billing/quotes/templates')
  const admin = createAdminClient()
  const { data: template } = await admin.from('con_quote_templates').select('*').eq('id', id).eq('company_id', company_id).single()
  if (!template) notFound()

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href="/billing/quotes/templates" className="text-sm text-gray-500 hover:text-gray-700">← Templates</Link>
        <h1 className="rp-title mt-2">Edit Template</h1>
      </div>
      <div className="rp-card p-6">
        <QuoteTemplateForm action={saveQuoteTemplate.bind(null, id)} template={template} />
      </div>
      <div className="mt-4 flex justify-end">
        <DeleteButton action={deleteQuoteTemplate.bind(null, id)} confirm="Delete this template? Quotes already started from it are unaffected." label="Delete Template" />
      </div>
    </div>
  )
}
