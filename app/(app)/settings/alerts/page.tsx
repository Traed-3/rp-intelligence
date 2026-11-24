import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { PushToggle } from './push-toggle'
import { saveAlertPreferences, updatePhone } from './actions'

const ALERT_DEFS = [
  {
    type: 'maintenance_overdue',
    label: 'Maintenance Overdue',
    desc: 'Oil changes, inspections, registrations, and other scheduled service that is past due.',
    icon: '🔧',
  },
  {
    type: 'asset_unsafe',
    label: 'Asset Marked Unsafe or Down',
    desc: 'Any vehicle or equipment that gets flagged as unsafe or taken out of service.',
    icon: '⚠️',
  },
  {
    type: 'clock_out_reminder',
    label: 'Forgot to Clock Out',
    desc: 'Reminder if you stay clocked in for more than 12 hours without clocking out.',
    icon: '⏰',
  },
  {
    type: 'ticket_assigned',
    label: 'Repair Ticket Assigned to Me',
    desc: 'When a repair ticket is assigned directly to you.',
    icon: '🎫',
  },
  {
    type: 'new_ticket',
    label: 'New Repair Ticket Created',
    desc: 'When any new repair ticket is opened in the system.',
    icon: '📋',
  },
  {
    type: 'repeat_purchase',
    label: 'Repeat Tool / Supply Purchase',
    desc: 'When the same tool or supply is bought again for the same truck inside its watch window (e.g. extension cords for O15 twice in 12 months). Management only.',
    icon: '🔁',
  },
]

type Pref = {
  alert_type: string
  email_enabled: boolean
  sms_enabled: boolean
  push_enabled: boolean
}

