// ============================================================
// Ask RPS — what it knows about using the app, for "how do I…" questions.
// One block per area. A person is only told about the parts of the app they can open, so the assistant never
// explains a page that would just send them away. Keep this in step with the pages: when a button is renamed or a
// page moves, update the line here.
// ============================================================

import { HELP_GUIDES } from '@/lib/help'
import { TRAINING_VIDEOS } from '@/lib/training'
import { canUseFieldSurveys } from '@/lib/field-surveys'
import { roleMayVisit, canUseSettings, canAssignPlate } from '@/lib/role-access'
import { canUseArea, type AssistantArea, type AssistantWho } from './access'

const AREA_GUIDE: Record<AssistantArea, string> = {
  plate: `MY PLATE (/my) — each person's to-do list, ordered so the top card is the next thing to do (overdue, due today, hot, due within 3 days, then the rest). Mark a card Done, add a note ("where I am with it"), or add your own to-do at the top. Cards waiting on someone else sit in their own list.`,

  assets: `MAINTENANCE & FLEET (/maintenance) — the fleet hub: what is overdue or due soon (oil changes by mileage; state inspection, registration, brake and tire inspections by date). Assets (/assets) lists every truck, trailer and piece of equipment; open one to see its history, enter mileage, record an oil change / brakes / tires, and its Tools & Supplies. Building / facility assets are "Property" (no mileage or inspections). The state inspection is the yearly one done by an outside shop; RPS does no DOT inspections.`,

  tickets: `REPAIR TICKETS (/tickets) — shop and fleet repairs. Open a ticket for the status buttons (Start Work, Waiting on Parts, Mark Complete, Reopen), comments, photos and the labor timer. Edit changes title, priority, asset and due date. Assign someone from the "Assigned To" cell on the Tickets list or the Maintenance dashboard. "Completed" is the one closed status. Shop emails to the maintenance inbox turn into tickets on their own; ones that do not match land in Review. On the phone: Report an Issue.`,

  shop: `SHOP & TIME CLOCK (/shop) — Clock In / Out (/shop/clock, also at the top of My Plate), set your status, My Tasks, general shop time, and the live board of who is in and what they are on. Managers approve time at /time/approvals.`,

  construction: `CONSTRUCTION (/construction) — the job pipeline mirrored from the master schedule (Job List). Stages in order: Survey, Quote, Permitting, Waiting on Material, Needs Scheduled, Scheduled, In-Progress, On Hold, Return Needed, Close Out/Invoice, Need Invoiced, Complete (plus Overspill Program). A job follows the Job List; it is Complete only once it is off the Job List. Open a job for its scope, dates, Documents, Daily Updates (crew updates and tickets), permits, and the project notification (7-Eleven wants it sent 7 days before start, 3 days at the latest). Other pages: Schedule (crew calendar), Permits (dashboard in three piles: Waiting / In progress, Need final inspection, Completed; completed permits drop out of the alerts; Hash pulls VA electrical, J&J Electric MD/WV electrical, RPS the mechanical / building), Customers, Contacts, Vendors, Subcontractors, Materials, Documents to review, Reports. Crews post a daily update from the phone (/mobile/daily-update). The Construction Playbook (Technical Help → Construction Playbook, /help/construction-playbook) explains the module day to day: jobs, the status colors, quote or no quote, the schedule, materials, quotes and invoices. On a job, the Materials tab lists every order and purchase for it (vendor invoices, packing slips and receipts emailed in, with the lines read off the paper; a packing slip with no invoice yet shows with no total), and the Cost Summary tab leads with an Invoice preview: what the job would bill for so far at time and material (labor at the customer's rate, a trip per tech per day, one disposables line, parts at cost +20%, everything else at cost +15%), with Materials, Other expenses (hotels, permits, electricians, pump-outs) and Labor (man-hours from field tickets, daily updates and the labor log) listed under it. Nobody types these in: a purchase lands on the job named by the site number or PO in the email subject.`,

  sites: `SITE LOOKUP (/construction/sites, also on the main menu) — find any store by number, street, city or brand and see its address, brand and equipment. Sunoco sites are named SU-<house number>.`,

  service: `SERVICE DISPATCH (/service) — service calls synced from the dispatch email (rpdispatcher) and the techs' tickets (rpinvoicing). Statuses: dispatched, on site, in progress, waiting on parts, return trip needed, completed, invoiced. A call is complete when a tech's ticket comes in that does not ask for a return trip (RTN); the latest ticket decides. Open a call for the dispatch text, timeline and "Tickets sent in". Tickets → All tickets (/service/tickets/log) is the searchable log of every ticket emailed in, front, back and parts; "Words & lingo" holds the company abbreviations the reader uses. Field tickets: /service/tickets, or Service Ticket on the phone (/mobile/service-ticket): Find a call by WO number, store, street or city and press Start ticket, fill in Work performed, hours, parts and photos, sign, then Turn in ticket with Job complete or Return trip needed. The office sees it under Field Tickets → Turned in by the tech. Turning a field ticket in does not close the service call.`,

  billing: `QUOTES & INVOICES (/billing) — one place for Construction and Service. Quotes are numbered Q<year>-<site> (then A, B…); change orders hang off a quote. New quote → the REV19 builder (header, inputs, scope, 12 categories, part picker on every line) → PDF. An approved quote gets "Start project", which creates the Construction job. Invoices are INV-YYYY-####; Create invoice from an approved quote or a signed service ticket, then Email it from the invoice page. Pricing rules: never invent a price; 20% material markup; prices older than 6 months need checking.`,

  inventory: `INVENTORY (/inventory) — Parts (/inventory/parts: search the catalog, cost and where it came from, on hand per location), Stock (/inventory/stock: each shelf and truck, below-minimum, counts), Transfers (move stock between shop and trucks, "Fill to max"), Locations.`,

  compliance: `DQF & CERTS (/compliance) — driver qualification files and certifications. Each employee file lists the DOT items (application, pre-hire MVR, prior-employer history, road test, medical card, National Registry check, annual MVR, annual review) and certifications with expiry dates; upload the scan on the item. DOT audit (/compliance/audit) lists every gap; Forms (/compliance/forms) has the blank RP-letterhead forms. Expiry emails are set in Notices & settings.`,

  expenses: `EXPENSES (/expenses) — every receipt (typed in or emailed to Construction Receipts). Submit a receipt starts with a photo and fills itself in. Receipts by payment type (/expenses/receipts) is the monthly tick-off against card statements and vendor bills; Card & account audit flags duplicates and mismatches; Spending report and Fuel are under the same page. Receipt email subject: AMOUNT CODE TRUCK-or-SITE WHAT (e.g. "3.37 TEC 32367 soap").`,

  calendar: `CALENDAR (/calendar) — one company calendar: scheduled construction work and time off, plus fleet due dates (state inspection, registration, brake and tire inspections). Oil changes go by mileage, so they are not on it.`,
}

