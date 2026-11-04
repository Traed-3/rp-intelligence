# Porchcall — Version One Product Spec

> **What Porchcall is, in one sentence:** a simple website where live-music
> **artists** and **venues** (bars, coffee shops, restaurants, house-concert
> hosts) find each other, agree on a date, and lock in a paid gig.
>
> **Who this document is for:** Trae, the owner. It's written in plain English
> so you can picture every screen. You do **not** need to know code to read it.

---

## 1. The big picture (read this first)

Think of Porchcall like a tiny two-sided marketplace, the same shape as Airbnb
but for live music:

- **One side is the artist** — a solo musician or a band looking for places to play.
- **The other side is the venue** — a place that wants live music on a given night.

**The single most important thing v1 has to prove** is that the *core loop*
works end to end:

> An artist and a venue can find each other → talk → agree on a date → confirm
> the booking → and money actually changes hands to hold the date.

If that one loop works and feels good, Porchcall is real. Everything else is
polish. So version one builds **only** what that loop needs, and nothing else.

Every feature below is tagged:

- **MUST HAVE** — part of the 4-week build. The loop breaks without it.
- **LATER** — a good idea we are deliberately *not* building yet. Written down
  so it isn't forgotten, and so we can say "no" to it on purpose.

There is also a short **"Simplifying decisions"** note under most sections —
the specific corner we're cutting to fit four weeks. These are the choices that
keep the project small.

---

## 2. The four-week scope, at a glance

Here is the whole of version one on one screen. If a feature isn't in this
"MUST HAVE" column, it is not getting built in the first four weeks.

| Area | MUST HAVE (build now) | LATER (write down, skip) |
|---|---|---|
| Accounts | Email sign-up/login, pick "Artist" or "Venue" | Social login, phone login, teams |
| Artist profile | Name, photo, bio, genres, location, price range, 1 audio/video link | Multiple media, reviews, press kit, followers |
| Venue profile | Name, photo, type, location, capacity, description | Reviews, multiple photos, house rules doc |
| Availability | Artist marks dates as Available / Busy on a calendar | Recurring availability, time-of-day slots, sync to Google Calendar |
| Gig posting | Venue posts a gig (date, time, pay, details) | Recurring gigs, multi-slot nights, templates |
| Find & apply | Browse gigs, apply; venue browses artists, invites | Search filters galore, maps, recommendations, ranking |
| Messaging | 1-to-1 thread tied to a gig | Attachments, group chat, read receipts, push notifications |
| Booking | Venue confirms one artist → booking is "Confirmed" | Contracts/e-sign, cancellation policies, rescheduling flow |
| Payment | Deposit paid online to lock the date (Stripe Checkout) | Full escrow, automatic payouts, refunds, tipping, payment plans |
| Notifications | Email on the few key events | In-app bell, SMS, real-time push |

**Rule of thumb for the whole build:** when in doubt, cut it to the LATER
column. A small thing that ships in four weeks and that real artists and venues
actually use beats a big thing that's still half-built in week eight.

---

## 3. Who the two users are

**Artist** (example: "Maggie & the Wheels," a duo)
- Wants: to find places to play and get paid, without cold-emailing every bar in town.
- Cares about: showing off their sound, controlling which nights they're free, getting a clear yes/no.

**Venue** (example: "The Blue Porch Coffeehouse")
- Wants: to fill a Friday night with good live music without a lot of phone tag.
- Cares about: seeing who's available, hearing what they sound like, locking the date so nobody flakes.

A single person could be both (a musician who also hosts house concerts). For
v1 we keep it simple: **one account is one role.** If someone needs both, they
make two accounts. (Combining roles is **LATER**.)

---

## 4. Accounts & getting in the door — **MUST HAVE**

### Screen: Sign up
Plain English: A clean page with the Porchcall logo and two big buttons —
**"I'm an Artist"** and **"I'm a Venue."** You tap one, enter your email and a
password, and you're in. The button you picked decides which kind of profile
you'll build next. That's the whole choice — no long form yet.

