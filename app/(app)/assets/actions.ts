'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { notifyAssetUnsafe } from '@/lib/notifications'

type ActionState = { error: string } | null

function num(val: FormDataEntryValue | null) {
  if (!val || val === '') return null
  const n = parseInt(val as string, 10)
  return isNaN(n) ? null : n
}

function flt(val: FormDataEntryValue | null) {
  if (!val || val === '') return null
  const n = parseFloat(val as string)
  return isNaN(n) ? null : n
}

function str(val: FormDataEntryValue | null) {
  const s = (val as string)?.trim()
  return s || null
}

async function getProfile() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('id, company_id, role')
    .eq('id', user.id)
    .single()

  return profile
}

export async function createAsset(_state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated. Please log in again.' }
  if (!['owner', 'manager', 'shop_manager'].includes(profile.role)) {
    return { error: 'You do not have permission to add assets.' }
  }

  const unitNumber = str(formData.get('unit_number'))
  if (!unitNumber) return { error: 'Unit number is required.' }

  const admin = createAdminClient()
  const lastOilDate = str(formData.get('last_oil_change_date'))
  const lastOilMileage = num(formData.get('last_oil_change_mileage'))
  const intervalMiles = num(formData.get('oil_change_interval_miles'))
  const usesHours = formData.get('uses_hours') === 'true'
  const currentVal = flt(formData.get('current_mileage'))

  // Auto-calculate next oil change mileage if we have the data
  const nextOilMileage =
    lastOilMileage !== null && intervalMiles !== null
      ? lastOilMileage + intervalMiles
      : null

  const { data, error } = await admin.from('assets').insert({
    company_id: profile.company_id,
    unit_number: unitNumber,
    asset_type_id: str(formData.get('asset_type_id')),
    name: str(formData.get('name')),
    status: str(formData.get('status')) ?? 'active',
    year: num(formData.get('year')),
    make: str(formData.get('make')),
    model: str(formData.get('model')),
    vin: str(formData.get('vin')),
    license_plate: str(formData.get('license_plate')),
    uses_hours: usesHours,
    current_mileage: usesHours ? null : currentVal,
    current_hours: usesHours ? currentVal : null,
    assigned_profile_id: str(formData.get('assigned_profile_id')),
    oil_change_interval_miles: intervalMiles,
    oil_change_interval_months: num(formData.get('oil_change_interval_months')),
    last_oil_change_date: lastOilDate,
    last_oil_change_mileage: lastOilMileage,
    next_oil_change_mileage: nextOilMileage,
    inspection_due_date: str(formData.get('inspection_due_date')),
    registration_due_date: str(formData.get('registration_due_date')),
    auto_ticket_inspection:   formData.get('auto_ticket_inspection') === 'on',
    auto_ticket_registration: formData.get('auto_ticket_registration') === 'on',
    auto_ticket_oil_change:   formData.get('auto_ticket_oil_change') === 'on',
    notes: str(formData.get('notes')),
  }).select('id').single()

  if (error) return { error: error.message }

  // Save the photo if one was uploaded during creation
  const photoUrl = str(formData.get('photo_url'))
  if (photoUrl && data?.id) {
    await admin.from('asset_photos').insert({
      asset_id:    data.id,
      uploaded_by: profile.id,
      photo_url:   photoUrl,
      is_primary:  true,
    })
  }

  revalidatePath('/assets')
  redirect('/assets')
}

export async function updateAsset(
  id: string,
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated. Please log in again.' }
  if (!['owner', 'manager', 'shop_manager'].includes(profile.role)) {
    return { error: 'You do not have permission to edit assets.' }
  }

  const unitNumber = str(formData.get('unit_number'))
  if (!unitNumber) return { error: 'Unit number is required.' }

  const admin = createAdminClient()
  const lastOilMileage = num(formData.get('last_oil_change_mileage'))
  const intervalMiles = num(formData.get('oil_change_interval_miles'))
  const nextOilMileage =
    lastOilMileage !== null && intervalMiles !== null
      ? lastOilMileage + intervalMiles
      : null

  const usesHours = formData.get('uses_hours') === 'true'
  const currentVal = flt(formData.get('current_mileage'))

  const { error } = await admin
    .from('assets')
    .update({
      unit_number: unitNumber,
      asset_type_id: str(formData.get('asset_type_id')),
      name: str(formData.get('name')),
      status: str(formData.get('status')) ?? 'active',
      year: num(formData.get('year')),
      make: str(formData.get('make')),
      model: str(formData.get('model')),
      vin: str(formData.get('vin')),
      license_plate: str(formData.get('license_plate')),
      uses_hours: usesHours,
      current_mileage: usesHours ? null : currentVal,
      current_hours: usesHours ? currentVal : null,
      assigned_profile_id: str(formData.get('assigned_profile_id')),
      oil_change_interval_miles: intervalMiles,
      oil_change_interval_months: num(formData.get('oil_change_interval_months')),
      last_oil_change_date: str(formData.get('last_oil_change_date')),
      last_oil_change_mileage: lastOilMileage,
      next_oil_change_mileage: nextOilMileage,
      inspection_due_date: str(formData.get('inspection_due_date')),
      registration_due_date: str(formData.get('registration_due_date')),
      auto_ticket_inspection:   formData.get('auto_ticket_inspection') === 'on',
      auto_ticket_registration: formData.get('auto_ticket_registration') === 'on',
      auto_ticket_oil_change:   formData.get('auto_ticket_oil_change') === 'on',
        notes: str(formData.get('notes')),
    })
    .eq('id', id)
    .eq('company_id', profile.company_id)

  if (error) return { error: error.message }

  // Notify if asset set to unsafe or down
  const newStatus = str(formData.get('status'))
  if (newStatus === 'unsafe' || newStatus === 'down') {
    const unitNum = str(formData.get('unit_number')) ?? id
    notifyAssetUnsafe(admin, profile.company_id, id, unitNum, newStatus).catch(() => {})
  }

  revalidatePath('/assets')
  revalidatePath(`/assets/${id}`)
  redirect(`/assets/${id}`)
}

export async function deleteAsset(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !['owner', 'manager'].includes(profile.role)) return

  const admin = createAdminClient()
  await admin.from('assets').delete().eq('id', id).eq('company_id', profile.company_id)

  // Revalidate every page that shows asset data so the deleted asset
  // doesn't linger in Next.js's cache
  revalidatePath('/assets')
  revalidatePath('/maintenance')
  revalidatePath('/maintenance/oil-changes')
  revalidatePath('/maintenance/brakes')
  revalidatePath('/maintenance/tires')
  revalidatePath('/maintenance/inspections')
  revalidatePath('/maintenance/registrations')
  revalidatePath('/dashboard'); revalidatePath('/maintenance')
}
