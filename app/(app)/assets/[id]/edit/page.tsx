import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { AssetForm } from '@/components/assets/asset-form'
import { updateAsset } from '../../actions'
import { redirect } from 'next/navigation'

export default async function EditAssetPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('company_id, role')
    .eq('id', user!.id)
    .single()

  if (!profile || !['owner', 'manager', 'shop_manager'].includes(profile.role)) {
    redirect(`/assets/${id}`)
  }

  const [{ data: asset }, { data: assetTypes }, { data: employees }] = await Promise.all([
    admin
      .from('assets')
      .select('*')
      .eq('id', id)
      .eq('company_id', profile.company_id)
      .single(),
    admin
      .from('asset_types')
      .select('id, name')
      .eq('company_id', profile.company_id)
      .order('name'),
    admin
      .from('profiles')
      .select('id, full_name')
      .eq('company_id', profile.company_id)
      .eq('is_active', true)
      .order('full_name'),
  ])

  if (!asset) notFound()

  // Bind the asset id into the server action
  const updateAssetWithId = updateAsset.bind(null, id)

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href={`/assets/${id}`} className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to {asset.unit_number}
        </Link>
        <h1 className="rp-title mt-2">
          Edit {asset.unit_number}
        </h1>
      </div>

      <div className="rp-card p-6">
        <AssetForm
          action={updateAssetWithId}
          assetTypes={assetTypes ?? []}
          employees={employees ?? []}
          asset={asset}
        />
      </div>
    </div>
  )
}
