# RPS Intelligence — Project Intake & Quote Workup Plan

**Prepared 09/29/2026 for Rappahannock Petroleum, LLC**

---

## 1. The problem this solves

A project starts as scattered evidence: a tech's "40013 Update survey" with 48 photos, a "32283 update" whose body says "needs one 10 stud entry reboot, survey all the entry boots", a customer work order, a Source NA quote PDF, a sketch. Today a person has to notice each one, pull the attachments, build a folder, look at the pictures, remember the benchmarks, chase the missing prices, and only then open a quote. Anything not chased is forgotten until the customer asks.

The system has to do three things without being asked: **see** every project-related email in both inboxes, **assemble** the project (folder, findings, take-off, draft quote) as far as the evidence allows, and **hold someone responsible** for every gap until the quote is real and the job is billed.

---

## 2. Core design decisions

1. **RPS Intelligence is the system of record; iCloud is a mirror.** Every email, photo, drawing, finding, take-off line, question and answer lives in Supabase and shows on the job page. The iCloud folder `Project Folders/<Customer>/<SITE> … Survey and Quote/` is written from the app's data (by the local skill or a "Download project folder" action), never the other way round. Reason: the work Mac, the home Mac, phones and Starsky all need the same truth.
2. **One intake pipeline, three doors.** econstruction.rp@gmail.com through the app's existing Gmail client (cron, same as Service Dispatch and the Receive queue); Proton through the `/rps-project-intake` skill on Trae's Mac (Proton has no API, only the Bridge); manual drop on the intake page. Everything lands in the same table.
3. **The follow-up ledger is the accountability engine.** Every `PRICE NEEDED`, `HOURS NEEDED`, missing vendor quote, sub quote, concrete or disposal quote, permit, testing decision and customer question becomes a row with an owner, a due date and a nudge count. It is re-surfaced in the 3 pm daily summary, the bell, Ask RPS and the job page until answered or waived. A quote cannot be marked sent or approved with an open price or hours item, enforced in code.
4. **Claude reads, a human confirms.** Photos, PDFs, workbooks and email bodies are read server-side with the same forced-tool pattern as `lib/billing-inbox-sync.ts` and `lib/svc-work-order-docs-extract.ts`, producing a structured survey record, a take-off proposal and the questions it could not answer. Nothing becomes a quote line until someone clicks Push to quote, exactly like the Receive queue.
5. **Reuse, do not rebuild.** Construction jobs and stages, `con_documents` + the `construction-docs` bucket, `con_job_materials`, `con_quotes` + the REV19 engine, the 3,917-part catalog, `lib/billing-gmail-client.ts`, notifications, the daily summary, Ask RPS. New code is the intake table, the follow-up ledger, the extract prompt, one queue page and one job-page panel.

---

## 3. What the intake sees (from the live inboxes, 09/2026)

| Pattern | Example | Meaning |
|---|---|---|
| `<site> Update survey` from a `*.rp@gmail.com` tech, many photos | 40013 Update survey (Jesse Franks, 34 + 14 photos) | Survey; start or extend a project |
| `<site> update` from a tech, body says needs / will need / survey all | 32283 update (Chevy Swartz) | Scope note; same as a survey |
| `SU-#### update / <topic> survey` | SU-9901 update / MUL boot survey | Survey with a measurement in the body |
| Trae's forward of a tech note | 32284 update RUL entry boots | Same, filed under the forwarded site |
| Customer work order / RFQ / bid form with attachment | (Sunoco WOT…, 7-Eleven bid form) | Quote request; creates the job if none |
| Vendor quote PDF from Source NA, Spatco, ICON, Noland, concrete, disposal, Hash | SPATCO Quote 20106685 | Prices for open take-off lines |
| Proton `Fwd: 5015 signal bell lane update survey`; folders `RPS/Project Folders/<site>` | | Trae's copy; dedupe against Gmail |

Ignored on purpose: Peggy's "Invoice … for you to review" loop (service invoicing), packing slips (Receive queue), portal "Dispatched" work orders (Service Dispatch), "Received. Will move" replies.

Site rules are `classifySite()` in `lib/site-number.ts`; the skill's `scripts/triage.py` mirrors them. Bare 4-digit numbers are Sunoco by office convention and are flagged low-confidence.

---

## 4. Data model

Names follow the existing `con_*` convention.

### `con_intake_items`
One row per captured email (or manual drop).

| Field | Notes |
|---|---|
| `id`, `company_id` | |
| `source` | `econstruction` / `proton` / `manual` |
| `message_id`, `thread_id` | unique per source; re-running never duplicates |
| `received_at`, `sender_email`, `sender_name`, `subject`, `body_text` | |
| `kind` | `survey` / `scope_note` / `work_order` / `quote_request` / `vendor_quote` / `drawing` / `other` |
| `site_key`, `brand`, `brand_confidence` | from the site rules, editable |
| `job_id`, `quote_id` | set when filed |
| `status` | `new` → `needs_review` / `filed` / `ignored` |
| `attachments` | jsonb `[ {name, mime, size, storage_path, doc_type} ]`, files in bucket `project-intake` (raw) and copied into `construction-docs` + `con_documents` when filed |
| `extracted`, `extract_model`, `extracted_at` | Claude's survey record (section 6) |

