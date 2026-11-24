# RPS Intelligence — Permits Feature Plan (Construction Module)

**Prepared 08/12/2026 for Rappahannock Petroleum, LLC**

---

## 1. The problem this solves

Right now a permit lives in a spreadsheet, an email, or somebody's head. The single biggest risk is not a late permit. It is a permit nobody knew was needed.

Here is how that happens. Every dispenser replacement starts with Hash pulling the electrical permit. We do not find out whether that jurisdiction also wants a building permit or a mechanical permit until Hash actually tries to pull. By then the work date may be three weeks out. Somebody has to notice, tell RPS, and RPS has to pull a second permit from scratch.

The software has to make that gap impossible to miss.

---

## 2. Core design decision

**One row per permit, not one row per site.**

A site with an electrical and a building permit is two records that move independently. Site 34022 has an electrical permit at Hash and a building permit that has not been started. Those are two different states. A single site row cannot hold both.

Everything else follows from this.

---

## 3. Data model

Five tables. Names are suggestions; match whatever the existing module already uses.

### `jurisdictions`
The reusable cheat sheet. One record per issuing office.

| Field | Notes |
|---|---|
| `id` | |
| `name` | "Warren County", "City of Harrisonburg" |
| `state` | two-letter |
| `is_independent_city` | boolean — this flag alone prevents filing a Harrisonburg permit with Rockingham County |
| `department`, `address` | |
| `contact_name`, `phone`, `email` | hunt for a direct person, not a main line |
| `portal_url`, `submittal_method` | portal / email / in person |
| `typical_turnaround_days` | |
| `fee_notes` | who the check is payable to |
| `requires_building_with_electrical` | tri-state: unknown / yes / no |
| `requires_mechanical_with_electrical` | tri-state: unknown / yes / no |
| `contractor_requirements` | free text — e.g. Harrisonburg wants a city business license on top of the state Class A |
| `cheat_sheet` | free text, grows every time we learn something |

**Discovery shortcut.** If the electrical permit reaches Permit In-Hand, no other permit is needed. The jurisdiction would have said so when Hash pulled it. The system sets `requires_building_with_electrical` and `requires_mechanical_with_electrical` to `no` for that jurisdiction and resolves the project's Unknown placeholders to Not Required automatically.

The two `requires_*` fields are the payoff. The first time Warren County tells us a building permit is required, that fact gets written to the jurisdiction, not just to the job. Every future Warren County job inherits it.

### `sites`
| Field | Notes |
|---|---|
| `id`, `site_number`, `brand` | brand matters — 45967 is a Speedway, not a 7-Eleven |
| `name`, `address`, `city`, `state`, `zip` | |
| `jurisdiction_id` | |
| `owner_id` | owner block is per brand, not per site |
| `store_phone`, `parcel_number` | |

### `projects`
| Field | Notes |
|---|---|
| `id`, `site_id` | |
| `project_type` | Dispenser Replacement, STP Circuit Repair, Tank Replacement, MUL Conversion |
| `request_type` | **Non-PE Stamped** or **PE Stamped** |
| `scope` | |
| `dispenser_count`, `grades`, `unit_config` | 3+0 or 3+1 |
| `scheduled_work_date` | |
| `permit_due_date` | computed: scheduled minus 28 days |
| `ready_to_work` | computed: true only when every required permit is Permit In-Hand or later |

`request_type` drives who pulls. Non-PE Stamped is us and Hash. PE Stamped usually means an engineering firm pulls it, and we still track it so the site status is honest.

### `permits`
The heart of it.

| Field | Notes |
|---|---|
| `id`, `project_id` | |
| `permit_type` | Electrical, Building, Mechanical, Plumbing, Fire, Zoning, Other |
| `pulled_by` | Hash Construction, RPS, Engineering Firm |
| `requirement_status` | **Unknown**, Required, Not Required |
| `status` | the ladder in section 4 |
| `date_submitted_to_hash` | Hash-pulled only |
| `date_hash_confirmed` | Hash-pulled only |
| `date_submitted_to_jurisdiction` | |
| `permit_number`, `fee`, `date_issued` | |
| `inspection_date`, `date_completed` | |
| `notes` | |

