@AGENTS.md

# RP Intelligence (formerly RPS Maintenance & Asset Tracker) — Master Context (CLAUDE.md)

> Read this file at the start of EVERY session before doing anything.
> AGENTS.md (imported above) is critical: this app runs on Next.js 16 + React 19,
> which have breaking changes from older versions. Read node_modules/next/dist/docs/
> before writing any Next.js code. Middleware is renamed to "proxy" (see proxy.ts).

---

## WHO THIS IS FOR

Built for Trae's father's company — RPS (Rappahannock Petroleum).
Trae is the project owner and is a coding/website newbie.
- Explain all technical steps in plain English. Never assume Trae knows terminal or code syntax.
- For anything done outside code (Supabase, Vercel, Google Cloud), give exact click-by-click steps.
- When Trae gives a correction, apply it and treat it as permanent.

---

## CURRENT STATUS — UPDATED (replaces the old "Ready to begin Step 1")

Phase 1 is essentially BUILT and partially LIVE. This is NOT a greenfield project.
Do not rebuild. The role now is to refine, debug, extend, and add the email-sync layer.

WHAT IS BUILT (verified in code):
- Auth: Google OAuth via Supabase; all routes protected by proxy.ts; auto profile creation on first login.
- Assets: list, add, edit, detail, delete, photos, status badges; per-asset mileage entry; oil/brake/tire service records.
- Maintenance: dashboard + oil-changes, brakes, tires, inspections, registrations pages.
  Due logic in lib/maintenance.ts (buckets: overdue, due_today, due_this_week, due_next_2_weeks, due_this_month).
- Repair tickets: list, create, detail, edit, status buttons, comments, photo upload, LIVE labor timer tied to ticket.
- Shop & time: clock in/out, status selector, my-tasks, general shop time, employee live status, time approvals.
- Payroll: report + CSV export (api/reports/payroll-csv). Expenses CSV export also built.
- Notifications: lib/notifications.ts rules — overdue maintenance, asset down/unsafe, forgot-to-clock-out (with dedup); bell + page.
- Auto-tickets: lib/auto-tickets.ts auto-opens tickets for overdue maintenance (skips if open ticket already exists).
- Mobile + PWA: /mobile screens (clock, mileage, report-issue, work-a-ticket), manifest.ts, sw.js, home-screen install.
- BEYOND original Phase 1 scope (already built): expenses module, fuel module, payment-methods, settings (company, users, roles, guide).

WHAT IS NOT BUILT:
- Email / Gmail sync. This is the ONLY unbuilt major feature. No Gmail code, no Gmail library installed yet.
- The database is ALREADY prepped for it (see EMAIL SYNC section).

---

## TECH STACK — ACTUAL (verified from package.json)

Frontend: Next.js 16.2.6 (App Router), React 19.2.4, TypeScript (required, never skip),
  Tailwind CSS 4, shadcn 4 + @base-ui/react, lucide-react.
Backend: Supabase (PostgreSQL + Auth + Storage + RLS). Google OAuth login.
Hosting: Vercel (deploys from GitHub).
Routing/auth note: Next 16 renamed middleware → proxy. Route protection lives in proxy.ts at repo root.

