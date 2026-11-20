# RPMail product checklist

Running list for turning hosted RPMail (inside RP Intelligence) into something a company would pay a
subscription for. Source of the list: `~/rps-inbox/PRODUCT-BUILD-PROMPT.md` (Trae, 2026-11-20).

Marks: **Done** = built and on the live site. **Partly** = some of it works, the note says what is missing.
**Missing** = not built. **Waiting on Trae** = cannot move without a decision, money, or a sign-in only he has.

Last audit: 2026-11-20, against `main` at `aa49e8f` (PR #173). Live database at that time: 0 people with RPMail
on, 0 mailboxes connected, 1 company. A real-mailbox pass was done later the same day (see "Tested on a real mailbox" below); items it did not reach are listed there.

## Build order

| Stage | What ships | State |
|---|---|---|
| 1 | Dashboard and list basics: right-click menu on mailbox boxes, hide / put back / reorder boxes, Done list with restore, star, select many, keyboard shortcuts + help sheet, print | shipped 2026-11-20, tried on real mail |
| 2 | Writing mail: attach files (button, drag-drop, paste picture), drafts saved automatically, undo send, From picker on every message, address book fill-in, templates | shipped 2026-11-20, tried on real mail. Formatting, address groups and schedule send moved to later stages |
| 3 | Organizing: labels (create, rename, delete, move), block sender, empty Trash, snooze / remind me, rules, date and sender filters, download all as zip | not started |
| 4 | Mail keeps syncing with nobody watching (scheduled sync, catch-up, alert when a mailbox fails over an hour) + browser / phone / text notifications with quiet hours | not started |
| 5 | One Settings area (profile, mailboxes, signatures, notifications, rules, appearance, defaults) and company admin (read / send / delete per person, blocked-content rule, activity log with export) | not started |
| 6 | Automated tests + a check that runs before anything goes live; "one company cannot see another" proven by tests | shipped 2026-11-20 (done ahead of stages 3 to 5, because there was no test mailbox). 50 tests |
| 7 | Selling it: companies as separate customers, sign-up, trial, Stripe plans and seats, billing page, plan limits, public page, help center, first-run walkthrough, owner view | waiting on Trae (Stripe account, prices, legal wording, product shape) |
| 8 | More providers: Microsoft 365 / Outlook, then any mailbox by IMAP + SMTP | not started (Microsoft needs an Azure app registration = an account) |
| 9 | Trust: two-step sign-in, session list, export my data, delete my account, error tracking, uptime checks, tested restore, Google verification package | not started / partly waiting on Trae |

## Accounts and sign-in

| Item | State | Note |
|---|---|---|
| Connect a mailbox from the screen | Done | "Sign in with Google" per mailbox. |
| Disconnect from the screen | Done | "Sign out" on the mailbox and in its right-click menu. Own mailbox: the person. Shared mailbox: an owner. |
| Reconnect | Done | "Sign in again" on the mailbox header and in the right-click menu. |
| Right-click menu on each dashboard box (Open, Check for new mail, Sign out, Sign in, Sign in again, Hide) | Done | Also on the mailbox names at the left, and a three-dot button on each box for phones. Plus Move earlier / Move later. |
| More than one mailbox per person | Partly | One own mailbox + any number of shared ones. A second personal mailbox is not possible yet. |
| "Which address am I sending from" picker | Done | On every new message, reply and forward. A reply sent from a different mailbox than the one the mail is in still threads for the other side. |
| Gmail and Google Workspace | Partly | Gmail works. A Workspace address (not @gmail.com) is refused by the address check. |
| Microsoft 365 / Outlook | Missing | Stage 8. |
| Any mailbox by IMAP + SMTP with an app password | Missing | Stage 8. |
| Clear message when a sign-in expires, with a one-click fix | Partly | A yellow bar on the mailbox says mail is not arriving, with a Sign in again button. Not yet seen against a really expired Google sign-in. |
| Shared mailboxes: who can read | Done | Ticked per person by an owner. Tech and shop logins only get mailboxes marked "the crew reads this". |
| Shared mailboxes: who can send, who can delete | Missing | Access is all-or-nothing today. Stage 5. |
| Visible record of who did what | Partly | Sends, drafts and moves are recorded in the database; no screen shows them. Stage 5. |

## Everyday email

| Item | State | Note |
|---|---|---|
| Conversation view | Partly | The list groups by conversation; the reader shows one message with links to the others, not the whole thread stacked. |
| Search across all mail | Partly | Typed search covers the last 90 days; "Search all of Gmail" goes further but returns 40 at most. |
| Filter: unread, attachment | Done | |
| Filter: sender, date, label / folder | Missing | Stage 3. |
| Write with formatting (bold, lists, links) | Missing | Plain text only. Stage 5. |
| Attach files by button | Done | Up to 15 files, 20 MB in all. They wait in private storage under the person's own id and are deleted on Send or Save. |
| Drag-and-drop files, paste images | Partly | Both work, but a pasted picture goes along as an attachment, not inside the text (that needs formatting). |
| Drafts saved automatically | Partly | What is typed (and what is attached) is kept in that browser and comes back when the same message is opened again. It does not follow the person to another device, and a draft saved to Gmail Drafts cannot be reopened in RPMail yet. |
| Undo send | Done | After the confirm step a bar counts down with Undo and Send now. The person picks none / 5 / 10 / 20 / 30 seconds. The tab must stay open for those seconds (the browser warns if it is closed). |
| Schedule send | Missing | Stage 4 (needs the scheduled job; it will only ever send what the person scheduled). |
| Reply, reply all | Done | |
| Forward with attachments | Done | Up to 20 MB. |
| Address book fill-in as you type, from mail history | Done | To and Cc offer people from the person's own mailboxes; people they have written to come first. |
| Address book groups | Missing | Stage 5. |
| Signature per mailbox | Done | Per person per mailbox. Plain text. |
| Canned replies / templates | Done | Save as template, Insert a template, Manage templates, in the message box. Each person's own. |
| Out-of-office replies | Missing | Stage 3 (Gmail's own vacation responder, switched from RPMail; needs one more Google permission). |
| Labels / folders: create, rename, delete, move, drag mail in | Missing | Label ids are stored but never shown. Stage 3. |
| Archive, Spam, Delete to Trash, with Undo | Done | |
| Block sender | Missing | Stage 3. |
| Empty Trash | Missing | Stage 3. Needs thought: the Google permission we ask for cannot permanently delete, on purpose. |
| Rules (from X goes to Y, auto-label, auto-archive, never-notify) | Missing | Stage 3. |
| Snooze and remind-me | Missing | Stage 3. |
| Pin and star | Partly | Star: done (it is Gmail's own star, plus a Starred filter). Pin: not built. |
| Mark read / unread | Done | |
| Select many and act on all | Done | Tick boxes in each mailbox list: archive, delete, mark read / unread, Done; 40 at a time, with Undo for archive and delete. |
| Print a message | Done | Print button in the message, or press p. |
| Download attachments | Done | |
| Preview PDFs and images | Partly | They open in a new tab; no preview inside the page. |
| Download all as a zip | Missing | Stage 3. |
| Keyboard shortcuts with a help sheet | Done | Press ? or the Shortcuts button. |
| Right-click menus everywhere | Partly | Messages (open, reply, forward, Done, My Plate, read, star, archive, spam, delete) and mailboxes. Not yet on attachments, My Plate rows or labels. |
| Unread is bold everywhere | Done | Lists, dashboard boxes, sidebar, summary, reader subject. |

## What makes RPMail different

| Item | State | Note |
|---|---|---|
| Dashboard with a box per mailbox | Done | |
| Boxes can be closed, put back and reordered | Partly | Mailbox boxes: yes (right-click: Hide, Move earlier / later; closed boxes listed at the bottom with "put back"). The My Plate / Your jobs / Needs you / Daily summary boxes cannot be closed or moved yet, and there is no drag to reorder. |
| Needs You list | Done | |
| Daily Summary | Partly | Made the first time the person opens RPMail after 6 AM, not at 6 AM on its own. Fixed by stage 4. |
| Done buttons with Undo | Done | |
| See and restore Done items | Done | "Done" section on the dashboard: Show what I marked Done, Put back. |
| "Your jobs" incl. waiting-on-a-reply even if someone else opened it | Done | |
| My Plate beside the mail, Add to My Plate, mark done | Done | |
| Site, job, PO numbers as tags | Partly | Site and PO: yes. Work order numbers: not picked out. |
| Notifications: browser, phone push, text | Missing | RP Intelligence already has phone push for other things; RPMail does not use it. Stage 4. |
| Notification settings, quiet hours, per-mailbox on/off | Missing | Stage 4. |

## Settings a customer expects

| Item | State | Note |
|---|---|---|
| One Settings area for a normal user | Missing | Only owners have a Settings page (people and shared mailboxes). Stage 5. |
| Profile, appearance (light / dark / text size / density), default send address, undo-send delay, time zone, start page | Missing | Times are fixed to Eastern today. Stage 5. |
| Everything that can be turned on can be turned off from the screen | Partly | RPMail on/off and disconnect: yes. Most other things do not exist yet. |

## Company admin

| Item | State | Note |
|---|---|---|
| Invite, remove people, set roles | Done | RP Intelligence's own Users page (not RPMail-specific). |
| Turn RPMail on / off per person | Done | |
| Assign shared mailboxes | Done | |
| Company-wide "blocked content" rule | Partly | The pricing rule is built in for mailboxes marked "the crew reads this" (always includes econstruction.rp). It is not yet a rule a company can write for itself. Stage 5. |
| Activity log (sign-ins, sends, deletes, access changes) with export | Missing | Stage 5. |

## Selling it as a subscription

| Item | State | Note |
|---|---|---|
| Companies as separate customers, proven by tests | Partly | Proven by tests: every mail action is refused across companies and across people, the other mailbox's Google sign-in is never used, and an owner cannot reach into another company. (The tests were checked by breaking the rule on purpose: they fail.) Still to do in stage 7: sign-up for a second company, and a Gmail address can only exist once across all companies. |
| Sign-up, free trial, plans per person, seats, cancel, receipts, failed payments, billing page (Stripe) | Missing | Waiting on Trae: Stripe account and prices. |
| Plan limits with friendly messages | Missing | Stage 7. |
| Public product page with prices, sign-up | Missing | Stage 7. |
| Terms of service | Missing | Waiting on Trae (legal wording to approve). |
| Privacy policy | Partly | A privacy page exists at /privacy, written for our own staff use. Needs a customer version Trae approves. |
| Help center with how-to guides | Missing | Stage 7. |
| First-run walkthrough | Partly | There is a "Turn on RPMail" screen and a connect screen; no guided tour after that. |
| Owner view: customers, plans, revenue, mailboxes, errors | Missing | Stage 7. |

## Trust, safety and reliability

| Item | State | Note |
|---|---|---|
| Sign-in tokens stored encrypted, never logged | Done | Supabase Vault; only the server can read them; errors never print them. |
| Optional two-step sign-in | Missing | Stage 9. |
| Session list with "sign out everywhere" | Missing | Stage 9. |
| Export all my data | Missing | Stage 9. |
| Delete my account, and deletion really removes it | Partly | Turning RPMail off removes the Google sign-in; the short mail list for that mailbox stays until reconnect. Stage 9. |
| Google verification and yearly security review | Missing | Write-up and prepared material in stage 9. Costs money and needs Trae. |
| Mail keeps syncing without anyone watching | Missing | Mail is only checked while someone has the RPMail page open. Stage 4. |
| Retries and respect for Google's limits | Done | Waits and retries when Google says slow down; loads in chunks. |
| Catch up after an outage | Partly | Catches up the next time the page is open. Automatic once stage 4 lands. |
| Alert to Trae when a mailbox has failed for over an hour | Missing | Stage 4. |
| Error tracking, uptime checks | Missing | Stage 9. |
| Database backups and a tested restore | Partly | Supabase Pro takes daily backups. A restore has not been tested for RPMail. |
| Works on a phone, installable | Partly | RP Intelligence is installable and the RPMail page folds to one column. Not checked on a real phone with real mail. |
| Automated tests + a check before going live | Partly | 50 tests (`npm test`) against a stand-in Gmail and a stand-in database: access rules, loading, reading, filing with Undo, sending, the pricing rule. They run on every pull request (GitHub "Tests") and inside the Vercel build, so a failing test stops a deploy. Not covered: the screens themselves (no browser tests), and the stand-ins are not the real Gmail or the real database. |

## Tested on a real mailbox (2026-11-20)

Test mailbox: dodson3.trae@gmail.com, added as the shared mailbox "RPMail Test" on Trae's login (hosted RPMail is on for
Trae; his page links to his local RPMail). Trae did the Google sign-in. Clicked through in his Chrome. Test mail was only
ever sent from that address to itself.

Worked live: Google sign-in and connect; first load (1,145 messages); dashboard counts, Needs you, Daily summary; list with
unread in bold; open a message (HTML, internet pictures hidden, not marked read); star; archive, delete and Undo for both;
right-click menu on a message; mailbox menu (three dots), Hide and put back; Done, the Done list and Put back; compose;
attach a file; kept draft restored after a reload with its attachment; confirm step; undo countdown; send; reply (threads
into one conversation); forward (carries the attachment); open an attachment; select two and Mark read; Search all of
Gmail; keyboard shortcuts and the help sheet.

Found and fixed the same day (PRs #178, #179, #180): loading in bursts made Gmail refuse a message being opened or sent
(now paced, and the message says "Gmail is busy"); load requests ran past the 60 second limit and the page stopped after
one failure (shorter requests, retries); no "Sending..." note after the undo countdown; newsletters Gmail files under
Promotions / Social / Forums showed in Needs you; naming a template used a browser pop-up.

Still not tested:
- Phone width (the browser tool could not shrink the window), and a real phone.
- The print dialog itself (the Print button was not pressed, to avoid a system dialog).
- Reply all with several people, and replying from a different mailbox (only one mailbox is connected).
- Address fill-in with real contacts (the test mailbox is nearly all newsletters, which it skips on purpose).
- Sign out / Sign in again on a connected mailbox, an expired Google sign-in, Move earlier / later (needs two mailboxes).
- Two people in the same shared mailbox at once; a tech login being refused a pricing mailbox (covered by the automated tests only).
- Spam, Add to My Plate from a message, signature editing, drag-and-drop and pasting a picture.

Known rough edges from the pass (not fixed yet):
- First load runs at about 4 messages a second (each message is fetched on its own). Fetch them in batches. Stage 4.
- Opening a message takes 1.3 to 3.9 seconds.
- Mail goes out under the person's RP Intelligence name ("Trae Dodson - Admin"). Needs a "name on outgoing mail" setting. Stage 5.
- Needs you has no age limit, so unanswered mail from a year ago shows in a mailbox connected for the first time.
- Confirmations (sign out, delete a template, turn RPMail off) use browser pop-ups rather than on-page boxes.
- After the undo countdown the open message does not show the reply under "Also in this conversation" until it is reopened.

## Stage log

- 2026-11-20: real-mailbox pass with dodson3.trae@gmail.com; fixes in PRs #178 (Gmail pacing, Busy message, retrying loader), #179 (log Gmail refusals: status and reason only), #180 (Gmail categories count as newsletters, on-page template naming).
- 2026-11-20: tests (stage 6) on branch `feat/rpmail-tests`: vitest, `tests/rpmail/{fakes,setup}.ts` (stand-in database + stand-in Gmail), `access.test.ts`, `mail.test.ts`, `pure.test.ts`; `.github/workflows/tests.yml`; package.json `vercel-build` runs the tests before `next build`. The tests found no bug in stages 1 and 2.
- 2026-11-20: stage 2 built on branch `feat/rpmail-stage2`: `lib/rpmail/compose-ops.ts`, table `rpmail_templates` and private bucket `rpmail-outbox` (both applied), compose box rewritten, undo-send bar in rpmail-app.tsx, `undo_secs` in `rpmail_prefs`. Known loose end: a file attached and then abandoned (tab closed without Discard) stays in the bucket until the stage 4 clean-up job exists. Checked by type-check, lint and a production build only.
- 2026-11-20: audit written. Stage 1 built on branch `feat/rpmail-product`: new table `rpmail_prefs` (applied), `lib/rpmail/extras.ts`, new API actions prefs / star / bulk / done_list. Checked by type-check, lint, role-access check and a production build. NOT checked in a browser with mail in it: nobody has RPMail turned on yet and there is no test mailbox.
