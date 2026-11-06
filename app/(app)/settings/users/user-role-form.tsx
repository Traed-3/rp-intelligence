'use client'

import { useTransition } from 'react'

const ROLES = [
  { value: 'owner',             label: 'Owner' },
  { value: 'manager',           label: 'Manager' },
  { value: 'shop_manager',      label: 'Shop Manager' },
  { value: 'shop_employee',     label: 'Shop Technician' },
  { value: 'mechanic',          label: 'Mechanic' },
  { value: 'service_tech',      label: 'Service Tech' },
  { value: 'construction_tech', label: 'Construction Tech' },
  { value: 'construction_manager', label: 'Construction Manager' },
  { value: 'office_staff',      label: 'Office Staff' },
  { value: 'viewer',            label: 'Viewer' },
]

// Roles that can still be on a profile but are no longer offered in the picker. field_surveyor is what every
// new sign-in starts as (profiles.role default), so it must keep showing until an admin picks a real role.
const HIDDEN_ROLE_LABELS: Record<string, string> = {
  field_surveyor: 'New sign-in, locked to Field Surveys',
  estimator: 'Estimator (retired)',
}

export function UserRoleForm({
  userId,
  currentRole,
  onUpdate,
  disabled,
  canAssignOwner,
}: {
  userId: string
  currentRole: string
  onUpdate: (role: string) => Promise<void>
  disabled?: boolean
  canAssignOwner: boolean
}) {
  const [isPending, startTransition] = useTransition()

  return (
    <select
      value={currentRole}
      disabled={disabled || isPending}
      onChange={e => {
        const newRole = e.target.value
        startTransition(() => onUpdate(newRole))
      }}
      className="text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 bg-white"
    >
      {!ROLES.some(r => r.value === currentRole) && (
        <option value={currentRole} disabled>{HIDDEN_ROLE_LABELS[currentRole] ?? currentRole}</option>
      )}
      {ROLES.filter(r => r.value !== 'owner' || canAssignOwner || currentRole === 'owner').map(r => (
        <option key={r.value} value={r.value}>{r.label}</option>
      ))}
    </select>
  )
}