### Screen: Log in
Plain English: Email + password, plus a "Forgot password?" link. Nothing fancy.

**Simplifying decision:** email + password only. No "Sign in with Google/Apple,"
no phone numbers, no team invites. (All **LATER**.)

---

## 5. Artist profile — **MUST HAVE (core)**

This is the artist's storefront. A venue decides "yes, I want them" almost
entirely from this page, so it has to look good even though it's simple.

### Screen: Edit My Artist Profile
Plain English: A single scrollable form the artist fills out about themselves:

- **Profile photo** — one image (band photo or headshot). **MUST HAVE**
- **Artist / band name** — **MUST HAVE**
- **Home city & region** — e.g. "Fredericksburg, VA." Used so venues nearby can find them. **MUST HAVE**
- **Genres** — pick a few tags from a fixed list (Folk, Rock, Country, Jazz, Acoustic, etc.). **MUST HAVE**
- **Short bio** — a paragraph: who they are, what a night with them sounds like. **MUST HAVE**
- **Typical pay range** — e.g. "$150–$300 a night." Sets expectations up front. **MUST HAVE**
- **One "listen/watch" link** — a single YouTube, Spotify, or SoundCloud link. We show it as a clickable link (and embed the player if it's easy). **MUST HAVE**

Everything saves with one **Save** button. When they're done there's a
**"View my public profile"** link so they see exactly what a venue sees.

### Screen: Public Artist Profile (what a venue sees)
Plain English: The read-only version of the above — photo up top, name, city,
genre tags, the bio, the pay range, and the "Listen" link. At the bottom, if the
venue is looking at this from inside a gig, there's an **"Invite to this gig"**
button (covered in §9).

**Simplifying decisions:**
- One photo, one media link. Photo galleries, multiple songs, and a full press
  kit are **LATER**.
- No public reviews or star ratings in v1. Trust comes from the profile itself
  and from messaging. Reviews are **LATER**.

---

## 6. Venue profile — **MUST HAVE (core)**

The venue's storefront. An artist decides whether a gig is worth applying to
partly from the gig details and partly from this page.

### Screen: Edit My Venue Profile
Plain English: The venue's version of the same simple form:

- **Photo of the space** — one image. **MUST HAVE**
- **Venue name** — **MUST HAVE**
- **Venue type** — pick one: Bar, Coffee Shop, Restaurant, House Concert, Brewery, Other. **MUST HAVE**
- **City & address** — city is public; full address is only revealed after a booking is confirmed (privacy). **MUST HAVE**
- **Approximate capacity** — "Seats about 40." Helps artists picture the room. **MUST HAVE**
- **Description** — the vibe, the kind of music that works, whether there's a PA/sound system. **MUST HAVE**

One **Save** button, plus **"View my public profile."**

### Screen: Public Venue Profile (what an artist sees)
Plain English: Read-only — photo, name, type, city, capacity, description. If
there's a currently open gig at this venue, show it here with an **"Apply"**
button.

**Simplifying decision:** exact street address stays hidden until a booking is
confirmed, so we don't have to build a whole address-privacy system — just a
single "show address only when Confirmed" rule.

---

## 7. Availability calendar — **MUST HAVE (kept very simple)**

This is where artists tell the world which nights they can play. It's the piece
people most often over-build, so we're keeping it deliberately tiny.

### Screen: My Availability
Plain English: A normal month calendar (like the one on your phone). Each day is
a tappable box. Tapping a day toggles it between two states:

- **Available** (green) — "I'll play a gig this night."
- **Busy / not shown** (plain) — the default; the artist hasn't offered this night.

That's it — a grid of days you turn green. Arrows at the top move to next month /
previous month. A tiny legend explains the colors.

**How it's used elsewhere:** when a venue looks at an artist to invite, we can
show "Available on your gig date? ✅/❌" by checking this calendar. That's the
whole payoff — it saves a round of "are you free that night?" messages.

**Simplifying decisions:**
- Only two states (Available / not). No "maybe," no morning/afternoon/evening
  slots, no marking specific hours. (**LATER**.)
- No repeating rules ("every Friday"). You tap each day. (**LATER**.)
- No syncing with Google Calendar or iCal. (**LATER**.)

---

## 8. Gig posting — **MUST HAVE**

A "gig" is one specific open slot at a venue on a specific night. This is the
thing artists apply to.

### Screen: Post a Gig (venue only)
Plain English: A short form the venue fills out:

- **Title** — e.g. "Friday Night Acoustic Set." **MUST HAVE**
- **Date** — pick a day. **MUST HAVE**
- **Start & end time** — e.g. 7:00–9:00 PM. **MUST HAVE**
- **Pay offered** — a dollar amount, e.g. "$200 flat." **MUST HAVE**
- **What we're looking for** — a few sentences: genre, vibe, whether they need to bring their own gear. **MUST HAVE**

Hit **Post**, and the gig goes live and shows up in the browse list. Each gig has
a status: **Open** → **Booked** → **Completed**. (v1 flips it to Booked
automatically when a booking is confirmed; "Completed" can just mean the date has
passed.)

### Screen: Browse Gigs (artist's home base)
Plain English: A simple scrollable list of open gigs. Each row is a card:
venue name, city, date, pay, and the title. **The whole card is clickable** and
opens the gig detail. At most one lightweight filter — **by city** — so artists
can see gigs near them. No map, no big filter panel.

### Screen: Gig Detail
Plain English: The full gig — all the fields above, plus the venue's profile
info, plus one action button that depends on who's looking:
- An **artist** sees **"Apply to this gig."**
- The **venue that owns it** sees the list of applicants and an **"Invite an artist"** option.

**Simplifying decisions:**
- One gig = one night, one slot. No recurring gigs, no "we need two acts,"
  no saved templates. (**LATER**.)
- Filtering is city-only. Fancy search, genre filters, sorting, and maps are
  **LATER**.

---

## 9. Applying & inviting — **MUST HAVE**

This is how the two sides connect. There are two directions, and v1 supports
both because together they make the marketplace feel alive.

### Direction A — Artist applies to a gig
Plain English: On a Gig Detail page, the artist taps **"Apply."** A small box pops
up: "Add a short note (optional)" — e.g. "Love this room, here's my set list."
They hit **Send Application.** The venue now sees them in that gig's applicant
list, and a message thread opens between them (see §10).

### Direction B — Venue invites an artist
Plain English: From an artist's public profile (or a simple "Browse Artists"
list), the venue taps **"Invite to a gig,"** picks one of their open gigs from a
short dropdown, and sends it. The artist gets an invitation they can **Accept** or
**Decline**, and a message thread opens.

