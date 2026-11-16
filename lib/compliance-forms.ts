/**
 * DQF Manager — blank RP-letterhead DOT forms people can download (DQF & Certs → Forms, and on each DQF item).
 *
 * The PDFs live in the private `hr-compliance` bucket under `_forms/` (source copies: docs/dqf-forms/, uploaded with
 * scripts/upload-dqf-forms.mjs). `no-prior-dot-note` is not a stored file — it is generated (lib/compliance-note-pdf.tsx),
 * blank or filled in for one driver.
 */

export const FORMS_PREFIX = '_forms/'
export const NO_PRIOR_DOT_SLUG = 'no-prior-dot-note'

/** The requirement the "no previous DOT employer" check mark satisfies (hr_requirement_types.name). */
export const SPH_TYPE_NAME = 'Safety Performance History (prior employers)'

export type FormGroup = 'hire' | 'current' | 'annual' | 'office' | 'reference'
export const FORM_GROUPS: { value: FormGroup; label: string; note: string }[] = [
  { value: 'hire',      label: 'At hire (once)',        note: 'Filled out when a driver starts. Keep for employment + 3 years.' },
  { value: 'current',   label: 'Kept current',          note: 'Redo each time a new DOT medical card comes in.' },
  { value: 'annual',    label: 'Every 12 months',       note: 'The yearly driving-record check and review.' },
  { value: 'office',    label: 'Company practice',      note: 'Not required by DOT for non-CDL drivers — RP keeps these by choice.' },
  { value: 'reference', label: 'Reference',             note: 'The one-page requirements sheet and the whole form set in one file.' },
]

export type DqfForm = {
  slug: string
  title: string
  /** File name the download is saved as. */
  filename: string
  group: FormGroup
  pages: number
  /** Who fills it out. */
  who: 'Driver' | 'Office' | 'Driver + office' | ''
  regulation: string | null
  note: string
  /** hr_requirement_types.name values this form belongs to — the form shows on those items in a driver's file. */
  types: string[]
  /** true = built on the fly, not a stored file. */
  generated?: boolean
}