Business rule: creating a Dispenser Replacement project auto-creates one Electrical permit assigned to Hash Construction, plus a Building permit and a Mechanical permit both set to `requirement_status = Unknown`. Those two stay hidden from the main list but drive the alert in section 5. The moment Hash reports what the jurisdiction wants, the user flips each one to Required or Not Required. Required ones become live records assigned to RPS.

**Auto-resolve rule.** The instant the Electrical permit on a project moves to Permit In-Hand, Inspection Scheduled, or Complete, every Unknown placeholder on that project flips to Not Required with an event logged reading "auto-resolved: electrical issued." A pulled electrical permit is proof the jurisdiction wanted nothing else. This is not a suggestion in the UI — it fires in code, so an Unknown can never sit behind an issued electrical permit.

### `permit_events`
Append-only audit trail. `permit_id`, `changed_at`, `changed_by`, `from_status`, `to_status`, `note`.

Never overwrite a status without writing an event. When somebody asks "when did we send that to Hash," the answer is a query, not a memory.

### `deliverables`
`site_id`, `permit_id` (nullable), `created_date`, `type`, `filename`, `storage_path`, `open_items`.

Every drawing, application, and scope narrative gets a row the day it is made. This is what stops the "did we ever build that drawing" question.

---

## 4. Status ladder

| Status | Meaning |
|---|---|
| Not Started | Nothing sent. |
| Submitted to Hash | Package handed to Hash. Hash-pulled permits only. |
| Hash Submitted Confirmed | Hash confirmed they filed it with the jurisdiction. Requires a confirmation, not an assumption. |
| In Progress | Jurisdiction has it and is reviewing. |
| Permit In-Hand | Issued and in our possession. **Only status that clears a site to work.** |
| Inspection Scheduled | Inspection on the calendar. |
| Complete | Inspection passed, permit closed out. |
| On Hold | Blocked by something outside the jurisdiction — missing owner signature, proof of ownership. |
| Rejected | Kicked back. Reason required in notes before it can move again. |

RPS-pulled permits skip the two Hash steps and go straight from Not Started to Submitted to Jurisdiction, then In Progress.

Rule to enforce in code: a project cannot be marked ready to work while any permit with `requirement_status = Required` sits below Permit In-Hand.

---

## 5. Alerts — the part that earns its keep

Five checks, run nightly, surfaced on the Construction dashboard.

1. **Unknown inside the window.** Any project whose scheduled work date is inside 28 days that still has a permit at `requirement_status = Unknown` **and** whose Electrical permit is not yet in hand. This is the number one alert. It catches the building permit nobody knew about while there is still time. Projects with the electrical already issued never appear here, because the auto-resolve rule cleared them.
2. **Past due.** Any Required permit past its due date and not yet Permit In-Hand.
3. **Stalled at Hash.** Any permit sitting at Submitted to Hash for more than five business days with no confirmation.
4. **License mismatch.** Any permit whose `pulled_by` contractor has no active license in that permit's state. Hash holds a Virginia Class A. Site 34688 is in West Virginia. That alert should have fired weeks ago.
5. **Expiring license.** Any contractor license within 60 days of expiration. RPS expires 01/31/2027. Hash expires 03/31/2027.

---

## 6. Screens

**Permit board.** Default view. Rows are permits, filterable by status, jurisdiction, who pulls it, and permit type. Colored by status. This replaces the spreadsheet.

**Site view.** One site, its project, and every permit stacked underneath with a single ready-to-work indicator at top.

**Jurisdiction page.** Contacts, portal, fees, turnaround, and the running cheat sheet. Plus the list of every permit we have ever pulled there, so patterns show up.

**Deliverables tab.** Per site. Every file, when it was made, where it lives, what is still open on it.

---

## 7. Build order

Do it in this sequence so something is useful at every stop.

1. Tables plus a CSV import that eats the current `RPS_Permit_Tracker.xlsx` Permits tab as-is.
2. Permit board with inline status editing and the event log writing behind it.
3. The five alerts.
4. Jurisdiction page with the two `requires_*` inheritance fields.
5. Deliverables tab and file storage.
6. Site view and the ready-to-work rollup.

Steps 1 and 2 alone replace the spreadsheet. Step 3 is where it starts preventing losses.

---

## 8. Migration

The current workbook is already shaped for this. The Permits tab is one row per permit with the exact columns above. Export it to CSV and import. Twenty-five permit records, sixteen jurisdictions, seventeen deliverables.
