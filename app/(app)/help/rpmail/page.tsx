import Link from 'next/link'
import { RPMAIL_GUIDE } from '@/lib/help'

// Technical Help > Using RPMail. Plain steps for staff, in the words the screens use. Open to everyone who signs in,
// like the rest of /help. Keep it in step with components/rpmail when a button or label changes.

type Part = { id: string; title: string; steps: React.ReactNode[]; note?: React.ReactNode }

const PARTS: Part[] = [
  { id: 'start', title: 'Turn it on and connect your email', steps: [
    <>Open <b>RPMail</b> in the menu and press <b>Turn on RPMail</b>.</>,
    <>Press <b>Sign in with Google</b> and pick your work Gmail. Google asks if RP Intelligence may read and send your mail: press <b>Allow</b>.</>,
    <>Your mail starts loading. A big mailbox takes a few minutes; you can use RPMail while it fills in.</>,
  ], note: <>Your mail stays in Gmail. RPMail only keeps a short list (who, subject, date) so it can sort it. Shared mailboxes, like a department inbox, are given to you by an owner.</> },
  { id: 'dash', title: 'The Dashboard', steps: [
    <><b>Dashboard</b> shows a box for each of your mailboxes, plus <b>My Plate</b>, <b>Your jobs</b> and <b>Needs you</b>.</>,
    <><b>Needs you</b> is mail from the last 30 days that asks you something and nobody has answered yet.</>,
    <>Right-click a mailbox box (or press its three dots) to open it, check for new mail, hide it, or move it earlier or later.</>,
  ] },
  { id: 'read', title: 'Read mail', steps: [
    <>Press a mailbox name on the left. The tabs across the top are <b>Inbox</b>, <b>Needs you</b>, <b>Sent</b>, <b>Drafts</b>, <b>Filed</b>, <b>Snoozed</b> and <b>All</b>.</>,
    <>Press a message to open the whole conversation, oldest at the top. The newest messages are open; the rest are one line each. Press a line to open it.</>,
    <>Opening a message does <b>not</b> mark it read. Press <b>Mark read</b> when you are done with it.</>,
    <>Pictures from the internet are hidden until you press <b>Show pictures</b>. Under a reply, the mail it answered is folded away: press <b>Show the quoted mail</b> to see it.</>,
  ] },
  { id: 'write', title: 'Write, reply and forward', steps: [
    <>Press <b>New message</b>, or <b>Reply</b>, <b>Reply all</b> or <b>Forward</b> on a message.</>,
    <>Type a name in <b>To</b>; RPMail offers people you have emailed. Pick a group to add everyone in it.</>,
    <>Use the bar over the message for <b>bold</b>, <i>italic</i>, underline, lists and links (or Ctrl / Cmd with B, I, U, K).</>,
    <>To put a picture in the text, paste it or press the picture button. To attach a file, press <b>Attach files</b> or drag it onto the box.</>,
    <>Press <b>Send</b>, check who it is going to, then <b>Yes, send</b>. For a few seconds a bar lets you <b>Undo</b>.</>,
  ], note: <>Mail never goes out by itself: only when you press Send and confirm. Pricing can never go to or from a mailbox the crew reads; RPMail stops the send and tells you why.</> },
  { id: 'drafts', title: 'Drafts', steps: [
    <>Press <b>Save to Gmail Drafts</b> to keep a message for later. It is in Gmail Drafts, so you can finish it in Gmail too.</>,
    <>To finish it in RPMail, open the mailbox and press <b>Drafts</b>, then the draft. Send it, or save it again.</>,
    <>If you just close the box, what you typed is kept in this browser and comes back the next time you open the same message.</>,
  ] },
  { id: 'file', title: 'Archive, delete and undo', steps: [
    <><b>Archive</b> takes a conversation out of the inbox; it is still in <b>All</b>. <b>Delete</b> moves it to Gmail Trash, which keeps it 30 days.</>,
    <>Every move shows an <b>Undo</b> for a few seconds.</>,
    <>Tick the boxes beside several messages to archive, delete, mark read or label them all at once.</>,
    <><b>Done</b> takes a message off your own lists without changing anything in Gmail or for anyone else.</>,
  ] },
  { id: 'organize', title: 'Labels, snooze, rules and blocking', steps: [
    <><b>Label</b> on a message puts it under one of your Gmail labels. Drag a message onto a label to move it there.</>,
    <><b>Snooze</b> hides a conversation until the time you pick. <b>Remind me</b> tells you at that time if nobody has answered.</>,
    <><b>Make a rule</b> decides what happens to new mail from a sender (label it, archive it, mark it read, no notification). <b>Block sender</b> sends their mail straight to Trash.</>,
    <>All of these are under <b>Labels and rules</b> at the top of a mailbox, where you can change or remove them.</>,
  ] },
  { id: 'settings', title: 'Your settings', steps: [
    <>Press <b>Settings</b> at the top of RPMail.</>,
    <>Set the name people see on your mail, a signature for each mailbox (with formatting), which mailbox new mail starts from, and how long you have to undo a send.</>,
    <>Pick your time zone, the page RPMail opens on, compact lists, and address groups (a name for several people you email together).</>,
  ] },
  { id: 'phone', title: 'Notifications and your phone', steps: [
    <>Press <b>Notifications</b> at the top of RPMail to get a notice when new mail arrives. Pick which mailboxes, what kind of mail, and quiet hours.</>,
    <>On an iPhone, notifications only work from the RP Intelligence icon on your Home Screen. See <Link className="underline" href="/help/home-screen">Add RP Intelligence to your Home Screen</Link>.</>,
    <>Press <b>Send a test notification</b> to check it reaches you.</>,
  ] },
  { id: 'trouble', title: 'When something is wrong', steps: [
    <>A yellow bar saying mail is not arriving: press <b>Sign in again</b> on that mailbox and sign in to Google.</>,
    <>&quot;Gmail is busy with this mailbox&quot;: wait a minute and try again.</>,
    <>&quot;Blocked: this mentions pricing&quot;: send it from your own email, or take the pricing out (check the quoted mail and the file names too).</>,
    <>A shared mailbox you should have is missing, or you can read but not send: ask an owner. They set this in Settings, RPMail.</>,
  ] },
]

export default function RpmailHelpPage() {
  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="rp-title">{RPMAIL_GUIDE.title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{RPMAIL_GUIDE.summary}</p>
        </div>
        <Link href="/help" className="text-sm text-muted-foreground hover:text-foreground print:hidden">← Technical Help</Link>
      </div>
      <nav className="rp-card p-4 mb-5 print:hidden" aria-label="In this guide">
        <p className="rp-label mb-2">In this guide</p>
        <ol className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 list-decimal pl-5">
          {PARTS.map(p => <li key={p.id}><a className="hover:underline" href={'#' + p.id}>{p.title}</a></li>)}
        </ol>
      </nav>
      <div className="space-y-4">
        {PARTS.map((p, n) => (
          <section key={p.id} id={p.id} className="rp-card p-5 scroll-mt-20 break-inside-avoid">
            <h2 className="font-semibold text-foreground mb-2">{n + 1}. {p.title}</h2>
            <ol className="list-decimal pl-5 space-y-1.5 text-sm text-foreground">{p.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            {p.note && <p className="mt-3 rounded-md bg-info-soft border border-info/30 px-3 py-2 text-sm text-foreground">{p.note}</p>}
          </section>
        ))}
      </div>
    </div>
  )
}