### Screen: My Applications / My Invitations (artist)
Plain English: One page with two short lists — gigs I applied to (with status:
Applied / Invited / Booked / Passed) and gigs I was invited to. Each row links
to the gig and the message thread.

### Screen: Applicants (venue, inside a gig)
Plain English: On the venue's own Gig Detail, a list of everyone who applied or
was invited, each with their photo, name, pay range, and — if the gig has a date —
a green ✅ or ❌ showing whether they're **Available that night** (pulled from
§7). Next to each is **"Message"** and **"Confirm booking."**

**Simplifying decision:** no ranking, scoring, or recommendations — it's just a
list in the order people applied. (**LATER**.)

---

## 10. Messaging — **MUST HAVE (basic)**

People need to sort out the small stuff — load-in time, what gear is there,
"can you do two sets?" — before committing. So v1 has plain 1-to-1 messaging.

### Screen: Messages (inbox)
Plain English: A list of conversations, newest on top. Each row: the other
person's name/photo, the gig it's about, and a preview of the last message.
Tap to open.

### Screen: Conversation
Plain English: The familiar chat layout — their messages on the left, yours on
the right, a text box at the bottom, a **Send** button. At the very top, a small
banner names the gig this chat is about with a link back to it. Every thread is
**tied to one gig**, which keeps conversations organized and gives us a natural
place to show the **"Confirm booking"** button (for the venue).

