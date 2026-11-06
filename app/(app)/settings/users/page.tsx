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
    .select('id, full_name, email, phone, role, is_active, created_at, default_landing_page, job_title')
    .eq('company_id', profile!.company_id)
    .order('full_name')

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
        <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">User Management</h1>
      </div>

      <div className="mb-6">
        <AddEmployeeForm />
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 mb-6 text-sm text-blue-800">
        <p className="font-semibold mb-1">How employees get access:</p>
        <ol className="list-decimal list-inside space-y-0.5 text-blue-700">
          <li>Each employee visits the app URL and signs in with their company Gmail.</li>
          <li>Their account is created automatically as <strong>Field Survey Only (locked)</strong>. They can see nothing but their own field surveys.</li>
          <li>Only an owner or manager can give them more, by changing their role here.</li>
          <li>No Gmail? Use <strong>Password</strong> on their row to set one, then they sign in with their email and that password.</li>
        </ol>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-500">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 hidden sm:table-cell">Email</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Role</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 hidden md:table-cell">Lands On</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500 hidden lg:table-cell">Module Access</th>
              {profile!.role === 'owner' && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(users ?? []).map(u => {
              const isSelf = u.id === profile!.id
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
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">{u.full_name}</span>{(u as any).job_title && <span className="ml-2 text-xs text-gray-400">{(u as any).job_title}</span>}
                      {isSelf && <span className="text-xs text-gray-400">(you)</span>}
                      {!lockedOwner && <EditUserButton user={{ id: u.id, full_name: u.full_name, email: u.email, phone: (u as any).phone ?? null, job_title: (u as any).job_title ?? null }} />}
                      {/* Only an owner may set an owner's password; the server action enforces the same rule. */}
                      {!lockedOwner && (
                        <SetPasswordButton userId={u.id} fullName={u.full_name} email={u.email} />
                      )}
                    </div>
                    {(u as any).phone && <p className="text-xs text-gray-400 mt-0.5">{(u as any).phone}</p>}
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
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${u.is_active ? 'text-green-700 bg-green-50 border-green-200' : 'text-gray-500 bg-gray-100 border-gray-200'}`}>{u.is_active ? 'Active' : 'Inactive'}</span>
                    ) : (
                      <form action={handleToggleActive}>
                        <button
                          type="submit"
                          title={u.is_active ? 'Click to deactivate — signs them out and blocks login' : 'Click to reactivate'}
                          className={`text-xs px-2 py-0.5 rounded-full border font-medium transition-colors ${
                            u.is_active
                              ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                              : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'
                          }`}
                        >
                          {u.is_active ? 'Active' : 'Inactive'}
                        </button>
                        <p className="text-[10px] text-gray-400 mt-0.5">{u.is_active ? 'Click to deactivate' : 'Click to reactivate'}</p>
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
          <p><strong>New sign-ins</strong> start locked to Field Surveys (they see only the surveys they start themselves) until you pick a role here.</p>
          <p><strong>Construction Administrator</strong> — Construction jobs, permits and scheduling, Quotes &amp; Invoices, and DQF &amp; Certs.</p>
          <p><strong>Parts Manager</strong> — Runs the parts room: receives stock, transfers, counts and the parts catalog in Inventory.</p>
          <p><strong>Office Staff</strong> — Office and accounting: Quotes &amp; Invoices and Card Audit; can view assets and records.</p>
          <p><strong>Viewer</strong> — Read-only. Cannot edit anything.</p>
        </div>
      </div>
    </div>
  )
}