Project folder (Trae's Mac): ~/Documents/Claude/Claude Projects/RPS Maintenance & System Software/RPS Maintenance & Asset Project/rps-maintenance (GitHub Traed-3/rps-maintenance). Product name is RP Intelligence; the repo/Vercel/Supabase slugs still say rps-maintenance — see docs/rebrand/RPS_Intelligence_Rename_Runbook.md.

---

## CONFIRMED FACTS — DO NOT ASK AGAIN

- Fleet size: 50–75 assets (trucks, trailers, equipment).
- Shop employees who clock in/out: 5. Total company employees: 50+.
- Login: company Gmail addresses via Google OAuth.
- Hosting region: US East (Virginia). Timezone: America/New_York.
- Private internal tool only — NOT a public SaaS.

---

## INSPECTION MODEL — IMPORTANT (corrected)

RPS does NOT do DOT inspections. Remove all DOT references when cleanup is approved.

There are TWO separate inspections — they are different things:
1. STATE INSPECTION — the formal annual inspection required by the state, performed by an
   authorized repair shop. This is the existing assets.inspection_due_date field.
   Keep it. Label it "State Inspection".
2. SERVICE INSPECTION — RPS's INTERNAL inspection performed any time an asset comes into the
   shop for an Oil Change / Service (catches tires, brakes, etc.). This is NEW and must be ADDED
   (its own due date/last-done tracking). Not yet built.

DOT cleanup still pending in code (do NOT run until Trae approves — he wants to demo to his dad first):
- Remove assets.dot_inspection_due_date column + any UI references.
- Remove the 'DOT' row from the maintenance_types seed.
- lib/auto-tickets.ts and lib/notifications.ts already ignore DOT and use inspection_due_date — good.

---

## DATABASE — ACTUAL TABLES (in supabase/schema.sql, ~20 tables, RLS enabled)

companies, profiles, asset_types, assets, maintenance_types, repair_tickets, maintenance_events,
repair_ticket_assignments, repair_ticket_comments, repair_ticket_attachments,
time_clock_entries, labor_entries, employee_statuses,
oil_change_records, brake_service_records, tire_service_records,
mileage_entries, notifications, activity_log, gmail_imports.

Key logic already in DB:
- Auto profile creation on first auth (handle_new_user trigger, default role 'viewer').
- Auto ticket numbers via sequence: TKT-1000, TKT-1001, ...
- Payroll hours = SUM(time_clock_entries.total_minutes) per pay period.
- Labor hours = SUM(labor_entries.total_minutes WHERE entry_type='ticket') grouped by ticket.
- employee_statuses holds each employee's live clock_status, current_status, current_ticket/asset, active labor entry.

Seed data loaded: company "RPS"; asset types (Service Truck, Construction Truck, Pickup Truck, Trailer,
Equipment, Machine, Other); maintenance types (incl. a 'DOT' row pending removal).

---

## ROLES & PERMISSIONS (profiles.role)

owner: full access, manage users/settings, all reports, payroll, approve/edit time.
manager: dashboard, create/edit/assign tickets, reports, employee status/hours, approve time.
shop_manager: manage tickets, assign shop employees, complete maintenance, asset status, approve shop time.
shop_employee: clock in/out, set status, start/pause/stop ticket work, update own tickets, photos/notes,
  parts flags, mark complete, view own time logs.
viewer: read-only dashboard + reports.

---

## EMAIL SYNC — THE NEXT BIG FEATURE (NOT yet built; do not start until Trae approves)

Goal: the app READS the company's existing Gmail inboxes and auto-populates the dashboard, so
employees keep emailing exactly as they do today and nobody changes their habits. This is the
strategy for overcoming Trae's father's reluctance to change.

The database is already prepped:
- gmail_imports table (review queue: pending → reviewed → converted → rejected → duplicate;
  fields for detected_asset, detected_priority, raw_payload, converted_ticket_id).
- repair_tickets.gmail_message_id and .gmail_thread_id (link ticket back to source email).
- repair_tickets.source includes 'gmail'; mileage_entries.source includes 'fuel_receipt'.

Existing RPS email inboxes and formats (the parser targets these):
- eshoptasks@gmail.com — shop repair tickets. New thread = new ticket; replies = updates;
  thread not archived until complete. ** FIRST inbox to wire up. **
- rptrucklog@gmail.com — time/labor. Subject = date + initials; first reply sets start ("@ shop"
  or location); each new task = reply ("L shop to 32346", "start P185 Trailer Inspection");
  body "EOD 7:00 - 17:00 - 10"; Wednesday (pay-period end) "EOW 7:00-17:00-10 T=45" (T = week total).
- Fuel emails — truck/equipment number, mileage, total gallons, oil level 1-9 → feeds mileage + maintenance-due.
- maintenancereceipt@gmail.com / Constructionreceipts@gmail.com — receipts. Subject:
  total - payment type/acct - site or asset number - description (e.g. "3.37 TEC 32367 soap for line testing").
- rptrailerlog@gmail.com — trailer in/out. Subject: initials, pulling asset #, date out, trailer #; body "out"/"in".

Recommended approach (MVP): Vercel Cron → an API route that uses Gmail API (read-only scope) to fetch
new messages, parse the structured subject/body, and insert into gmail_imports + create
tickets/mileage/etc. Anything that doesn't parse cleanly goes to a "Needs Review" queue.
OAuth: authorize each inbox once; store refresh tokens securely (Supabase). Verify current Google
OAuth/verification requirements at build time (policy changes); a private internal app with a small
set of authorized inboxes can avoid the costly third-party security assessment.

---

## UI CONVENTIONS — STANDARD (follow for ALL new/edited tables)

**Clickable rows.** Any table whose rows represent a navigable record (an asset, ticket,
employee, expense, etc.) MUST make the WHOLE row clickable — not just a "View →" link.

- Use `<ClickableRow href="/path/{id}">…cells…</ClickableRow>` from
  `components/clickable-row.tsx` in place of the data `<tr>` (leave the header `<tr>` alone).
- `ClickableRow` already: navigates on click + Enter, shows a pointer cursor + hover/focus
  highlight, and **ignores clicks on nested `a` / `button` / `input` / `select` / `textarea` /
  `label` / `[role="button"]` / `[data-no-row-nav]`** and on text selection — so per-row
  action buttons/links (edit, delete, status, "Record →") keep working without extra code.
- Keep a small "View →" (or "Record →"/"Update →") cue in the last cell as an affordance; it
  can be a plain `<span>` since the whole row navigates.
- Applied across: assets, tickets, expenses, shop, shop/employees, dashboard (Open Tickets +
  Employee Status), and all maintenance lists (oil-changes, brakes, tires, inspections,
  registrations). New tables must match this.

---

## SESSION RULES

1. Trae is a coding newbie — explain commands and where to click; give copy-paste-ready blocks.
2. TypeScript is required. Never skip it.
3. This is Next.js 16 / React 19 — confirm current APIs from node_modules/next docs before coding.
4. Always confirm before any destructive database operation (dropping columns, deleting rows).
5. Build/change one piece at a time and keep the app deployable.
6. Trae actively requests and approves changes during sessions — implement them directly. (The old pre-dad-demo "hold all edits" freeze is lifted.) Still confirm before destructive DB operations per rule 4.

---

## BILLING + INVENTORY MODULE (added 2026-09-15)

Own top-level modules shared by Construction and Service (department-tagged), NOT under Construction.
- Migration: `supabase/migrations/billing_inventory_module.sql` (APPLIED to project zktmhxheouwbyupeizjq on 2026-09-15).
  Tables: parts, part_price_history, part_assemblies, billing_rate_cards (7-Eleven $78.50 / Global $82.50 /
  Sunoco $80 / Independent $95), stock_locations (Office / Hill, Construction Shelf, Vendor RMA + one per
  Service/Pickup truck linked to assets), stock_levels, inventory_transactions (append-only; on-hand = view
  stock_on_hand), stock_transfers(+lines), service_tickets (+labor/parts/photos, signatures, links to
  svc_work_orders + svc_technicians). con_quotes/con_invoices gained `department`, nte, portal WO columns.
- Seed: `node scripts/seed-parts.mjs` (idempotent; `--reset` to reload). Sources in supabase/seed/*.csv:
  REV19 price library + price books (552) and items billed on 2026 service invoices (229). Loaded 781 parts.
- UI: /inventory (hub), /inventory/parts (search/filter, add), /inventory/parts/[id] (price history, on-hand,
  edit), /inventory/locations. Guard: lib/inventory-guard.ts (everyone reads; INVENTORY_WRITE_ROLES write).
  Helpers/types: lib/inventory.ts. `computeSellPrice` still carries the TODO for the RPS line-price rule.
- Pricing rules (from the rps-quote-builder skill): never invent a price; cost from receipt/vendor quote/book
  with its date; flat 20% material markup; tax on material (cats 1–4) only, recovered through markup;
  freight per unit; prices older than 6 months → verify; two receipts disagree → HELD HIGH.
- Source data + 207 pulled RPS invoices live in iCloud: RP - Rappahannock Petroleum/Operations/RPS Project
  Quote Docs/Quote and Invoice Documents/RPS Invoices - Email Pull 2026/.
- Email pull for other inboxes: `scripts/pull-billing-emails.mjs --inbox <name>` needs GMAIL_TOKEN_<INBOX>.
- Phase 2 (done 2026-09-15): quote/invoice lines pick from the catalog (components/construction/part-picker.tsx
  → GET /api/inventory/parts/search; fills description, part_id, item type, suggested price = cost×1.2+freight
  with document-level tax left to the document). con_quote_line_items/con_invoice_line_items.part_id FK → parts.
  Header fields: department (construction|service), portal_wo_number, valid_until + nte_amount (quotes).
  REV19 category roll-up on the quote page (components/construction/category-rollup.tsx).
  lib/construction.ts now re-exports statuses/money math/formatting from lib/billing.ts (one engine).
  `computeSellPrice` / `sellPriceForLine` in lib/inventory.ts implement (Cost+Tax)×(1+Markup)+Freight.
- Phase 3 (built 2026-09-15): field service tickets. lib/service-tickets.ts (statuses, brand→rate card,
  buildInvoiceLines = Peggy's layout: Labor M/D/YY + Trip rows per day, Disposables $17.50/tech-day, parts),
  lib/service-ticket-data.ts (loader), app/(app)/service/tickets/actions.ts (create from svc_work_order or blank,
  details, labor, parts via PartPicker, photos → ticket-attachments bucket, signTicket → PNG in
  ticket-attachments/signatures/, both signatures ⇒ status 'signed' + inventory issue_to_ticket rows,
  convertTicketToInvoice → con_invoices department='service' priced from billing_rate_cards, 6% tax default).
  UI: /mobile/service-ticket (my tickets + dispatched WOs + blank), /mobile/service-ticket/[id] (TicketForm,
  SignaturePad), /service/tickets (list + filters), /service/tickets/[id] (+ Create invoice). Entry points:
  mobile home "Service Ticket" button, Service Dispatch "Field tickets →", work-order page "Start field ticket".
- Phase 4 (built 2026-09-15): inventory in motion. app/(app)/inventory/stock-actions.ts: receiveStock (+qty,
  receipt cost → parts.unit_cost/last_cost/avg_cost + price history, marks is_stocked), adjustStock,
  createTransfer/setTransferStatus (pending→picked→received; received posts transfer_out/transfer_in legs under
  one transfer_group), setStockLevel (min/max/bin per location), postCount (variance rows, txn 'count').
  UI: /inventory/stock (per-location overview, below-min, inbound), /inventory/stock/[locationId] (on-hand +
  inline min/max, count mode, quick adjust, movement history), /inventory/receive, /inventory/transfers
  ("Fill to max" from below-min lines). Hub tiles all live.
- Phase 5 (built 2026-09-16): email-driven receiving + invoice email-out + shop count import.
  Migration `supabase/migrations/billing_inbox_phase5.sql` (APPLIED): billing_inbox_documents (one row per email
  with paperwork; attachments in private bucket `billing-inbox`; `extracted` jsonb = Claude-read lines matched to
  the catalog), billing_emails (audit of invoices emailed out), inventory_transactions.inbox_document_id.
  lib/billing-gmail-client.ts resolves a read-only token per inbox: GMAIL_TOKEN_<INBOX> (ECONSTRUCTION,
  CONSTRUCTIONRECEIPTS, RPINVOICING, MAINTENANCE) with fallbacks to SVC_INVOICING_REFRESH_TOKEN (rpinvoicing) and
  GMAIL_REFRESH_TOKEN (maintenance). lib/billing-inbox-sync.ts: syncInbox/syncAllInboxes (Gmail search per inbox
  → store attachments → classify kind/vendor/ref), extractDocument/extractPending (Claude `claude-sonnet-5`, PDF/image
  document blocks, forced `record_document` tool, fallback claude-sonnet-4-6) + matchLinesToCatalog (normalized
  part number, prefix-stripped, then contains). Route GET /api/billing/inbox-sync?secret&pass=sync|extract|both
  (CRON_SECRET); GitHub Actions gmail-sync.yml job `billing-inbox-sync` every 15 min. Never archives/marks read.
  UI: /inventory/receive/queue (tabs by status, inbox status strip, Sync now), /inventory/receive/queue/[id]
  (attachment preview via signed URL, editable lines with PartPicker re-match / "create as new part", mode
  "Put into stock" (receive rows + receipt cost) or "Cost update only", duplicate-reference warning, dismiss).
  Actions: app/(app)/inventory/inbox-actions.ts (runInboxSync, reextractDocument, dismiss/reopen, postInboxDocument).
  Shared cost rule: lib/inventory-costing.ts applyReceiptCost (used by receiveStock and postInboxDocument).
  Settings → "Billing inboxes" card (app/(app)/settings/billing-inbox-panel.tsx): connected/not per inbox + how to
  mint a token (OAuth Playground, gmail.readonly, same GMAIL_CLIENT_ID) + Sync now. Hub/receive page show queue count.
  Invoice email-out: lib/invoice-pdf.ts buildInvoicePdf (shared with the PDF route); emailInvoice action in
  app/(app)/construction/actions.ts (Resend, PDF attached, logs billing_emails, draft → sent); UI
  components/construction/email-invoice-form.tsx on /construction/invoices/[id]. Needs RESEND_API_KEY +
  RESEND_FROM_EMAIL (optional RESEND_INVOICE_FROM, RESEND_REPLY_TO) in Vercel — not set as of 2026-09-16.
  Shop count import: Smartsheet "2025/2026 INVENTORY 12/31/25" (Item ID / Description / QTY / LOCATION=bin) →
  supabase/seed/smartsheet_shop_inventory_2025-12-31.csv → `node scripts/import-smartsheet-inventory.mjs --apply`
  (idempotent, ref_label SMARTSHEET-2025-12-31, txn 'count' on "Office / Hill", bins on stock_levels, vendor prefix
  GIL-/VDR-/GRD-… stripped for matching, unmatched parts created with sku SMARTSHEET_2025 + price_needed).
  Applied 2026-09-16: 946 lines / 6,018 units / 839 new parts. Truck sheets were NOT visible to Trae's Smartsheet
  login (only the Construction Department workspace is shared) — import them the same way once shared.
- BILLING MODULE re-home (2026-09-18): quotes and invoices moved OUT of Construction to top-level `/billing`
  (shared by Construction + Service; `department` column). Old URLs /construction/quotes|invoices redirect
  (next.config.ts). Tables keep their con_* names. Migration `supabase/migrations/billing_rev19_module.sql`
  (APPLIED): line items carry `category` 1–12 + REV19 inputs (sales_tax_pct, markup_pct, freight_per_unit,
  markup_applies, men/hrs_each, travel_days/techs, day_label, crew, source_note, price_flag, sort_order);
  headers carry the INPUTS block (material_markup_pct, material_tax_pct, sub_markup_pct, labor_rate, rate_card_id,
  contingency_pct/flat/amount, profit_overhead_percent, sales_tax_percent=0), header block (site_number, bid_due,
  project_manager, construction_manager, foreman, compiled_by), scope_rows jsonb, exclusions, warranty_line,
  category_totals jsonb, the three roll-ups, is_starting_quote, work_order_number, csr/po on quotes.
  Engine: lib/rev19.ts (REV19_CATEGORIES, computeRev19: cats 1–4 (cost+tax)×(1+markup)+freight; 5/9/10/12 cost
  with MARKUP? Y/N; 11 cost + 15% on the category; 6 rate×tech-nights; 7 men×hrs each×rate by day; 8 travel
  days×techs×$100; roll-up taxable → 5+9+10+11+12 → 6+7+8 → contingency → P&O → quote-level tax 0 → total).
  Guard: lib/billing-guard.ts (Construction allowlist OR BILLING_READ/WRITE_ROLES in lib/billing.ts).
  Actions: app/(app)/billing/actions.ts (saveQuote/saveInvoice, status, delete, duplicateQuote,
  convertQuoteToInvoice). UI: /billing hub, /billing/quotes[/new|/[id]|/[id]/edit], /billing/invoices[…],
  components/billing/rev19-builder.tsx (header + INPUTS + scope rows + Basic/Additional sections × 12 category
  panels with per-kind columns, PartPicker on every line, price flags, live face), doc-face.tsx, doc-detail.tsx.
  PDF: lib/billing-pdf.tsx → GET /api/billing/quotes|invoices/[id]/pdf?view=face|breakdown|both (RP QUOTE
  TEMPLATE face + landscape MATERIAL AND LABOR BREAKDOWN with pink/green/orange fills). Verified against the
  SU-8001 REV19 workbook to the penny ($70,221.44); that quote exists as Q2026-SU8001 as a worked example.
- Quote numbers are `Q<year>-<site key>` then A, B ... Z, AA, BB ... for further quotes on the same site that year
  (site key = site number with punctuation stripped: SU-13400 -> SU13400, IP-1234 -> IP1234, 40312). Trigger
  `con_set_quote_number` in `supabase/migrations/billing_quote_numbers_by_site.sql`. Invoices stay INV-YYYY-####.
- The face is the itemised RP quote layout (lines under category headers; materials vs services columns);
  pages 2+ carry a small running header. `?detail=0` on the PDF gives the category roll-up.
- An approved quote gets a **Start project** button -> creates a Construction job (stage permitting) linked via
  `con_quotes.job_id`. Construction jobs are the project-management pipeline; invoicing happens at the end.
- Trae does not want this module called "Billing" (nav now says Quotes & Invoices); the target shape is
  Quotes -> Projects (Construction jobs) -> Invoicing, plus daily Service invoicing from tickets.
  Catalog gained sku REV19_RATE_CARD rows (lodging, per diem, mobilization, disposables, permits).
  PDFs carry the company letterhead (public/rps-letterhead-logo.png, from Proton Drive Documents/Logos) and mirror
  the RP QUOTE TEMPLATE sheet (peach headers, gray bands, black grid, boxed title, signature line). Quotes print
  one row per category, invoices every line (?detail=0|1). Legacy imported invoices print as stored (`fixed`).
  SIGNER IS PER DOCUMENT: builder "Signed by" picks any active profile (profiles.job_title prints under the
  name, editable in Settings → Users); defaults to the logged-in user. No hardcoded Starsky/Ernie/Trae anywhere
  in Billing — prepared_by = "Name, Title" text + signer_id.
  Reference docs: iCloud Project Folders/Previous Project Files and Closeouts for Claude Reference/00 - RPS Quote
  Types and Historical Examples (pre 04-30-2022).md + the rps-quote-builder skill.
- Next: connect econstruction + constructionreceipts tokens (Trae mints them), RESEND key for email-out, truck
  inventory sheets from Smartsheet, quote → Excel (REV19 workbook) export, Phase 6 (warranty claims, compliance
  SKUs, historical pull before Mar 2026).

---

## TOOLS & SUPPLIES PER ASSET (added 2026-10-13)

Tools and supplies bought for a truck live on the asset, NOT on repair tickets (receipts on a ticket muddy the repair
history and use up the ticket's 4-attachment cap).
- Migration `supabase/migrations/asset_tools_supplies.sql` (run in Supabase SQL Editor — NOT applied until Trae/owner runs it):
  `asset_tool_types` (item types + `repeat_window_months`, seeded ~21 types per company), `asset_tool_items`
  (asset_id, type_id, item_name, kind tool|supply, quantity, total_cost, purchased_on, vendor, receipt_url,
  status on_truck|lost|replaced|consumed|removed, expense_id), plus an asset expense category "Truck Supplies"
  ("Truck Tools & Equipment" already existed).
- Third kind `fluid` (DEF, oil, coolant…): no repeat alert (window 0), optional odometer (`mileage`) per fill-up → page shows fluid cost per mile once a truck has 2+ fill-ups with mileage; own expense category "Truck Fluids".
- UI: /assets/[id]/tools (totals, purchases list, add form, status, delete = owner/manager). Linked from the asset
  page ("Tools & Supplies" pill + summary card). Code: app/(app)/assets/[id]/tools/*, lib/asset-tools.ts.
- One entry, two views: adding an item (default on) also inserts an `expenses` row (expense_type 'asset',
  category by kind) and stores `expense_id`; deleting the item deletes that expense.
- Repeat-purchase alert: same asset + same item type (or same normalized name when no type) inside the type's
  window → `notifyRepeatToolPurchase` (lib/notifications.ts, alert type `repeat_purchase`, registered in
  settings/alerts) → per-person notifications to owner/manager/shop_manager/construction_manager only (not company-wide).
  Default window 12 months when no type is picked; 0 disables checking for a type.

---

## DQF & CERTIFICATIONS MODULE (added 2026-10-23)

Replaces the Smartsheet "DQF & Cert Tracker" (sheet 6846054072117124). Top-level `/compliance` ("DQF & Certs" in the nav,
module key `compliance`; roles owner/manager/construction_manager — `lib/compliance.ts` COMPLIANCE_*_ROLES).
- Migration `supabase/migrations/hr_compliance_module.sql` (APPLIED 2026-10-23): hr_employees (roster, DOT/CDL flags,
  linked to con_contacts/profiles), hr_requirement_types (catalog: category dqf|certification|personnel, applies_to
  dot|cdl|all|optional, expires, renewal_months, per-type notice_days override), hr_employee_items (one per employee ×
  requirement; blank expiry = issued + renewal_months), hr_item_history (renewals), hr_compliance_settings (notice days
  per side, overdue repeat, employee/management email lists, weekly digest, master `emails_enabled` — OFF by default),
  hr_notice_log (dedup). Private bucket `hr-compliance` (scans upload direct via signed upload URL).
- "Every DOT driver"/"CDL"/"all" requirements show on a file automatically (virtual until saved); optional certs are added per person.
- Daily check: `lib/compliance-notices.ts` → GET /api/compliance/check (CRON_SECRET) fired by
  `.github/workflows/compliance-check.yml` at 11:00 UTC. Stage = tightest notice window; dedup on (item, stage, expiry);
  expired notices repeat every `overdue_repeat_days`. Employee emails + management lists + weekly roll-up via Resend.
- Import: `node --env-file=.env.local scripts/import-smartsheet-dqf.mjs <seed.json> [--apply]` (idempotent). The seed holds
  personal data, so it is NOT in git: Work Mac copy at ~/Library/Application Support/RPS Compliance/. Sheet password/code columns deliberately NOT imported.