### `con_followups`
The ledger. One row per thing somebody owes.

| Field | Notes |
|---|---|
| `id`, `company_id`, `job_id`, `quote_id`, `quote_line_id` | line is optional |
| `category` | `price` / `hours` / `vendor_quote` / `sub_quote` / `concrete` / `disposal` / `equipment` / `permit` / `testing` / `customer_question` / `internal_question` / `drawing` / `other` |
| `item`, `detail` | "Unit cost for OPW 10+1 shear valve × 6", "Trench length RUL run, tech photo shows ~40 ft" |
| `owner_id` / `owner_email` | defaults by category (section 7) |
| `due_date` | defaults by category |
| `status` | `open` / `answered` / `waived` / `expired` |
| `answer`, `answered_by`, `answered_at` | the answer is written back to the quote line or job field |
| `asked_at`, `last_nudged_at`, `nudge_count` | |
| `source_item_id` | the intake item or extraction that raised it |

### `con_jobs` additions
`intake_folder_path` (iCloud mirror), `survey_summary` (text, rolled up from findings), `quote_readiness` (0–100), `last_intake_at`.

### `con_vendors` additions (nearby-vendor lookup)
`address`, `city`, `state`, `zip`, `lat`, `lng`, `service_radius_miles`, `categories` (text[]: concrete, disposal, dumpster, equipment_rental, electrical_sub, concrete_finisher, testing, vac_truck), `website`, `last_quote_at`, `rating_note`. Existing rows keep working; the intake geocodes addresses once (Google Geocoding or Mapbox, key in Vercel) and stores lat/lng on `con_sites` too.

### View `con_site_vendor_distance`
Per site and vendor: straight-line miles from the site's lat/lng, filtered to `categories` the quote needs. The Quote workup panel reads it.

### View `con_quote_readiness`
Per quote: total lines, lines with a real price, labor rows with hours, open follow-ups by category, readiness %. Readiness = priced lines ÷ lines, minus 10 points per open price/hours item, floor 0. The job page and the daily summary read this view.

---

## 5. Pipeline

All passes run behind `GET /api/projects/intake?secret=<CRON_SECRET>&pass=…` from `gmail-sync.yml` every 15 minutes, and on demand from the queue page.

| Pass | What it does | Reuses |
|---|---|---|
| `sync` | Gmail search on econstruction with the three intake queries → `con_intake_items` + attachments to `project-intake` | `billing-gmail-client.ts` (`GMAIL_TOKEN_ECONSTRUCTION`) |
| `classify` | rules first (`kind`, site, brand); Claude only for ambiguous subjects | `classifySite()` |
| `file` | match or create `con_sites`, `con_customers`, `con_jobs` (stage `survey` → `quoting`); copy attachments into `construction-docs` + `con_documents` with `doc_type` survey_photo / drawing / quote_request / vendor_quote; append the email to the job's survey-emails text | `createJobFromWorkOrder()` pattern |
| `extract` | Claude reads photos, PDFs, workbooks and bodies → survey record + take-off proposal + questions (section 6) | `extractWorkOrderDocument()` pattern |
| `propose` | proposal → draft `con_quote_line_items` (flagged `price_flag`), `con_job_materials` (status needed), `con_followups` for every gap; vendor quotes price matching lines | `matchLinesToCatalog()`, REV19 engine |
| `nudge` | daily: escalate open follow-ups, write the "Projects waiting on you" block, bell + email owners | `notifications.ts`, daily summary, Resend |
| `mirror` | local only (Vercel cannot reach iCloud): the skill or a launchd job pulls filed items and writes the iCloud folder | skill REFERENCE §2 |

Idempotent everywhere: unique `(source, message_id)`, unique `(job_id, category, item)` on open follow-ups.

---

## 6. What Claude extracts (the `record_survey` tool)

```
site_key, brand, work_order_number, survey_date, surveyed_by
findings[]: { location ("UDC 1/2", "RUL STP sump", "line run RUL→disp 3/4"), what_is_there, condition,
              counts {entry_boots, product_boots, vapor_boots, studs, conduits, …}, sizes, tech_quote, photo_refs[] }
scope_summary (RPS voice, reusable on the quote face)
quote_type (from "00 - RPS Quote Types"), benchmark_jobs[]
takeoff[]: { category 1–12, description, qty_calc, qty_purchase, unit, waste_pct, part_number?, source_hint,
             hours? {men, hrs_each, days}, confidence }
questions[]: { category, item, detail, suggested_owner }
unreadable[]: files Claude could not read (HEIC, blurry)
```
Rules in the system prompt: never invent a price (leave unit cost null and raise a `price` follow-up); never guess hours (cite a benchmark job or raise `hours`); concrete is ready-mix or bags never both; drop tube is 71SO-410C only; FL100 skirt is FL100-SK18; third-party testing only if the customer asks; permits by jurisdiction (electrical by Hash, building/mechanical by RPS). Reference text for the prompt: `docs/reference/` benchmarks, the "00 - RPS Quote Types" file, `lib/rev19.ts` categories.