**Simplifying decisions:**
- Text only. No photo/file attachments, no emoji reactions, no voice notes. (**LATER**.)
- No live/instant delivery required — the page loads new messages when you open
  or refresh it, and we send an **email** ("You have a new message") so nobody
  misses it. True real-time chat and push notifications are **LATER**.
- One-to-one only, always attached to a gig. No group threads. (**LATER**.)

---

## 11. Booking confirmation — **MUST HAVE**

This is the moment the deal becomes real. Only the **venue** can confirm, and
they confirm exactly **one** artist per gig.

### The flow, in plain English
1. Inside a gig (from the applicant list or the message thread) the venue taps
   **"Confirm booking"** on the artist they chose.
2. Porchcall shows a summary: *"You're booking Maggie & the Wheels for Fri, Sep 12,
   7–9 PM, for $200. A $50 deposit holds the date."* (Deposit rule explained in §12.)
3. The venue continues to payment (§12). **The booking only becomes Confirmed
   once the deposit is paid** — this is the key rule that makes the deposit
   meaningful.
4. On success: the gig flips to **Booked**, everyone else who applied gets a
   polite "This gig has been filled" note, the artist's calendar date is marked
   **Busy** automatically, and the venue's exact address is now revealed to the
   booked artist.

### Screen: Booking Confirmed
Plain English: A clean confirmation page both sides can see — who, where (now
with full address), when, the agreed pay, the deposit paid, and the amount due
on the night. This page is the "source of truth" for the gig. An email version
of the same summary goes to both people.

**Simplifying decisions:**
- No contracts or e-signatures. The Booking Confirmed page + email *is* the
  agreement for v1. (Contracts are **LATER**.)
- No built-in cancellation or rescheduling flow. If plans change, they message
  each other and sort it out; an admin can help manually. (Self-serve cancel/
  reschedule is **LATER**.)

---

## 12. Payment — **MUST HAVE (deliberately minimal)**

Payment is where marketplaces get complicated fast, so v1 does the **smallest
thing that makes a booking feel binding**: an online **deposit** that the venue
pays to lock the date. We are **not** building full escrow in four weeks.

### How it works in plain English
- When the venue confirms a booking (§11), they pay a **deposit** — a small,
  fixed slice of the pay (say 25%, or a flat $50; we pick one simple rule).
- Payment happens through **Stripe Checkout** — the same trusted card screen
  you've seen on thousands of sites. Porchcall never touches raw card numbers;
  Stripe handles it. This is what keeps the payment work small *and* safe.
- Once Stripe says "paid," the booking becomes **Confirmed** and the date is held.
- **The rest of the money is paid in person** on the night of the gig (cash,
  Venmo, whatever the two already do). Porchcall's job in v1 is just to make the
  commitment real, not to move every dollar.

### Screen: Deposit Checkout
Plain English: A short summary — gig, artist, total pay, deposit amount — and a
**"Pay deposit"** button that hands off to Stripe's secure card page. After
paying, they land back on the **Booking Confirmed** page.

### Screen: Receipt / Payment status
Plain English: On the Booking Confirmed page and in the email, a line that says
**"Deposit of $50 paid on Sep 3 — $150 due on the night."** Simple and clear.

**Simplifying decisions (important — this is the biggest scope cut):**
- **Deposit only, venue-pays-artist direction.** We hold/charge a deposit to make
  the booking stick. Full escrow (holding the *whole* fee until after the show)
  is **LATER**.
- **No automatic payouts to artists.** For v1 the deposit can go to a single
  Porchcall Stripe account and we settle up simply, or the deposit is a hold that
  releases — whichever Stripe setup is fastest. **Automated artist payouts,
  refunds, disputes, and tipping are all LATER.**
- **No refunds flow in the app.** If a deposit needs returning, an admin does it
  by hand in Stripe. (Self-serve refunds are **LATER**.)
- One simple deposit rule for everyone — not per-venue custom amounts. (**LATER**.)

