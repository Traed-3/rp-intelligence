import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">{title}</h2>
      {children}
    </section>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 mb-5">
      <div className="w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center shrink-0 mt-0.5">
        {n}
      </div>
      <div>
        <p className="font-semibold text-gray-900 mb-1">{title}</p>
        <div className="text-sm text-gray-600 space-y-1">{children}</div>
      </div>
    </div>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800 mb-4">
      💡 {children}
    </div>
  )
}

export default async function GuidePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user!.id).single()
  if (!['owner', 'manager'].includes(profile?.role ?? '')) redirect('/settings')

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-700">← Settings</Link>
        <span className="text-gray-300">/</span>
        <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">User Guide</h1>
      </div>

      {/* Tab-style navigation */}
      <div className="flex gap-2 mb-8">
        <a href="#owner" className="px-4 py-2 rounded-full bg-blue-600 text-white text-sm font-medium">Owner / Manager</a>
        <a href="#employee" className="px-4 py-2 rounded-full border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50">Shop Employees</a>
        <a href="#construction" className="px-4 py-2 rounded-full border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50">Construction</a>
        <a href="#iphone" className="px-4 py-2 rounded-full border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50">iPhone Setup</a>
      </div>

      {/* ── Owner / Manager ────────────────────────────────────────────── */}
      <div id="owner">
        <Section title="👔 Owner & Manager Guide">
          <Tip>
            The first person to log in automatically becomes the <strong>Owner</strong>.
            Everyone else starts as <strong>Viewer</strong> until you change their role.
          </Tip>

          <Step n={1} title="Set Up Your Employees">
            <p>Each employee needs to log in once before you can give them access.</p>
            <p>Tell everyone to visit the app URL and sign in with their company Gmail.</p>
            <p>Then go to <strong>Settings → User Management</strong> and change their role.</p>
            <p className="text-xs text-gray-500 mt-1">
              Shop employees who clock in need the <strong>Shop Employee</strong> role.
              Your shop foreman should be <strong>Shop Manager</strong>.
            </p>
          </Step>

          <Step n={2} title="Add Your Fleet Assets">
            <p>Go to <strong>Assets → Add Asset</strong>.</p>
            <p>Required: Unit Number (e.g., T-101, EQ-05)</p>
            <p>Fill in the vehicle details, current mileage, and any due dates (inspection, registration, insurance).</p>
            <p>Add oil change intervals so the system tracks when oil changes are due.</p>
          </Step>

          <Step n={3} title="Create Repair Tickets">
            <p>Go to <strong>Tickets → New Ticket</strong>.</p>
            <p>Select the asset, write a title, set the priority, and assign it to a shop employee.</p>
            <p>Use <strong>Safety</strong> priority for anything that makes a vehicle unsafe to drive.</p>
          </Step>

          <Step n={4} title="Reading the Dashboard">
            <p>The <strong>Dashboard</strong> is your command center. It shows:</p>
            <ul className="list-disc list-inside space-y-0.5 text-gray-600">
              <li>Red cards = things needing immediate attention</li>
              <li>The maintenance bands (red/orange/yellow) = what needs service</li>
              <li>Live employee table = who's working on what right now</li>
            </ul>
          </Step>

          <Step n={5} title="Running Payroll">
            <p>Go to <strong>Reports → Payroll</strong>.</p>
            <p>Select the pay period (This Week, Last Week, etc.).</p>
            <p>Review the hours grid, then click <strong>Approve All</strong>.</p>
            <p>Click <strong>Export CSV</strong> to download a spreadsheet for your payroll processor.</p>
          </Step>

          <Step n={6} title="Recording Maintenance">
            <p>Open any asset and click one of the service buttons:</p>
            <ul className="list-disc list-inside space-y-0.5 text-gray-600">
              <li><strong>Oil Change</strong> — records the service and updates the next due mileage</li>
              <li><strong>Brake Service</strong> — records what was done and sets the next inspection date</li>
              <li><strong>Tire Service</strong> — records tire info and sets the next inspection date</li>
            </ul>
            <p>You can also update inspection, registration, and insurance due dates by editing the asset.</p>
          </Step>
        </Section>
      </div>

      {/* ── Shop Employees ─────────────────────────────────────────────── */}
      <div id="employee">
        <Section title="🔧 Shop Employee Guide">
          <Tip>
            Shop employees mainly use the <strong>/mobile</strong> screen on their phone.
            Add it to your home screen so it opens like an app — see iPhone Setup below.
          </Tip>

          <Step n={1} title="Clock In When You Arrive">
            <p>Open the app and tap <strong>Clock In</strong>.</p>
            <p>The timer starts automatically. You'll see your total hours build up throughout the day.</p>
          </Step>

          <Step n={2} title="Set Your Status">
            <p>Tap <strong>Set Status</strong> to let the manager know what you're doing.</p>
            <p>Options: At Shop, Working on Ticket, Break, Lunch, Parts Run, and more.</p>
            <p>If you select <strong>Working on Ticket</strong>, you can pick which ticket.</p>
          </Step>

          <Step n={3} title="Work on a Ticket">
            <p>Go to <strong>My Tasks</strong> to see your assigned tickets.</p>
            <p>Tap a ticket to open it, then tap <strong>▶ Start Work</strong> to begin the timer.</p>
            <p>Tap <strong>⏸ Pause</strong> when you stop (break, waiting for parts, etc.).</p>
            <p>All your time is tracked automatically — no need to write anything down.</p>
          </Step>

          <Step n={4} title="Report an Issue">
            <p>If you notice a problem with a vehicle, tap <strong>Report Issue</strong>.</p>
            <p>Fill in the issue, pick the vehicle, and set the priority.</p>
            <p>If the vehicle is unsafe to drive, select <strong>No — DO NOT USE</strong> for the safety status.</p>
          </Step>

          <Step n={5} title="Log Mileage">
            <p>Tap <strong>Log Mileage</strong> and select the vehicle.</p>
            <p>Enter the current odometer reading. This keeps oil change tracking accurate.</p>
          </Step>

          <Step n={6} title="Clock Out When You Leave">
            <p>Tap <strong>Clock Out</strong> at the end of your shift.</p>
            <p>If you're working on a ticket when you clock out, it automatically pauses.</p>
          </Step>
        </Section>
      </div>

      {/* ── Construction ───────────────────────────────────────────────── */}
      <div id="construction">
        <Section title="🏗️ Construction">
          <Tip>
            The Construction module (jobs, statuses, schedule, materials, quotes &amp; invoices) has its own
            full write-up — the Construction Playbook. It covers the color-coded job stages (matched to
            Starsky&apos;s Master Schedule), the two ways a job can start (quoted vs. no quote needed), and
            how the schedule, materials, and daily updates all fit together.
          </Tip>
          <a
            href="https://claude.ai/artifact/Tb17WwUwmigqm9mVeA6pSY"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
          >
            Open the Construction Playbook →
          </a>
        </Section>
      </div>

      {/* ── iPhone Setup ───────────────────────────────────────────────── */}
      <div id="iphone">
        <Section title="📱 Add to iPhone Home Screen">
          <p className="text-sm text-gray-600 mb-5">
            Adding the app to your home screen makes it open fullscreen like a real app — no browser address bar.
            It works on iPhone and Android.
          </p>

          <Step n={1} title="Open the app in Safari on your iPhone">
            <p>You must use <strong>Safari</strong> (not Chrome) for this to work on iPhone.</p>
            <p>Navigate to the app URL and make sure you're logged in.</p>
          </Step>

          <Step n={2} title='Tap the Share button'>
            <p>It's the box with an arrow pointing up — at the bottom of the screen.</p>
          </Step>

          <Step n={3} title='"Add to Home Screen"'>
            <p>Scroll down in the share sheet and tap <strong>Add to Home Screen</strong>.</p>
            <p>Edit the name to <strong>RP Intel</strong> if you like, then tap <strong>Add</strong>.</p>
          </Step>

          <Step n={4} title="Open from your home screen">
            <p>The app icon appears on your home screen.</p>
            <p>Tap it — it opens fullscreen, no browser, no address bar. Looks and feels like a real app.</p>
          </Step>

          <Tip>
            On Android, Chrome will automatically show an &quot;Add to Home Screen&quot; or &quot;Install App&quot; prompt when you visit.
          </Tip>
        </Section>
      </div>

      <div className="bg-gray-50 rounded-2xl border border-gray-200 shadow-sm p-5 text-sm text-gray-600 text-center">
        <p>Need help? Contact Trae at <strong>finance.trae@proton.me</strong></p>
      </div>
    </div>
  )
}
