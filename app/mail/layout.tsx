import type { Metadata } from 'next'

// RPMail in its own window (Trae, 11/25/26). Outside the (app) group on purpose: the main RP Intelligence menu is not
// drawn here, because the mailboxes and their folders take its place (components/rpmail/rpmail-app.tsx, MailSidebar).
// proxy.ts still signs the person in and checks the role, the same as every other page.
export const metadata: Metadata = { title: 'RPMail' }

export default function MailLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh w-full bg-surface">{children}</div>
}