export function appGuide(who: AssistantWho): string {
  const parts: string[] = []
  for (const area of Object.keys(AREA_GUIDE) as AssistantArea[]) if (canUseArea(who, area)) parts.push(AREA_GUIDE[area])

  if (canUseFieldSurveys({ id: who.userId, role: who.role }) && roleMayVisit(who.role, '/forms'))
    parts.push(`FORMS (/forms) — ICON Boot Surveys, Hydrostatic Test Report and Spill Bucket & Overfill Tests (the PDF prints on the MD, VA or WV state form), Pre-Trip Inspection, Accident Report (emails the office when submitted), Site Surveys (with the site plan drawn over the aerial picture), and Submit a Receipt.`)
  else if (roleMayVisit(who.role, '/expenses/new') && !canUseArea(who, 'expenses'))
    parts.push(`SUBMIT A RECEIPT (/expenses/new) — take a photo of the receipt; the form fills itself in; check it and send.`)

  if (roleMayVisit(who.role, '/rpmail'))
    parts.push(`RPMAIL (/rpmail) — your own mail inside the app, if you have turned it on. Technical Help → Using RPMail explains it.`)

  parts.push(`TECHNICAL HELP (/help) — how-to guides and videos: ${HELP_GUIDES.map(g => `"${g.title}" (/help/${g.slug})`).join('; ')}; also "Add to Home Screen" (/help/home-screen) and "Using RPMail" (/help/rpmail).`)
  parts.push(`TRAINING (/training) — company training videos: ${TRAINING_VIDEOS.map(v => `"${v.title}" (/training/${v.slug})`).join('; ')}.`)
  parts.push(`PHONE — the app installs on the home screen (Technical Help → Add to Home Screen). The phone home (/mobile) leads with My Plate and Forms; the bottom bar can be changed in Settings → Personalize (if you have Settings).`)

  if (canUseSettings(who.role))
    parts.push(`SETTINGS (/settings) — Users (add people, set a temporary password, Send invite, roles, block a module for one person), Personalize (menu order, phone tabs, dashboard cards), Alerts, Company, Payment methods, RPMail.`)
  if (canAssignPlate(who.role))
    parts.push(`Putting a to-do on someone else's plate: My Plate → add → pick the person in "For:".`)

  return parts.join('\n\n')
}
