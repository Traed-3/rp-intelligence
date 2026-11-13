import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { UserRoleForm } from './user-role-form'
import { LandingPageForm } from './landing-page-form'
import { AddEmployeeForm } from './add-employee-form'
import { DeleteUserButton } from './delete-user-button'
import { EditUserButton } from './edit-user-button'
import { ModulesButton } from './modules-button'
import { SetPasswordButton } from './set-password-button'
import { canManageUser, canAssignRole } from '@/lib/user-admin-rules'
import { updateUserRole, toggleUserActive, updateDefaultLandingPage } from './actions'

export default async function UsersSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id, role, id').eq('id', user!.id).single()

  if (!['owner', 'manager'].includes(profile?.role ?? '')) redirect('/settings')

  const { data: users } = await admin
    .from('profiles')
    .select('id, full_name, email, phone, role, is_active, created_at, default_landing_page, job_title, must_change_password')
    .eq('company_id', profile!.company_id)
    .order('is_active', { ascending: false })   // active people first, inactive at the bottom
    .order('full_name')
  // Who has ever signed in (Supabase Auth keeps the last sign-in time). Never signed in = "Not active".
  const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const lastSignIn = new Map((authList?.users ?? []).map(a => [a.id, a.last_sign_in_at ?? null]))
  const stateOf = (u: { id: string; is_active: boolean }) => (!u.is_active ? 'disabled' : lastSignIn.get(u.id) ? 'active' : 'never') as 'disabled' | 'never' | 'active'
  const inactiveCount = (users ?? []).filter(u => !u.is_active).length
  const neverCount = (users ?? []).filter(u => stateOf(u) === 'never').length

  const { data: allBlocks } = await admin
    .from('profile_module_blocks')
    .select('profile_id, module')
    .in('profile_id', (users ?? []).map(u => u.id))

  const blocksByUser = new Map<string, string[]>()
  for (const b of allBlocks ?? []) {
    blocksByUser.set(b.profile_id, [...(blocksByUser.get(b.profile_id) ?? []), b.module])
  }

  const ROLE_ORDER = ['owner', 'manager', 'construction_admin', 'shop_manager', 'parts_manager', 'shop_employee', 'service_tech', 'office_staff', 'viewer']

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-700">← Settings</Link>
        <span className="text-gray-300">/</span>
        <h1 className="rp-title">User Management</h1>
      </div>

      <div className="mb-6">
        <AddEmployeeForm />
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 mb-6 text-sm text-blue-800">
        <p className="font-semibold mb-1">How employees get access:</p>
        <ol className="list-decimal list-inside space-y-0.5 text-blue-700">
          <li>An owner or manager adds them here with <strong>+ Add Employee</strong> (name, email, role). Nobody can sign in unless they are on this list and <strong>Active</strong>.</li>
          <li>Press <strong>Password</strong> on their row and give them a starter password. Leave &ldquo;Temporary&rdquo; ticked.</li>
          <li>They sign in with their email and that password, and are made to choose their own before they see anything.</li>
          <li>Their <strong>role</strong> decides what they can see. <strong>Disable</strong> signs them out and blocks sign-in; <strong>Activate</strong> lets them back in.</li>
        </ol>
      </div>

      <p className="mb-2 text-xs text-gray-500">
        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-200 border border-green-300 align-middle mr-1" />{(users ?? []).length - inactiveCount - neverCount} active and signed in
        <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-200 border border-red-300 align-middle ml-3 mr-1" />{neverCount} not active (never signed in) · {inactiveCount} disabled{profile!.role === 'owner' ? '. Remove deletes a login for good.' : ''}
      </p>
      <div className="rp-card overflow-hidden">
        <table className="rp-table w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3 hidden sm:table-cell">Email</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Lands On</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">Module Access</th>
              {profile!.role === 'owner' && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(users ?? []).map(u => {
              const isSelf = u.id === profile!.id
              const state = stateOf(u)   // green row = active and has signed in; red row = not active yet, or disabled
              const seen = lastSignIn.get(u.id)
              const lockedOwner = !canManageUser(profile!.role, u.role)   // a manager can see an owner but not change them
              async function handleRoleChange(newRole: string) {
                'use server'
                await updateUserRole(u.id, newRole)
              }
              async function handleToggleActive() {
                'use server'
                await toggleUserActive(u.id, !u.is_active)
              }
              async function handleLandingPageChange(page: string) {
                'use server'
                await updateDefaultLandingPage(u.id, page)
              }
              return (
                <tr key={u.id} className={state === 'active' ? 'bg-green-50 dark:bg-green-950/30' : 'bg-red-50 dark:bg-red-950/30'}>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-medium ${u.is_active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{u.full_name}</span>
                      {state === 'disabled' && <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border border-red-300 bg-red-100 text-red-800">Disabled · cannot sign in</span>}
                      {state === 'never' && <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border border-red-300 bg-red-100 text-red-800">Not active · has not signed in</span>}
                      {u.is_active && (u as any).must_change_password && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-800" title="Has a temporary password and has not chosen their own yet">Temporary password</span>}{(u as any).job_title && <span className="ml-2 text-xs text-gray-400">{(u as any).job_title}</span>}
                      {isSelf && <span className="text-xs text-gray-400">(you)</span>}
                      {!lockedOwner && <EditUserButton user={{ id: u.id, full_name: u.full_name, email: u.email, phone: (u as any).phone ?? null, job_title: (u as any).job_title ?? null }} />}
                      {/* Only an owner may set an owner's password; the server action enforces the same rule. */}
                      {!lockedOwner && (
                        <SetPasswordButton userId={u.id} fullName={u.full_name} email={u.email} />
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{(u as any).phone || 'no phone'}{seen ? ` · last signed in ${new Date(seen).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell text-xs">{u.email}</td>
                  <td className="px-4 py-3">
                    {isSelf && profile!.role === 'owner' ? (
                      <span className="text-sm font-medium text-gray-700 capitalize">Owner</span>
                    ) : (
                      <UserRoleForm
                        userId={u.id}
                        currentRole={u.role}
                        onUpdate={handleRoleChange}
                        disabled={isSelf || lockedOwner}
                        canAssignOwner={canAssignRole(profile!.role, 'owner')}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <LandingPageForm
                      userId={u.id}
                      currentPage={(u as any).default_landing_page ?? null}
                      onUpdate={handleLandingPageChange}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {isSelf || lockedOwner ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${state === 'active' ? 'text-green-800 bg-green-100 border-green-300' : 'text-red-800 bg-red-100 border-red-300'}`}>{state === 'active' ? 'Active' : state === 'never' ? 'Not active' : 'Disabled'}</span>
                    ) : (
<form action={handleToggleActive} className="flex flex-col items-start gap-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${state === 'active' ? 'text-green-800 bg-green-100 border-green-300' : 'text-red-800 bg-red-100 border-red-300'}`}>{state === 'active' ? 'Active' : state === 'never' ? 'Not active' : 'Disabled'}</span>
                        <button
                          type="submit"
                          title={u.is_active ? 'Signs them out and blocks sign-in' : 'Lets them sign in again'}
                          className={`text-xs font-medium border px-2.5 py-1 rounded-lg transition-colors ${u.is_active ? 'text-red-700 border-red-200 hover:bg-red-50' : 'text-green-700 border-green-300 hover:bg-green-50'}`}
                        >
                          {u.is_active ? 'Disable' : 'Activate'}
                        </button>
                      </form>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {!isSelf && !lockedOwner && (
                      <ModulesButton userId={u.id} fullName={u.full_name} blockedKeys={blocksByUser.get(u.id) ?? []} />
                    )}
                  </td>
                  {/* Delete — owner only, can't delete yourself */}
                  {profile!.role === 'owner' && (
                    <td className="px-4 py-3 text-right">
                      {!isSelf && (
                        <DeleteUserButton userId={u.id} fullName={u.full_name} />
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 bg-gray-50 rounded-2xl border border-gray-200 shadow-sm p-5 text-sm text-gray-600">
        <p className="font-semibold text-gray-900 mb-2">Role descriptions:</p>
        <div className="space-y-1.5">
          <p><strong>Owner</strong> — Full access. Can manage users, settings, and see everything.</p>
          <p><strong>Manager</strong> — Can create/edit tickets, view reports, approve time entries.</p>
          <p><strong>Shop Manager</strong> — Manages repair tickets and shop employees. Can approve time.</p>
          <p><strong>Shop Technician</strong> — Can clock in/out, update ticket status, log time.</p>
          <p><strong>Mechanic</strong> — Shop mechanic. Can clock in/out, work on tickets, and log labor time.</p>
          <p><strong>Service Tech</strong> — Field technician. Can log mileage/hours and update asset status.</p>
          <p><strong>Construction Tech</strong> — Construction field technician. Can log time, view assigned work, and run Field Surveys (big button on the phone home screen).</p>
          <p><strong>Construction Administrator</strong> — Construction jobs, permits and scheduling, Quotes &amp; Invoices, and DQF &amp; Certs.</p>
          <p><strong>Parts Manager</strong> — Runs the parts room: receives stock, transfers, counts and the parts catalog in Inventory.</p>
          <p><strong>Office Staff</strong> — Office and accounting: Quotes &amp; Invoices and Card Audit; can view assets and records.</p>
          <p><strong>Viewer</strong> — Read-only. Cannot edit anything.</p>
        </div>
      </div>
    </div>
  )
}
