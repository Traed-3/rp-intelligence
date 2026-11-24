// ============================================================
// Who may do what in Settings > Users.
// PURE module (no server-only imports): the server actions enforce it and the page uses it to hide controls.
// Owners and managers both run user admin, but anything that touches an owner is owner-only. Otherwise a manager
// could change an owner's login email, password or role, or hand out the owner role, and so become an owner.
// ============================================================

const ADMIN_ROLES: readonly string[] = ['owner', 'manager']

type R = string | null | undefined

/** May this caller edit, deactivate, re-role, block modules for, or set the password of someone currently holding targetRole? */
export const canManageUser = (callerRole: R, targetRole: R): boolean =>
  ADMIN_ROLES.includes(callerRole ?? '') && (targetRole !== 'owner' || callerRole === 'owner')

/** May this caller give someone newRole (Add Employee or the role dropdown)? Only an owner can hand out owner. */
export const canAssignRole = (callerRole: R, newRole: R): boolean =>
  ADMIN_ROLES.includes(callerRole ?? '') && (newRole !== 'owner' || callerRole === 'owner')
