// Where a user can be sent right after login. Shared between the Settings
// picker and the server-side validation on save.
export const LANDING_PAGE_OPTIONS = [
  { value: '/my',                label: 'My Plate (default)' },
  { value: '/dashboard',         label: 'Dashboard' },
  { value: '/maintenance',       label: 'Maintenance & Fleet' },
  { value: '/service',           label: 'Service Dispatch' },
  { value: '/construction',      label: 'Construction' },
  { value: '/construction/jobs', label: 'Construction — Jobs (Projects Dashboard)' },
  { value: '/construction/surveys', label: 'Field Surveys' },
] as const

export const VALID_LANDING_PAGES = LANDING_PAGE_OPTIONS.map(o => o.value)

// My Plate is the first screen for everyone who has not been given another one (Trae 11/13/26).
// Shop employees are the exception: lib/role-access.ts sends them to the shop dashboard.
export const DEFAULT_LANDING_PAGE = '/my'