export const DQF_FORMS: DqfForm[] = [
  { slug: 'application', title: "Driver's Application for Employment", filename: "RP DOT - Driver's Application for Employment.pdf", group: 'hire', pages: 3, who: 'Driver', regulation: '49 CFR 391.21',
    note: '3 years of addresses, licenses, driving experience, accidents/tickets and every employer. Signed by the driver. An Indeed or general job application does not count.',
    types: ["Driver's Application for Employment"] },
  { slug: 'mvr-request-va', title: 'Request for Check of Driving Record — Virginia', filename: 'RP DOT - Driving Record Request (Virginia).pdf', group: 'hire', pages: 1, who: 'Driver + office', regulation: '49 CFR 391.23(a)(1) / 391.25(a)',
    note: 'The signed release Virginia DMV needs before it sends an employment driving record. Used at hire and again every year.',
    types: ['Request for Check of Driving Record (pre-hire MVR)', 'Annual MVR'] },
  { slug: 'mvr-request-wv', title: 'Request for Check of Driving Record — West Virginia', filename: 'RP DOT - Driving Record Request (West Virginia).pdf', group: 'hire', pages: 1, who: 'Driver + office', regulation: '49 CFR 391.23(a)(1) / 391.25(a)',
    note: 'Same request for a West Virginia license. Used at hire and again every year.',
    types: ['Request for Check of Driving Record (pre-hire MVR)', 'Annual MVR'] },
  { slug: 'safety-history', title: 'Safety Performance History Investigation', filename: 'RP DOT - Safety Performance History Investigation.pdf', group: 'hire', pages: 3, who: 'Driver + office', regulation: '49 CFR 391.23(a)(2)',
    note: 'For a driver who DID work for a DOT-regulated employer in the last 3 years: driver authorization, request to the previous employer, and the log of attempts.',
    types: [SPH_TYPE_NAME] },
  { slug: NO_PRIOR_DOT_SLUG, title: 'No Previous DOT Employer — Note to File', filename: 'RP DOT - No Previous DOT Employer Note.pdf', group: 'hire', pages: 1, who: 'Office', regulation: '49 CFR 391.23(a)(2)',
    note: 'For a driver who did NOT drive for a DOT-regulated employer in the last 3 years. This note takes the place of the safety history. Tick the box on the driver\'s file and it fills in for you.',
    types: [SPH_TYPE_NAME], generated: true },
  { slug: 'road-test', title: "Driver's Road Test Form and Certificate", filename: 'RP DOT - Road Test Form and Certificate.pdf', group: 'hire', pages: 4, who: 'Office', regulation: '49 CFR 391.31 / 391.33',
    note: 'The driver drives the truck type they will use; the examiner scores it and signs the certificate on page 4.',
    types: ['Record of Road Test'] },
  { slug: 'on-duty-statement', title: "Driver's Statement of On-Duty Hours (7 days)", filename: 'RP DOT - Statement of On-Duty Hours.pdf', group: 'hire', pages: 1, who: 'Driver', regulation: '49 CFR 395.1(e)(2)(v)(D)',
    note: 'Hours worked at any job in the 7 days before the first day. All zeros is fine. Keep 6 months.',
    types: ['Drivers Statement of On-Duty Hours'] },

  { slug: 'registry-verification', title: 'Medical Examiner National Registry Verification', filename: 'RP DOT - National Registry Verification.pdf', group: 'current', pages: 1, who: 'Office', regulation: '49 CFR 391.51(b)(9)',
    note: 'Note showing the examiner on the medical card is listed on the FMCSA National Registry. Staple to the copy of the card.',
    types: ['Medical Examiner National Registry Verification'] },

  { slug: 'annual-review', title: 'Annual Review of Driving Record', filename: 'RP DOT - Annual Review of Driving Record.pdf', group: 'annual', pages: 1, who: 'Office', regulation: '49 CFR 391.25(b)',
    note: 'Signed and dated note that the yearly MVR was reviewed and the driver still meets the requirements. Order the MVR with the driving record request above.',
    types: ['Annual Review of Driving Record'] },

  { slug: 'medical-card-notice', title: 'Medical Card Expiration Notice', filename: 'RP DOT - Medical Card Expiration Notice.pdf', group: 'office', pages: 1, who: 'Office', regulation: null,
    note: 'Heads-up handed to a driver about 60 days before the DOT medical card runs out.',
    types: ["Medical Examiner's Certificate - DOT Card"] },
  { slug: 'cover-sheet', title: 'Driver File Cover Sheet and Checklist', filename: 'RP DOT - Driver File Cover Sheet.pdf', group: 'office', pages: 1, who: 'Office', regulation: null,
    note: 'Goes on top of the paper file.', types: [] },
  { slug: 'record-card', title: 'Driver Record Card', filename: 'RP DOT - Driver Record Card.pdf', group: 'office', pages: 1, who: 'Office', regulation: null,
    note: 'One-page summary of the driver, second page of the paper file.', types: ['Driver Record Card'] },
  { slug: 'license-compliance', title: 'Certificate of Compliance with Driver License Requirements', filename: 'RP DOT - Certificate of Compliance (License).pdf', group: 'office', pages: 1, who: 'Driver', regulation: null,
    note: 'Driver confirms they hold only one license.', types: ['Cert. of Compliance with Driver License Req.'] },

  { slug: 'requirements', title: 'DOT Driver Qualification File — Required Contents (non-CDL)', filename: 'DOT DQF Requirements - Non-CDL Drivers.pdf', group: 'reference', pages: 1, who: '', regulation: '49 CFR 391 & 395',
    note: 'The one-page list of everything a driver file must have, and what does not apply to RP.', types: [] },
  { slug: 'complete-form-set', title: 'Complete Driver File Form Set', filename: 'RP DOT - Complete Driver File Form Set.pdf', group: 'reference', pages: 19, who: '', regulation: null,
    note: 'Every form above in one file, in file order.', types: [] },
]

export const formBySlug = (slug: string) => DQF_FORMS.find(f => f.slug === slug)
export const formsForType = (typeName: string) => DQF_FORMS.filter(f => f.types.includes(typeName))
/** Lightweight shape handed to client components. */
export type FormLink = { slug: string; title: string; generated: boolean }
export const formLinksForType = (typeName: string): FormLink[] => formsForType(typeName).map(f => ({ slug: f.slug, title: f.title, generated: !!f.generated }))

/** What goes in the item's Notes when the "no previous DOT employer" box is ticked. */
export function noPriorDotNote(by: string | null, dateISO: string): string {
  const d = `${dateISO.slice(5, 7)}/${dateISO.slice(8, 10)}/${dateISO.slice(0, 4)}`
  return `No DOT-regulated employer in the 3 years before hire - no previous-employer safety history to request. Note to file ${d}${by ? ` (${by})` : ''}.`
}
export const isNoPriorDotNote = (notes: string | null | undefined) => !!notes && notes.startsWith('No DOT-regulated employer in the 3 years before hire')
