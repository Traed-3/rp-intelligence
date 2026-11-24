'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const ALERT_TYPES = [
  'maintenance_overdue',
  'asset_unsafe',
  'clock_out_reminder',
  'ticket_assigned',
  'new_ticket',
  'repeat_purchase',
] as const

export async function saveAlertPreferences(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles').select('company_id').eq('id', user.id).single()
  if (!profile) return

  const rows = ALERT_TYPES.map(type => ({
    profile_id:    user.id,
    company_id:    profile.company_id,
    alert_type:    type,
    in_app_enabled: true,
    email_enabled: formData.get(`${type}_email`) === 'on',
    sms_enabled:   formData.get(`${type}_sms`) === 'on',
    push_enabled:  formData.get(`${type}_push`) === 'on',
    updated_at:    new Date().toISOString(),
  }))

  await admin.from('alert_preferences').upsert(rows, {
    onConflict: 'profile_id,alert_type',
  })

  revalidatePath('/settings/alerts')
}

export async function updatePhone(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const phone = (formData.get('phone') as string)?.trim() ?? null
  const admin = createAdminClient()
  await admin.from('profiles').update({ phone }).eq('id', user.id)
  revalidatePath('/settings/alerts')
}
