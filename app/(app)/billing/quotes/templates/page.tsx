import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireBilling } from '@/lib/billing-guard'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

export default async function QuoteTemplatesPage() {
  const { company_id, canWrite } = await requireBilling()
  const admin = createAdminClient()
  const { data: templates } = await admin
    .from('con_quote_templates')
    .select('id, name, category, description, department, is_active, lines, notes_by_brand')
    .eq('company_id', company_id)
    .order('category').order('name')

  const list = templates ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="rp-title">
            Quote Templates
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Starting points for the REV19 builder — pick one from New Quote instead of starting blank.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/billing/quotes" className="text-sm text-gray-500 hover:text-gray-700 mr-1">← Quotes</Link>
          {canWrite && <Link href="/billing/quotes/templates/new"><Button className="gap-2"><Plus className="w-4 h-4" />New Template</Button></Link>}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="rp-card p-12 text-center">
          <p className="text-gray-400 text-sm">No templates yet.</p>
        </div>
      ) : (
        <div className="rp-card overflow-hidden">
          <table className="rp-table w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">Category</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Lines</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Brand notes</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {list.map(t => (
                <ClickableRow key={t.id} href={`/billing/quotes/templates/${t.id}/edit`}>
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900">{t.name}</span>
                    {t.description && <div className="text-xs text-gray-400 mt-0.5">{t.description}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{t.category ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{Array.isArray(t.lines) ? t.lines.length : 0}</td>
                  <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">{t.notes_by_brand ? Object.keys(t.notes_by_brand).length : 0}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${t.is_active ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-400 border-gray-200'}`}>
                      {t.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right"><span className="text-xs font-medium text-blue-600">Edit →</span></td>
                </ClickableRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
