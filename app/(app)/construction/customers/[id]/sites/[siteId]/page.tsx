import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { SiteForm } from '@/components/construction/site-form'
import { DeleteButton } from '@/components/construction/delete-button'
import { saveSite, deleteSite } from '../../../../actions'

export default async function EditSitePage({ params }: { params: Promise<{ id: string; siteId: string }> }) {
  const { id, siteId } = await params
  const { company_id, canWrite } = await requireConstruction()
  if (!canWrite) redirect(`/construction/customers/${id}`)
  const admin = createAdminClient()

  const [{ data: site }, { data: customers }] = await Promise.all([
    admin.from('con_sites').select('*').eq('id', siteId).eq('company_id', company_id).single(),
    admin.from('con_customers').select('id, name').eq('company_id', company_id).order('name'),
  ])
  if (!site) notFound()

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href={`/construction/customers/${id}`} className="text-sm text-gray-500 hover:text-gray-700">← Back to Customer</Link>
        <h1 className="rp-title mt-2">Edit Site</h1>
      </div>
      <div className="rp-card p-6">
        <SiteForm
          action={saveSite.bind(null, siteId)}
          site={site}
          customers={customers ?? []}
          redirectTo={`/construction/customers/${id}`}
        />
      </div>
      <div className="mt-4 flex justify-end">
        <DeleteButton
          action={deleteSite.bind(null, siteId, `/construction/customers/${id}`)}
          confirm="Delete this site?"
          label="Delete Site"
        />
      </div>
    </div>
  )
}
