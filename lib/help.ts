// ============================================================
// Technical Help (Trae, 11/18/26): how-to guides and videos for the people in the field.
// One entry per guide. The files live in the private Supabase bucket HELP_BUCKET and are only ever
// handed out as short-lived signed links to someone who is signed in (app/(app)/help/*).
// To add a guide: upload the files with `node scripts/upload-help-files.mjs`, then add an entry here.
// ============================================================

export const HELP_BUCKET = 'help-docs'

export type HelpGuide = {
  slug: string
  title: string
  /** One line for the tile on /help. */
  summary: string
  /** Who it is for, shown as a small tag. */
  audience: string
  /** Paths inside HELP_BUCKET. */
  video?: { path: string; poster?: string; length: string }
  pdf?: { path: string; filename: string; pages: number }
  /** The short version, shown on the guide page under the video. */
  recap: string[]
}

export const HELP_GUIDES: HelpGuide[] = [
  {
    slug: 'notes-scanning',
    title: 'Scanning tickets and receipts in Notes',
    summary: 'Scan an invoice ticket or a receipt with the iPhone Notes app and email it in. Video and printable guide.',
    audience: 'Construction techs',
    video: { path: 'notes-scanning/video.mp4', poster: 'notes-scanning/poster.jpg', length: '2:25' },
    pdf: { path: 'notes-scanning/guide.pdf', filename: 'RPS - Scanning Your Documents in Notes.pdf', pages: 2 },
    recap: [
      'Notes → New Note → paperclip → Scan Documents.',
      'Hold the phone over the page. When it says Ready for next scan, tap the yellow checkmark in the top right corner. That saves it.',
      'Tickets: scan the back as a second scan (paperclip at the bottom of the note).',
      'Share button at the top of the note → Send Copy → Mail (or Gmail).',
      'Ticket → const.inv.rp@gmail.com, subject SITE# HOURS (xCREW). Receipt → const.receipt.rp@gmail.com, subject AMOUNT CODE TRUCK-or-SITE WHAT.',
    ],
  },
]

/** The one guide that is a working page instead of a video: app/(app)/help/home-screen. Shown first on /help. */
export const HOME_SCREEN_GUIDE = {
  href: '/help/home-screen',
  title: 'Add RP Intelligence to your Home Screen',
  summary: 'Get the app icon on your phone or computer. One tap where the device allows it; on an iPhone it shows you the three taps.',
  audience: 'Everyone',
}

export const PLAYBOOK_GUIDE = {
  href: '/help/construction-playbook',
  title: 'Construction Playbook',
  summary: 'How the Construction module works day to day: jobs, the status colors, quote or no quote, the schedule, materials, quotes and invoices.',
  audience: 'Construction office',
}

export const RPMAIL_GUIDE = {
  href: '/help/rpmail',
  title: 'Using RPMail',
  summary: 'Your work email inside RP Intelligence: turning it on, reading, replying, drafts, pictures, labels, snooze and the rest.',
  audience: 'Anyone who has RPMail',
}

export const helpGuideBySlug = (slug: string) => HELP_GUIDES.find(g => g.slug === slug)