---

## 7. Accountability rules

Default owners and due dates (editable in Settings):

| Category | Owner | Due |
|---|---|---|
| price, vendor_quote, sub_quote, concrete, disposal, equipment | Trae (compiles) → Starsky confirms | 3 business days (vendor / sub / concrete 5) |
| hours, internal_question | Starsky | 3 |
| customer_question, drawing | Trae | 3 |
| permit, testing | Trae | 10 |

Nudge cadence: asked on day 0; reminder day 2; day 4 escalates to Trae and Starsky; then daily until answered or waived. Every nudge increments `nudge_count`, and the daily summary opens with "Projects waiting on you: n items, oldest x days". Ask RPS answers "what is holding up SU-9901" from the ledger. The quote builder shows the open list at the top and refuses `sent` / `approved` while a price or hours item is open. Answering writes the value back (unit cost onto the line, hours onto the labor row, text into the job notes) and logs `activity_log`.

The ledger keeps running after the quote: `material_ordering` raises vendor-order items from `con_job_materials`, `scheduled` raises permit and notification items, `close_out` raises closeout documents, `invoicing` raises "invoice from quote" until an invoice exists and is sent. The project is done when the invoice is `sent` and every follow-up is answered or waived.

---

## 8. UI

- **`/construction/intake`** queue: tabs New / Needs review / Filed / Ignored; inbox status strip and Sync now (like the Receive queue); row → item page with the email, attachments preview, site / brand / kind editors, File to job (picks or creates), Ignore, Re-read.
- **Job page "Quote workup" panel** (top of `/construction/jobs/[id]`): survey summary, findings by location with photo thumbnails, take-off proposal table with Push to quote, running total by category, readiness %, open follow-ups with inline answer boxes, Download project folder.
- **Nearby vendors strip (in the Quote workup panel and the quote builder):** when a quote carries category 5 (concrete / disposal), 9 (equipment) or 11 (subcontractor) lines, show the vendors from `con_vendors` within the site's radius, sorted by distance, with phone, last quote date and a **Draft RFQ** button that writes a ready-to-send request (quantity, mix, site address, date window) into the job's Documents and opens it in the mail client. Nothing is sent by the app. Requested by Trae 09/30/2026 after the 40013 concrete and haul-off quotes; the first list (Richmond VA) is in Construction → Vendors.
- **Quote builder strip**: open items for this quote, click to answer.
- **Dashboard tile + daily summary block**: "Projects waiting on you".
- **Settings → Billing inboxes**: econstruction shows connected once the token exists; add a Project intake card for default owners and due days.

---

## 9. Phases

| Phase | Deliverable | Depends on |
|---|---|---|
| 0 | Prerequisites (section 10) | Trae |
| 1 | Migration (`con_intake_items`, `con_followups`, job columns, view, bucket), `sync` + `classify` + `file`, queue page, cron job | token |
| 2 | `extract` (record_survey), job page Quote workup panel, findings + photos | 1 |
| 3 | `propose`: draft quote lines, materials, follow-ups; readiness view; quote gate | 2 |
| 4 | `nudge`: daily summary block, bell, email, Ask RPS tool, dashboard tile | 3 |
| 5 | iCloud mirror (skill hand-off + Download project folder), Proton path | 1 |
| 6 | Vendor quote intake prices open lines automatically; ties into the Receive queue | 3 |
| 7 | Through completion: ordering, scheduling, closeout and invoice follow-ups from the same ledger | 4 |

Until Phase 1 is live, the `/rps-project-intake` skill does the whole loop by hand from Trae's Mac and keeps its open items in `RPS - Intelligence/Project Intake/intake-state.json`.

---

## 10. Prerequisites (Trae)

1. **Mint `GMAIL_TOKEN_ECONSTRUCTION`.** Google OAuth Playground → Gmail API v1 → `gmail.readonly` → sign in as econstruction.rp → exchange → copy the refresh token. Put it in `.env.local` (for the skill and scripts) and in Vercel (for the cron). This one item unlocks both the skill's attachment download and the in-app pipeline.
2. **Resend keys** in Vercel so nudges can email owners (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`).
3. **Proton decision:** keep it skill-only (Bridge on the Mac), or add a Proton filter that forwards RPS project mail to econstruction so the app sees it.
4. **Default owners:** confirm the table in section 7 and each person's login (Starsky, Ernie, Shannon).
5. **Customer folder policy** for brands with no folder yet (Sheetz, Wawa, Capital) — the `TODO(human)` in the skill's `triage.py`.

---

## 11. Open decisions

- May the app email vendors for quotes on its own (draft only vs send)? Recommendation: draft only until the ledger has run for a month.
- Nudge channel per person (bell, email, both).
- Whether the iCloud mirror is on demand (button) or nightly (launchd on the Mac that has iCloud).
- Whether a survey with no work order should create the job immediately or sit in Needs review. Recommendation: create it; an empty job costs nothing and the ledger asks for the work order.
