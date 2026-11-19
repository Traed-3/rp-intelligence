import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy | Rappahannock Petroleum LLC',
  description: 'How RP Intelligence and RPS Inbox handle information.',
}

// Public page (listed in proxy.ts publicPaths). Google's sign-in setup links to it.
export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-2xl rp-card p-8 space-y-5 text-sm leading-6 text-gray-700">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Privacy Policy</h1>
          <p className="text-gray-500">Rappahannock Petroleum LLC &middot; RP Intelligence and RPS Inbox</p>
          <p className="text-gray-500">Last updated November 19, 2026</p>
        </div>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">Who this covers</h2>
          <p>
            RP Intelligence and RPS Inbox are internal tools built by Rappahannock Petroleum LLC for its own employees.
            They are not offered to the public. Only people the company has given an account to can use them.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">What the tools read</h2>
          <p>
            The tools read email from mailboxes that Rappahannock Petroleum LLC owns, such as its construction, invoicing
            and receipt mailboxes. When a company mailbox is connected with Google sign-in, the tools ask Google for
            read-only access to that mailbox. They cannot send, delete or change mail in it.
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
            database providers the company uses to run these tools, or when the law requires it. RPS Inbox keeps mail on
            the company&apos;s own computers. Sign-in keys are stored in the computer&apos;s secure keychain.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">Removing access</h2>
          <p>
            Access to a connected Google mailbox can be removed at any time from that Google account under Security,
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
