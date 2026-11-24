import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy | Rappahannock Petroleum LLC',
  description: 'How RP Intelligence, RPMail and RPS Inbox handle information.',
}

// Public page (listed in proxy.ts publicPaths). Google's sign-in setup links to it.
export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-2xl rp-card p-8 space-y-5 text-sm leading-6 text-gray-700">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Privacy Policy</h1>
          <p className="text-gray-500">Rappahannock Petroleum LLC &middot; RP Intelligence, RPMail and RPS Inbox</p>
          <p className="text-gray-500">Last updated November 20, 2026</p>
        </div>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">Who this covers</h2>
          <p>
            RP Intelligence, RPMail (the mail page inside RP Intelligence) and RPS Inbox are internal tools built by
            Rappahannock Petroleum LLC for its own employees. They are not offered to the public. Only people the company
            has given an account to can use them.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">What the tools read and do</h2>
          <p>
            <strong>Company record keeping.</strong> RP Intelligence reads company mailboxes such as the construction,
            invoicing and receipt mailboxes to log work orders, tickets, permits, receipts and invoices. For this it asks
            Google for read-only access. It does not send, delete or change mail.
          </p>
          <p>
            <strong>RPMail.</strong> RPMail is optional. An employee who turns it on connects their own work Gmail with
            Google sign-in, and the company may also give them shared company mailboxes. For those mailboxes RPMail asks
            Google for permission to read, organize and send mail (the &quot;gmail.modify&quot; permission). It uses that
            permission only when the person does something on the page: open a message, mark it read or unread, archive
            it, mark it as spam, move it to Gmail&apos;s Trash, save a draft, or send a reply, forward or new message
            after pressing Send and confirming. It never sends mail on its own and it cannot permanently delete mail.
          </p>
          <p>
            Each person can open only their own mailbox and the shared mailboxes the company has assigned to them by name.
            No one else on RP Intelligence can read a person&apos;s own mailbox.
          </p>
          <p>
            <strong>RPS Inbox</strong> is the same kind of mail manager running on a company computer, with the same
            permissions, for the person who uses that computer.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">How the information is used</h2>
          <p>
            Mail is read so company staff can see and sort it in one place, track jobs, work orders, permits, receipts
            and invoices, and keep company records. It is used for nothing else.
          </p>
          <p>
            The use of information received from Google APIs follows the Google API Services User Data Policy, including
            its Limited Use requirements. Google user data is not sold, is not used for advertising, and is not used to
            train general-purpose AI models.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">Sharing and storage</h2>
          <p>
            Information is not sold or shared with anyone outside Rappahannock Petroleum LLC, except the hosting and
            database providers the company uses to run these tools, or when the law requires it.
          </p>
          <p>
            RPMail keeps a short list for each connected mailbox in the company database so the page loads quickly: who a
            message is from and to, the subject, the date, Gmail&apos;s one-line preview, whether it is read, and any site
            or PO number in it. The full message and its attachments are fetched from Gmail when the person opens them and
            are not stored. Google sign-in keys are kept encrypted in the database and are never shown to anyone.
          </p>
          <p>
            RPS Inbox keeps mail on the company&apos;s own computers. Its sign-in keys are stored in the computer&apos;s
            secure keychain.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">Removing access</h2>
          <p>
            In RPMail, &quot;Disconnect&quot; or &quot;Turn it off&quot; removes the Google sign-in and the stored list for that
            mailbox right away. Access to a connected Google mailbox can also be removed at any time from that Google account under Security,
            then &quot;Your connections to third-party apps and services&quot;. To ask for stored information to be
            deleted, contact the office.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">Contact</h2>
          <p>
            Rappahannock Petroleum LLC, 225 Ritter Rd, Winchester, VA 22602
            <br />
            (540) 869-5033 &middot; econstruction.rp@gmail.com
          </p>
        </section>
      </div>
    </main>
  )
}
