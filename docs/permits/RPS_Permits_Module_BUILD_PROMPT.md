# Build prompt — paste this into Claude Code

Open Claude Code inside your RPS project folder. Drop `RPS_Permit_Tracker.xlsx` and `RPS_Permits_Module_Plan.md` into that folder first. Then paste everything inside the box below as one message.

---

```
Add a Permits feature to the Construction module of this app.

Read RPS_Permits_Module_Plan.md in this folder first — it has the full data model,
status ladder, and alert rules. Read RPS_Permit_Tracker.xlsx too; its Permits tab is
the real data and its columns are the schema I want.

Before you write code, look at how this codebase already does things and match it.
Same framework, same database, same folder layout, same styling, same auth. Do not
introduce a new library if one already in the project does the job. Tell me what
stack you found before you start.

WHAT TO BUILD, IN THIS ORDER. Stop after each step, show me what works, and wait for
me to say go before the next one.

STEP 1 — Data layer
Create tables for jurisdictions, sites, projects, permits, permit_events, and
deliverables exactly as described in section 3 of the plan. Write a migration.
Then write an importer that reads RPS_Permit_Tracker.xlsx and loads every tab:
Permits, Jurisdiction Contacts, and Deliverables Log. Run it and show me the row
counts. Expect 25 permits, 16 jurisdictions, 17 deliverables.

STEP 2 — Permit board
A table view of every permit. Columns: Permit ID, Site, Jurisdiction, Permit Type,
Pulled By, Status, Scheduled Work Date, Permit Due Date, Days Until Due.
Permit Due Date is always the scheduled work date minus 28 days — compute it, never
let anyone type it.
Status is a dropdown with exactly these nine values: Not Started, Submitted to Hash,
Hash Submitted Confirmed, In Progress, Permit In-Hand, Inspection Scheduled,
Complete, On Hold, Rejected.
Every status change writes a row to permit_events with who changed it, when, the old
value, and the new value. Never overwrite a status without logging the event.
Filters for status, jurisdiction, pulled by, and permit type. Color the rows by
status. Green for Permit In-Hand and later, red for On Hold and Rejected.

STEP 3 — Alerts
Build the five checks in section 5 of the plan and show them on the Construction
dashboard as counts that click through to a filtered list.
The most important one is number 1: any project with a work date inside 28 days that
still has a permit marked requirement_status = Unknown. Put that one at the top and
make it impossible to ignore.
Alert 4 compares the state of the job site to the states the contractor is licensed
in, so store contractor licenses with a state on them.

STEP 4 — Jurisdiction page
One page per jurisdiction with contacts, portal, submittal method, turnaround, fees,
and a running cheat sheet text field. Include the two inheritance flags,
requires_building_with_electrical and requires_mechanical_with_electrical, each
being unknown, yes, or no. When a new project is created in a jurisdiction where
those are already known, pre-fill the permit requirements from them.
Also list every permit ever pulled in that jurisdiction.

STEP 5 — Deliverables and site view
A deliverables tab per site: date, type, filename, storage path, open items, with
file upload. Then a site view showing the project and every permit under it, with a
single ready-to-work indicator at the top that is only green when every permit marked
Required is at Permit In-Hand or later.

RULES THAT MATTER
- One row per permit. A site with an electrical and a building permit is two records.
- Electrical permits are pulled by Hash Construction. Building and mechanical are
  pulled by RPS. Make pulled_by default correctly by permit type.
- When someone creates a Dispenser Replacement project, auto-create three permits:
  Electrical set to Required and assigned to Hash, plus Building and Mechanical both
  set to requirement_status = Unknown. The Unknown ones stay off the main board but
  still fire alert 1.
- AUTO-RESOLVE RULE, important: the moment the Electrical permit on a project moves
  to Permit In-Hand, Inspection Scheduled, or Complete, flip every Unknown permit on
  that project to Not Required and log an event saying "auto-resolved: electrical
  issued." If the electrical got pulled, the jurisdiction did not want anything else.
  Enforce this in code so an Unknown can never sit behind an issued electrical permit,
  and make sure alert 1 skips those projects.
- A project cannot be marked ready to work while any Required permit is below
  Permit In-Hand. Enforce that in code, not just in the UI.
- Store contractor licenses with number, class, state, and expiration date so alerts
  4 and 5 can work.

I am not a developer. When you finish each step, tell me in plain English what you
built, what I should click to test it, and anything you had to guess at. Give me the
exact commands to run, and say which folder to run them from.
```

---

## After it builds

Once step 1 lands, keep the spreadsheet updated in parallel for a couple of weeks until you trust the app. Then the app becomes the source of truth and the workbook becomes an export.
