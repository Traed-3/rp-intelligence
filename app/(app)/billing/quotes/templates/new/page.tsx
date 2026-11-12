import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireBilling } from '@/lib/billing-guard'
import { QuoteTemplateForm } from '@/components/billing/quote-template-form'
import { saveQuoteTemplate } from '../../../actions'

export default async function NewQuoteTemplatePage() {
  const { canWrite } = await requireBilling()
  if (!canWrite) redirect('/billing/quotes/templates')

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href="/billing/quotes/templates" className="text-sm text-gray-500 hover:text-gray-700">← Templates</Link>
        <h1 className="rp-title mt-2">New Quote Template</h1>
      </div>
      <div className="rp-card p-6">
        <QuoteTemplateForm action={saveQuoteTemplate.bind(null, null)} />
      </div>
    </div>
  )
}