export default async function AlertsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()

  const [{ data: profile }, { data: rawPrefs }] = await Promise.all([
    admin.from('profiles').select('id, full_name, email, phone, company_id').eq('id', user.id).single(),
    admin.from('alert_preferences').select('alert_type, email_enabled, sms_enabled, push_enabled').eq('profile_id', user.id),
  ])

  const prefMap = Object.fromEntries(
    (rawPrefs ?? []).map((p: Pref) => [p.alert_type, p])
  )

  const hasPhone = !!(profile?.phone?.trim())

  const th = 'text-xs font-semibold text-gray-500 uppercase tracking-wide text-center w-20'
  const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-700">← Settings</Link>
        <span className="text-gray-300">/</span>
        <h1 className="rp-title">Alerts &amp; Notifications</h1>
      </div>

      <p className="text-sm text-gray-500 mb-8">
        Choose how you want to be notified for each type of alert. In-app notifications are always on.
      </p>

      {/* Preferences table */}
      <form action={saveAlertPreferences}>
        <div className="rp-card overflow-hidden">
          {/* Column headers */}
          <div className="flex items-center px-5 py-3 border-b border-gray-100 bg-gray-50">
            <div className="flex-1" />
            <div className={th}>In-App</div>
            <div className={th}>Email</div>
            <div className={th}>Text</div>
            <div className={th}>Push</div>
          </div>

          {ALERT_DEFS.map((def, i) => {
            const pref = prefMap[def.type]
            return (
              <div
                key={def.type}
                className={`flex items-center px-5 py-4 gap-4 ${i < ALERT_DEFS.length - 1 ? 'border-b border-gray-50' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{def.icon}</span>
                    <p className="text-sm font-semibold text-gray-900">{def.label}</p>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 pl-6">{def.desc}</p>
                </div>

                {/* In-App — always on */}
                <div className="w-20 flex justify-center">
                  <div className="w-5 h-5 rounded bg-blue-100 border-2 border-blue-400 flex items-center justify-center" title="Always on">
                    <svg className="w-3 h-3 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
                  </div>
                </div>

                {/* Email */}
                <div className="w-20 flex justify-center">
                  <input
                    type="checkbox"
                    name={`${def.type}_email`}
                    defaultChecked={pref?.email_enabled ?? false}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </div>

                {/* SMS */}
                <div className="w-20 flex justify-center group relative">
                  <input
                    type="checkbox"
                    name={`${def.type}_sms`}
                    defaultChecked={pref?.sms_enabled ?? false}
                    disabled={!hasPhone}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  />
                  {!hasPhone && (
                    <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap bg-foreground text-background text-xs rounded px-2 py-1 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                      Add phone number below
                    </span>
                  )}
                </div>

                {/* Push */}
                <div className="w-20 flex justify-center">
                  <input
                    type="checkbox"
                    name={`${def.type}_push`}
                    defaultChecked={pref?.push_enabled ?? false}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </div>
              </div>
            )
          })}
        </div>

        <button
          type="submit"
          className="mt-4 px-5 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-lg transition-colors"
        >
          Save Preferences
        </button>
      </form>

      {/* Push notifications section */}
      <div className="mt-10">
        <h2 className="text-base font-bold text-gray-900 mb-1">Browser Push Notifications</h2>
        <p className="text-sm text-gray-500 mb-4">
          Enable push notifications so your browser alerts you even when RP Intelligence is not open.
          You need to enable this per device (phone, tablet, computer).
        </p>
        <PushToggle />
      </div>

      {/* Phone number for SMS */}
      <div className="mt-10">
        <h2 className="text-base font-bold text-gray-900 mb-1">Phone Number for Text Alerts</h2>
        <p className="text-sm text-gray-500 mb-4">
          Add your cell phone number to receive text message alerts. Standard messaging rates may apply.
          {' '}<span className="text-amber-600 font-medium">SMS requires Twilio setup — coming soon.</span>
        </p>
        <form action={updatePhone} className="flex gap-3 max-w-sm">
          <input
            name="phone"
            type="tel"
            placeholder="+1 (555) 000-0000"
            defaultValue={profile?.phone ?? ''}
            className={inp}
          />
          <button
            type="submit"
            className="px-4 py-2 bg-foreground hover:bg-foreground/85 text-background text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            Save
          </button>
        </form>
      </div>

      {/* Setup guide */}
      <details className="mt-10 group">
        <summary className="cursor-pointer text-sm font-semibold text-gray-500 hover:text-gray-700 list-none flex items-center gap-2">
          <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
          Setup Guide — Email &amp; Push (for admins)
        </summary>
        <div className="mt-4 p-5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 space-y-5">
          <div>
            <p className="font-semibold text-gray-900 mb-2">📧 Email Alerts via Resend</p>
            <ol className="list-decimal list-inside space-y-1.5 text-gray-600">
              <li>Go to <strong>resend.com</strong> and create a free account (3,000 emails/month free).</li>
              <li>In Resend, click <strong>API Keys → Create API Key</strong> and copy it.</li>
              <li>In Vercel → your project → <strong>Settings → Environment Variables</strong>, add:</li>
            </ol>
            <div className="mt-2 bg-ink text-green-400 text-xs font-mono rounded-lg p-3 space-y-1">
              <p>RESEND_API_KEY=re_xxxxxxxxxxxx</p>
              <p>RESEND_FROM_EMAIL=RP Intelligence &lt;alerts@yourdomain.com&gt;</p>
              <p>NEXT_PUBLIC_APP_URL=https://rpintelligence.app</p>
            </div>
            <p className="mt-2 text-gray-500">You can send from <code>@resend.dev</code> for testing without domain setup.</p>
          </div>

          <div>
            <p className="font-semibold text-gray-900 mb-2">🔔 Browser Push Notifications via VAPID</p>
            <ol className="list-decimal list-inside space-y-1.5 text-gray-600">
              <li>In your terminal, run: <code className="bg-gray-200 px-1.5 py-0.5 rounded text-gray-800">node -e "const wp=require('web-push');console.log(JSON.stringify(wp.generateVAPIDKeys()))"</code></li>
              <li>Copy the <code>publicKey</code> and <code>privateKey</code> values from the output.</li>
              <li>In Vercel → Environment Variables, add:</li>
            </ol>
            <div className="mt-2 bg-ink text-green-400 text-xs font-mono rounded-lg p-3 space-y-1">
              <p>NEXT_PUBLIC_VAPID_PUBLIC_KEY=Bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</p>
              <p>VAPID_PRIVATE_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</p>
              <p>VAPID_EMAIL=admin@yourdomain.com</p>
            </div>
            <li className="list-none mt-2 text-gray-600">4. Redeploy the app — then come back here and click <strong>Enable Push Notifications</strong>.</li>
          </div>
        </div>
      </details>
    </div>
  )
}
