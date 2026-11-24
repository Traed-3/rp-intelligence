# Build prompt — RPS Intelligence Project Intake

## New session setup (do this before pasting the prompt)

1. Open Claude Code **in the repo folder** (`rps-maintenance`, the RPS Intelligence app), not in your home folder. From the Code tab, add the folder as the session directory if it is not already.
2. Make sure `docs/project-intake/RPS_Project_Intake_Plan.md` and this file are in the repo (they are, once the rebrand PR is merged).
3. Prerequisites that make Phase 1 real: `GMAIL_TOKEN_ECONSTRUCTION` in `.env.local` and in Vercel. Without it the build still works against the maintenance inbox token for testing, but nothing real arrives.
4. Branch rules for the session: `git fetch` first; branch off `origin/main` (never force-push `work-main`; the work Mac uses it); one PR per phase; you merge.
5. Paste everything inside the box below as one message.

---

```
Build the Project Intake & Quote Workup feature described in
docs/project-intake/RPS_Project_Intake_Plan.md. Read that plan first, all of it.

Then read, in this order, before writing any code: CLAUDE.md and AGENTS.md (Next.js 16,
proxy.ts, conventions), lib/billing-inbox-sync.ts and lib/billing-gmail-client.ts (the
inbox pattern to copy), lib/svc-work-order-docs-extract.ts (the Claude read pattern to
copy), app/(app)/construction/actions.ts createJobFromWorkOrder and fileDocument (job and
document creation), lib/rev19.ts and scripts/import-rev19-quote.ts (quote lines and the
engine), lib/notifications.ts and app/api/daily-summary/route.ts (how reminders reach
people), and ~/.claude/skills/rps-project-intake/REFERENCE.md (what the manual skill does
today; the app replaces it pass by pass).

Tell me what stack and patterns you found before you start. Match them. Same framework,
same database, same folder layout, same styling, same auth, same clickable-row tables.
Do not introduce a new library if one in the project does the job.

WHAT TO BUILD, IN THIS ORDER. Stop after each step, show me what works in the preview,
and wait for me to say go before the next one.

STEP 1 — Data layer and intake sync
Migration for con_intake_items, con_followups, the con_jobs columns, the
con_quote_readiness view and the private project-intake bucket, exactly as in plan
section 4. Then /api/projects/intake with passes sync, classify and file (plan section 5)
reusing billing-gmail-client for econstruction, the three queries from the skill's
REFERENCE §1, classifySite for site and brand, and the same idempotency as the Receive
queue (unique source + message_id). Add the job to .github/workflows/gmail-sync.yml every
15 minutes. Build /construction/intake with tabs New / Needs review / Filed / Ignored, an
inbox status strip, Sync now, and an item page with attachment previews, site / brand /
kind editors, File to job, Ignore. Filing copies attachments into construction-docs +
con_documents with a doc_type and appends the email text to the job. Run it against the
real inbox for the last 30 days and show me the queue.

STEP 2 — Claude reads the survey
Pass extract: for each filed item, send the photos, PDFs, workbooks and body to Claude
with a forced record_survey tool (plan section 6). Store the result on the item and roll
the findings up into con_jobs.survey_summary. Build the Quote workup panel at the top of
the job page: survey summary, findings by location with photo thumbnails, the take-off
proposal table, the questions Claude raised. HEIC photos get converted or listed as
unreadable, never silently skipped.

STEP 3 — Propose the quote and open the ledger
Pass propose: take-off rows become draft con_quote_line_items on a starting quote for the
job (price_flag on every unpriced line), purchasable rows become con_job_materials with
status needed, and every gap becomes a con_followups row with the default owner and due
date from plan section 7. Vendor quote items price matching open lines (reuse
matchLinesToCatalog). Push to quote is a button; nothing is written without it. Show
readiness % on the job page and the quote page, and block sent / approved while a price
or hours follow-up is open. Enforce that in code, not just the UI.

STEP 3b — Nearby vendors
Extend con_vendors with address, lat/lng, service radius, a categories array and
website (plan section 4), geocode existing vendors and sites once, and add the
con_site_vendor_distance view. In the Quote workup panel and the quote builder, when a
quote has concrete / disposal / equipment / subcontractor lines, show the vendors within
the site's radius sorted by distance with a Draft RFQ button that writes the request
(quantity, spec, site address, date window) to the job's Documents. Drafts only, never
send. Seed with the Richmond VA concrete and disposal vendors already in Construction →
Vendors.

STEP 4 — Nudges
Pass nudge, daily: apply the cadence in plan section 7, bump nudge_count, bell the owner
(notifications.ts), email the owner through Resend when configured, and write the
"Projects waiting on you" block at the top of the 3 pm daily summary. Give Ask RPS a tool
that answers "what is holding up <site>" from the ledger. Dashboard tile with the count.
Answering a follow-up writes the value back to the line, the labor row or the job and
logs activity_log.

STEP 5 — Mirror and Proton
A Download project folder action on the job page that zips the job's documents into the
iCloud layout from the skill's REFERENCE §2 (Survey Pictures, Drawings, Quote Request,
Vendor Quotes, Emails, the survey-emails text and the Quote Workup markdown). A manual
drop zone on the intake page for Proton mail and anything else. Update the skill's
REFERENCE.md so its steps 4–9 call the app instead of doing the work by hand.

RULES THAT MATTER
- Never invent a price or an hour. Unpriced means price_flag + a price follow-up.
- Never archive, label, move or reply to mail. Read-only Gmail, like every other sync.
- Never email a vendor or customer automatically. Drafts only.
- Every follow-up has exactly one owner and one due date. No owner means Trae.
- A survey with no work order still creates the job (stage survey). The ledger asks for
  the work order.
- One intake item can attach to one job. If the site already has an open job, append to
  it and tell me; never create a second job for the same site and work order.
- Re-running any pass never duplicates anything.
- Keep the app deployable after every step. TypeScript everywhere. Run tsc before you
  show me a step.

I am not a developer. When you finish each step, tell me in plain English what you
built, what I should click to test it, and anything you had to guess at. Give me the
exact commands to run, and say which folder to run them from.
```

---

## After it builds

Run `/rps-project-intake` and the app side by side for two weeks. The skill keeps handling Proton and the iCloud mirror; the app becomes the source of truth for everything else. When the ledger has nagged you through one full quote without anyone opening a spreadsheet, retire the manual steps 4–9 of the skill.
