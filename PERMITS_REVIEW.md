# Permits — what got built and how to check it

Hi Trae. This is the new **Permits** feature inside the Construction module. It replaces the
permit spreadsheet. Everything below is written so you don't need to touch any code.

Nothing was merged into your live site yet. This is all on a separate branch called
`claude/construction-module-tjsiwf`, waiting for you to look it over. The instructions to keep it
or throw it away are at the very bottom.

---

## How to see it

**Easiest — the preview link (no computer setup):**
When this branch is pushed to GitHub, Vercel automatically builds a private **Preview**
website for it. Open your project on [vercel.com](https://vercel.com) → **Deployments** → find the
one labeled `claude/construction-module-tjsiwf` → click **Visit**. Log in the same way you always
do. This preview already has all 25 permits loaded (I loaded the real data into the database).

**On your Mac, if you'd rather run it locally:**
1. Open the **Terminal** app.
2. Copy-paste this and press Return (it moves into your project folder):
   ```
   cd ~/"Documents/RPS Maintenance & Asset Project/rps-maintenance"
   ```
3. Copy-paste this and press Return (it starts the app — first time takes a minute):
   ```
   npm install && npm run dev
   ```
4. Open your web browser to **http://localhost:3000** and log in.

**Where the new screens live (the menu path):**
- Click **Construction** in the left menu → you'll land on the Construction dashboard.
- Click the new **Permits** tile. That's the **Permit Board** — every permit, one row each.
- From the Permit Board, the top-right links go to **Jurisdictions** and **Sites**.

| Screen | What it is | Address (after your site name) |
|---|---|---|
| Permit Board | The main list of permits | `/construction/permits` |
| Jurisdictions | The reusable cheat sheet per issuing office | `/construction/permits/jurisdictions` |
| Sites | Every store, with a Ready / Not-ready flag | `/construction/permits/sites` |
| A single site | One store, its permits, deliverables | `/construction/permits/sites/…` |
| Alerts | The 5 warnings, on the Construction dashboard | `/construction` |

---

## Click-checklist — try these in order

Do these on the preview link (or localhost). This walks the five things you specifically asked me
to prove out.

1. **The board shows 25 permits.** Open **Construction → Permits**. The list is every *required*
   permit — count the rows, it's **25**. The subtitle also says "25 shown."

2. **Changing a status is remembered.** On the Permit Board, find any row and use the colored
   **Status** dropdown to change it (e.g. move one to "In Progress"). Then open that permit's site
   (click the row) and expand **History** under the permit — you'll see a dated line saying who
   changed it and from what to what. Every status change is logged; nothing is overwritten silently.

3. **★ Test C — auto-resolve.** Open site **`33701`**. Under the Permits section, use **Add a
   permit** to add a **Building** permit and set it to **Unknown** (this is the rare manual case —
   normally you'd only do this if a jurisdiction asked). Now set the site's **`33701-ELEC`** status to
   **"Permit In-Hand."** The Unknown building permit automatically flips to **Not Required**, and its
   History says **"auto-resolved: electrical issued."** (Once the electrical is in hand, the
   jurisdiction didn't want anything else — the software clears it so nothing hides behind an issued
   electrical permit.)

4. **★ Test D — license mismatch alert.** Go to **Construction** (the dashboard). One of the four
   amber alert boxes is **"License mismatch."** Click it. It flags **`34688-ELEC`** — because Hash
   holds a **Virginia** license and that store is in **West Virginia**, so Hash may not be able to
   pull there. This is exactly the kind of thing that used to slip through.

5. **★ Test A/E — the top alert and a red site.** Back on **Construction**, the big red banner at the
   top is alert #1 ("a permit may be needed and nobody confirmed it"). Click it to see the projects
   at risk. Separately, open **Permits → Sites → 34022**. The top of that page is a **red "Not ready
   to work"** bar, and the **Permits** section shows **two permits** (electrical + building), both not
   yet in hand. The site can't go green until every required permit is in hand.

6. **Filters.** On the Permit Board, use the **Status / Type / Pulled by / Jurisdiction** buttons to
   narrow the list. Green-tinted rows are in-hand-or-later; red-tinted rows are On Hold or Rejected.

7. **A jurisdiction cheat sheet.** Open **Permits → Jurisdictions → Warren County**. You'll see the
   contact info, the running cheat-sheet notes, the two "required with electrical?" switches, and a
   list of every permit ever pulled there. Edit anything and click **Save**.

8. **Add a deliverable.** Open any site → scroll to **Deliverables** → type a name (or choose a file)
   and add it. It attaches to that store.

---

## Decisions I made for you (one line each)

- **Kept the permit tables separate** (named `con_permit_…`) from your existing sites/jobs tables, so
  nothing already in the system was changed or overwritten.
- **Loaded all 25 permits exactly as the spreadsheet had them**, all marked "Required" — those are
  the 25 board rows.
- **New projects only open the Electrical permit automatically.** Building and Mechanical permits are
  added by hand from the site page (**Add a permit**) on the rare occasions a jurisdiction wants one —
  nothing extra is created for you.
- **Permit Due Date is always the work date minus 28 days** and is calculated, never typed.
- **The main board shows only confirmed "Required" permits.** Anything you mark "Unknown" waits in that
  site's "Pending confirmation" box and drives the top alert — so the board stays clean at 25.
- **Electrical defaults to Hash Construction; Building and Mechanical default to RPS.**
- **The Dispenser Replacement program does not send brand Project Notifications**, so those jobs no
  longer show up on the "Project Notifications to send" list.
- **28960 (Frederick County, MD) was left without a linked jurisdiction** because that office isn't on
  your 16-office Jurisdiction Contacts tab. Everything else matched to one of the 16.
- **Culpeper permits point at the "Culpeper (town vs county)" record** — its cheat sheet reminds you to
  confirm town vs county before filing.
- **Marked Harrisonburg, Winchester, Manassas Park, and Baltimore City as independent cities** so a
  permit is never filed with the wrong county.
- **Filled in owner/brand:** 7-Eleven sites → "7-Eleven, Inc."; 45967 → Speedway; HM-6 → Handy Mart /
  H.N. Funkhouser & Co.
- **Seeded the two contractor licenses:** RPS (VA Class A, expires 01/31/2027) and Hash (VA Class A,
  expires 03/31/2027). These drive the mismatch and expiring-license alerts.
- **Reused your existing private document storage** for deliverable file uploads — no new storage to set up.
- **"Mark ready to work" is blocked in the code**, not just hidden — it refuses until every required
  permit is in hand.
- **Access is limited to the same Construction users** as the rest of the module.

---

## What's not finished / good to know

- **Alerts 3 and 5 show 0 today, and that's correct.** "Stalled at Hash" only lights up when a permit
  sits at "Submitted to Hash" for more than 5 business days, and no permit is there right now.
  "Expiring license" only lights up within 60 days of a license expiring, and both are further out
  than that. They'll turn on by themselves when the day comes.
- **This was a one-time import.** As the plan says, keep updating the spreadsheet in parallel for a
  couple of weeks until you trust the app, then the app becomes the source of truth.
- **The real permit data is already in the live database.** If you decide to throw this away (below),
  the screens disappear but the loaded permit rows stay in the database harmlessly; they're only
  visible through these new screens.

---

## Keep it, or throw it away

Open Terminal and run the `cd` line from the "On your Mac" section first, then:

**To KEEP it (merge into your main site so it goes live):**
```
git checkout main
git merge claude/construction-module-tjsiwf
```
(Then push, and Vercel deploys it to your real site.)

**To THROW IT AWAY (discard the whole thing):**
```
git checkout main
git branch -D claude/construction-module-tjsiwf
```
Your main site is untouched either way — none of this was merged automatically.