> If four weeks gets tight, payment is the one place to trim further: the
> fallback is "Confirm booking" marks the gig Booked **without** taking money,
> and the deposit ships in week five. Keep this fallback in your back pocket.

---

## 13. Notifications — **MUST HAVE (email only)**

v1 keeps people in the loop with **plain email** at the few moments that matter.
No in-app bell, no SMS, no push. Email is enough to make the loop work.

Emails we send (**MUST HAVE**):
- You got a new application (to the venue).
- You were invited to a gig (to the artist).
- You have a new message.
- Your booking is confirmed + deposit receipt (to both).
- (To the artists who didn't get it) "This gig has been filled."

**LATER:** in-app notification bell, text messages, real-time push, digest
emails, reminders the day before the gig.

---

## 14. The one screen tying it together — the Dashboard/Home

Each user needs a "home base" they land on after login.

### Artist Home — **MUST HAVE**
Plain English: Top of page — "Browse gigs near you." Below — two short lists:
**My upcoming bookings** and **My open applications/invitations.** A link to edit
profile and to set availability. That's the artist's whole world on one page.

### Venue Home — **MUST HAVE**
Plain English: Top — a **"Post a gig"** button. Below — **My open gigs** (each
showing how many applicants) and **My upcoming bookings.** Links to edit profile
and browse artists.

**Simplifying decision:** the dashboards are just tidy lists and one or two
buttons — no charts, stats, or analytics. (**LATER**.)

---

## 15. What we are explicitly NOT building in v1 (the "no" list)

Writing these down is how we protect the four weeks. All of these are good ideas
and all are **LATER**:

- Reviews, ratings, and reputation scores
- Search filters, maps, genre/price sorting, recommendations
- Contracts, e-signatures, cancellation/reschedule flows
- Full payment escrow, automatic payouts, refunds, tipping, invoices
- Real-time chat, attachments, group messages, SMS/push notifications
- Google Calendar sync, recurring availability, time-of-day slots
- Photo galleries, full press kits, multiple media links
- Combined artist+venue accounts, teams, multiple staff logins
- Public artist/venue directories, discovery feed, "featured" placement
- Admin dashboard beyond what one person needs to run it by hand

If someone asks for any of these during the build, the answer is: "Great idea —
that's on the v2 list." Say yes to the idea, no to the timing.

---

## 16. The core loop, one more time (the acceptance test)

Version one is "done" when a real artist and a real venue can do all of this
without anyone helping them:

1. **Venue** signs up, fills out its profile, and **posts a gig.**
2. **Artist** signs up, fills out its profile, marks some nights **Available**,
   and **applies** to the gig (or gets **invited**).
3. The two **message** back and forth and agree.
4. The **venue confirms** the booking and **pays the deposit.**
5. Both get a **Booking Confirmed** page + email; the date is locked; the address
   is shared.

If a stranger can walk through those five steps start to finish, Porchcall v1
works. Everything in the LATER column can wait until that's true.

---

## 17. A realistic four-week shape (so you can picture the build)

This is a rough map, not a promise — it shows the order things get built so the
loop comes together piece by piece and stays demoable the whole way.

- **Week 1 — Foundations:** accounts (sign up / log in / pick role), the two
  profile screens, and the Home dashboards. End of week: people can sign up and
  build a profile.
- **Week 2 — The marketplace:** gig posting, browse gigs, gig detail, and the
  availability calendar. End of week: venues can post, artists can see gigs.
- **Week 3 — Connecting:** applying, inviting, and messaging. End of week: the
  two sides can find each other and talk.
- **Week 4 — Closing the deal:** booking confirmation, Stripe deposit, the
  confirmation page, and the email notifications. Then test the whole loop end to
  end. End of week: the acceptance test in §16 passes.

Payment is last on purpose — it's the riskiest piece, and if week four gets
tight, the §12 fallback (confirm without taking money) keeps the loop shippable.

---

*End of Porchcall v1 spec. Keep it small, ship the loop, learn from real users,
then reach into the LATER column.*
