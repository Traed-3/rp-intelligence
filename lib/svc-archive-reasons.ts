// Shared between the archive reason picker (single + bulk) and server-side
// validation. "Other" pairs with a free-text field in the UI.
export const ARCHIVE_REASON_PRESETS = [
  'Duplicate work order',
  'Test / invalid dispatch',
  'Handled outside the system',
  'Old — cleanup',
  'Other',
] as const
