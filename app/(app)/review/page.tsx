import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { suggestAssets } from '@/lib/asset-match'
import { Inbox } from 'lucide-react'
import { ReviewRow } from './review-row'
import { assignImport, createAssetForImport, rejectImport } from './actions'

export default async function ReviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id, role').eq('id', user!.id).single()

  if (!['owner', 'manager', 'shop_manager'].includes(profile?.role ?? '')) {
    redirect('/dashboard')
  }
  const companyId = profile!.company_id

  const [{ data: pending }, { data: assets }, { data: assetTypes }] = await Promise.all([
    admin.from('gmail_imports')
      .select('id, subject, sender, received_at, body_preview, detected_asset')
      .eq('company_id', companyId).eq('status', 'pending')
      .order('received_at', { ascending: false }),
    admin.from('assets')
      .select('id, unit_number, status')
      .eq('company_id', companyId).neq('status', 'retired')
      .order('unit_number'),
    admin.from('asset_types')
      .select('id, name').eq('company_id', companyId).order('name'),
  ])

  const assetList = (assets ?? []).map(a => ({ id: a.id, unit_number: a.unit_number }))

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <div className="p-2 rounded-lg bg-amber-50 border border-amber-100">
          <Inbox className="w-5 h-5 text-amber-600" />
        </div>
        <h1 className="rp-title">Email Review</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6 ml-1">
        Emails whose unit number didn’t match an asset land here first — nothing is added until you decide.
        Pick a suggested match, choose another asset, create a new one, or dismiss it.
      </p>

      {(pending ?? []).length === 0 ? (
        <div className="rp-card p-12 text-center">
          <p className="text-gray-400 text-sm">Nothing to review. 🎉 Every email matched an asset.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {(pending ?? []).map((imp) => (
            <ReviewRow
              key={imp.id}
              imp={{
                id: imp.id,
                subject: imp.subject ?? '',
                sender: imp.sender ?? '',
                receivedAt: imp.received_at,
                bodyPreview: imp.body_preview ?? '',
                detectedAsset: imp.detected_asset ?? '',
              }}
              suggestions={suggestAssets(imp.detected_asset ?? '', assetList)}
              assets={assetList}
              assetTypes={assetTypes ?? []}
              onAssign={assignImport}
              onCreate={createAssetForImport}
              onReject={rejectImport}
            />
          ))}
        </div>
      )}
    </div>
  )
}
