# Industry Research: Quote → Invoice → Field Service Ticket + Truck/Office Parts Inventory for a Petroleum Service Contractor (RPS)

Scope: how petroleum construction/service contractors (pump-and-tank installers, dispenser/UST/AST/ATG service) structure quotes, invoices and field tickets; how field-service software models truck inventory, quote-to-invoice and e-signatures; and data-model patterns worth copying. Sources are listed at the end.

---

## 1. Quotes / Proposals

**Two quote types coexist in this trade and should be modeled as one document with a `pricing_mode` flag:**

- **Fixed-price / lump-sum proposals** for construction and installs (tank sets, dispenser swaps, sump/line replacements). Priced from a cost buildup (materials + labor + subs + equipment + permits) but presented as a total or a short schedule of values.
- **Time & Material (T&M)** for service and troubleshooting, priced from a labor rate card plus materials at markup, often with a "not-to-exceed" (NTE) ceiling when the customer is a chain using a facilities portal.

**Sections that recur in real contractor proposals** (sjcivil proposal T&C guidance; PEI-member contractor sites; NJ state fuel-tank RFP structure):
1. Header: quote #, date, customer, **site/store #**, site address, customer contact, RPS estimator, customer PO/reference #.
2. Scope of work (narrative + optional line-item schedule).
3. **Inclusions / Exclusions / Conditions** — the single most emphasized structure in contractor-proposal guidance. Typical petroleum exclusions: permits & fees, concrete cut/patch beyond stated area, rock or contaminated-soil excavation and disposal, dewatering, electrical beyond the disconnect, product removal/tank cleaning, engineering/stamped drawings, state UST registration fees, striping, third-party testing, downtime credits.
4. Pricing: lump sum or SOV; T&M shows rate card + estimated hours + material allowance.
5. Rate card (T&M): straight time, overtime (1.5x after 8 h / weekday evenings), Sunday/holiday (2x), 4-hour minimum, travel/trip charge or mileage, per diem beyond a radius, equipment day-rates (excavator, vac truck, crane), technician classification tiers (helper / tech / ATG-certified tech). Rate sheets from field-service firms (ABB, All World Machinery, Marine Diesel, Miller Environmental) all follow this pattern.
6. Material handling: "materials at cost plus X%" or list price; freight/expedite pass-through.
7. Payment terms: **Net 30** standard; deposit/mobilization (often 30–50%) on construction; progress billing on multi-week jobs; "not subject to pay-when-paid," no retention (or state retention %).
8. **Validity**: 30 days is the norm (material volatility on steel, FRP, electronics).
9. **Change orders**: written CO required for scope changes; unforeseen conditions (rock, contamination, buried obstructions) billed T&M at the rate card.
10. Warranty: 1 year workmanship is common for installs; manufacturer warranty on equipment passed through; no warranty on customer-supplied parts.
11. Signature/acceptance block (customer name, title, date, PO #).

**Chain-customer wrinkle (7-Eleven, Circle K, Sunoco/Energy Transfer, Global):** large retailers dispatch through facilities platforms such as ServiceChannel or Corrigo (JLL) or procure-to-pay portals (Coupa, SAP Ariba, Taulia). These impose an **NTE** on the work order; any work above NTE requires a **proposal submitted in the portal and approved before parts are ordered or work proceeds**. Your quote record therefore needs `portal_work_order_number`, `nte_amount`, `proposal_submitted_at`, `proposal_approved_at`.

**Progress billing** on installs follows the AIA G702/G703 pattern: schedule of values, % complete per line, previous billed, retainage, current due, approved change orders rolled in.

---

## 2. Invoices and Field Service Tickets / Work Orders

**Field ticket (what the tech fills in on site) — fields seen across petroleum FSM vendors (ECI Davisware, Fieldpoint, Aptora 360 "PEI software", FieldEquip) and generic service-ticket templates:**

- Identifiers: ticket/CSR #, related quote #, customer PO #, **store #/site ID**, portal WO # (ServiceChannel/Corrigo), brand (7-Eleven/Sunoco/etc.), site address, dispatch priority/SLA.
- Asset: which tank/dispenser/ATG (serialized equipment — Davisware and Fieldpoint both track serialized tanks, dispensers, monitoring devices), fuel grade/position, model + serial.
- Problem reported → work performed → root cause / resolution codes (ServiceChannel requires these at check-out).
- **Labor**: per-tech start/stop (check-in/check-out with GPS timestamp), travel time, rate class (ST/OT/DT), tech certifications used (e.g., Veeder-Root ATG cert, state UST installer license).
- **Parts used** (SKU, description, qty, source location = which truck/warehouse, serial where applicable) and **parts returned/unused** (back to truck) — plus **core/warranty returns** flagged separately (Davisware calls out "core returns" as 5–15% revenue leakage).
- **Charge type per line**: Billable / No Charge / **Warranty** (manufacturer) / Contract (PM agreement) / Callback (RPS re-work). This is what lets one ticket produce a customer invoice *and* a manufacturer warranty claim.
- Compliance data when applicable: test type, method, pass/fail, readings, report attachment (EPA requires pass/fail documentation and corrective actions on record).
- Photos: before / after / nameplate / test readout; attachments (test report PDF, permit, ATG printout).
- **Signatures**: technician signature + customer/site-manager signature (name, title), captured on phone/tablet; timestamp + device. Jobber/Housecall Pro/Fieldpoint/Aptora all capture on-glass signatures; Jobber also embeds the signature on the quote/invoice PDF.
- Status flow: Dispatched → En route → On site → Work complete → Ticket signed → Invoiced (or "Needs quote" if NTE exceeded).

**Invoice — fields and conventions:**
- Invoice #, ticket #(s), quote #, customer PO #, store #, portal WO #, service date(s), tech(s).
- Line groups: Labor (hours × rate, with ST/OT breakdown), Materials (each part with qty, unit price, extended), Trip/Travel, Equipment, Subcontract/Third-party (pass-through), Permits/Fees, Tax (materials taxable, labor often not — VA/MD/DC/WV differ; store tax jurisdiction on the site).
- Zero-dollar lines for Warranty / No Charge / Contract-covered work so the customer sees what was done (and the manufacturer claim can be built from the same lines).
- Terms Net 30 (chains sometimes Net 45–60 via portal); late fee text; remit-to and ACH info.
- **Portal requirements** (ServiceChannel guidance): one invoice per work order; submit within ~10 days of Completed/Confirmed; invoice cannot exceed NTE; attach the signed ticket and any test reports; check-in/out must exist for the WO or the invoice is rejected. Coupa/Ariba: invoice must "flip" from the PO and match PO line, qty, price; service lines often need a service sheet.

---

## 3. What FSM Software Does (inventory-by-truck, quote-to-invoice, e-sign)

**ServiceTitan** (best-documented truck-stock model):
- **Inventory templates** = stock list per location with per-item `Min` (reorder point), `Max`, bin location; a template can be assigned to many trucks.
- **Replenishment trigger**: when `available + on_order < min`, the system creates a replenishment to bring the location back to `max`; fulfilled either by a **transfer from warehouse** (only warehouse→truck allowed for replenishment) or by a **purchase order** to the item's primary vendor (one PO per vendor or per truck).
- **Decrement rule**: materials placed on the job invoice consume truck stock ("Materials Used" list) and start the replenishment cycle; a location can go negative.
- **Transfers** between any two locations (warehouse↔truck, truck↔truck) with statuses **Pending → Picked → Received** (or Canceled); both locations update on receipt.
- Cycle counts/adjustments exist but are lightly documented — counts post as adjustment transactions.

**FieldEdge**: each truck is its own stocking location; a work-order product marked "Used" deducts from its warehouse; POs can target a warehouse or a specific work order; replenishment alerts fire before stock-out; invoice syncs to QuickBooks immediately.

**Simpro** (best price-book-vs-stock model): **Catalogue item** (price book: default supplier, nett/trade price, markup, pricing tiers) vs **Stock item** (the "actualised" catalogue item once purchased or taken from the warehouse; actual cost = PO receipt unit price or stock-take value). **Pre-builds** = assemblies of parts + labor with either computed or flat-rate sell price. Pricing-tier precedence: item-level > job/quote > customer contract > customer > system. Quote → job → progress claims / retention.

**BuildOps** (commercial): inventory across trucks/warehouses/job sites with serial tracking; every material pull is tagged to a job with who/when/where-from; tech app shows truck contents before roll-out and lets the tech request missing items.

**Jobber / Housecall Pro** (SMB): quote with optional/add-on line items, online approval with drawn signature embedded in the PDF, deposit collected at approval and auto-applied to the invoice, quote auto-converts to job then invoice.

**Petroleum-specific**: ECI Davisware and Fieldpoint add serialized equipment, compliance checklists with photo capture and regulatory report output, PM/service agreements with automated scheduling, warranty & core-return workflows, subcontractor management; Aptora markets a "PEI" package with flat-rate pricing, invoices generated from completed work orders, service-agreement reminders for compliance testing, and an audit trail of parts replaced and tech certifications. Titan Cloud/Canary sit on the *owner* side (ATG data, compliance calendars) — RPS's system should export test results in a form those owners can file.

---

## 4. Data-Model Patterns Worth Copying

**Parts catalog (price book) — one table, referenced everywhere:**
`part_id, sku (RPS internal), manufacturer, mfr_part_no, vendor_part_no (per vendor), description, family (ATG/Probe/Sensor/STP/Dispenser/Spill/Shear/Sump/Boot/Cover/Hanging hardware/Electrical), uom, is_serialized, is_stocked, taxable, list_price, sell_price, markup_pct or price_tier, last_cost, avg_cost, std_cost, primary_vendor_id, lead_time_days, warranty_months, superseded_by_part_id, active`.
Keep **price-book items** (things you can quote: parts, labor SKUs, trip charge, permit pass-through, "Annual LLD test" service) distinct from **inventory items** (`is_stocked = true` subset with on-hand by location). Labor and services are price-book rows with no stock.

**Stock locations:** `location_id, type (warehouse|truck|jobsite|vendor|customer_owned), name, assigned_tech_id, template_id`. Truck = location, not a person; techs can change trucks.

**Stock levels** (derived or materialized): `location_id, part_id, on_hand, allocated, on_order, min, max, bin`.

**Inventory transaction ledger — append-only, every movement is a row:**
`txn_id, ts, type (RECEIVE | ISSUE_TO_TICKET | RETURN_FROM_TICKET | TRANSFER_OUT | TRANSFER_IN | ADJUST | COUNT | WARRANTY_RETURN | SCRAP), part_id, from_location_id, to_location_id, qty, unit_cost, ref_type (po|ticket|transfer|count), ref_id, user_id, note`.
On-hand = Σ ledger; avg_cost recomputed on RECEIVE (weighted), last_cost = latest RECEIVE unit cost. Transfers are two-legged with a header status (Pending/Picked/Received) so in-transit stock is visible. Counts create ADJUST rows with reason codes.

**Quote → Ticket → Invoice conversion:**
- `quote` (header + `quote_line`) with `pricing_mode`, `valid_until`, `nte_amount`, `status (draft|sent|approved|declined|expired|converted)`, `approved_by / approved_signature / approved_at`, `deposit_amount`.
- On approval create `job` and one or more `service_ticket`s; copy quote lines to `ticket_line` as **estimated** lines; techs add **actual** labor/parts lines (ServiceTitan/Simpro estimated-vs-actual pattern).
- `invoice` built from ticket actuals (T&M) or from quote/SOV (fixed price, progress). Keep `invoice_line.source_ticket_line_id` for traceability. Progress invoices carry `sov_line_id, pct_complete, previous_billed, retainage`.
- `change_order` links quote ↔ job with its own approval signature; approved COs feed the SOV.

---

## 5. Petroleum-Specific Line Items, Part Families and Compliance Billing

**Part families to seed in the catalog** (manufacturers/distributors: John W. Kennedy, Global Fueling Systems, JME, Source NA):
- **Veeder-Root**: TLS-450PLUS/TLS-350 consoles, Mag probes (e.g., 847390-1xx by length), Mag sump/dispenser-pan sensors, interstitial sensors, LLD (PLLD/WPLLD), printers, comm modules, Red Armor STP.
- **OPW**: 1-2100 / 1-2200 / 1-3100 spill containers and replacement buckets/drain-valve kits (1DK-2100-EVR), 10-series emergency shear valves and tops (10BF/10BHMP/10RF), overfill prevention valves, fill caps/adaptors, Fibrelite composite covers and tank/dispenser sump kits (e.g., S8CR-390WT-KIT).
- **Franklin Fueling / Red Jacket**: STP pump-motor assemblies (4"), packers/manifolds, Quantum J-box adapters, UPP entry boots and adhesive install kits, FE Petro controllers.
- **Gilbarco / Wayne dispensers**: meters, pulsers, valves, boards, CRIND/keypads, printers, hanging hardware (hoses, nozzles, breakaways, swivels — often Husky/OPW/Catlow).
- **Icon Containment / other sumps**: tank and dispenser sumps, lids, reducers, test boots.
- Consumables: pipe dope, sealant, fittings, wire, fuses, filters (which are also a PM revenue line).

**Compliance-driven services (EPA 2015 UST rule, in force Oct 2018; states add more) — model each as a service SKU with a `compliance_type` and `interval`:**
- 30-day walkthrough (owner task; some contractors sell it as a monthly visit).
- Annual: release-detection operability test (ATG console/alarms/battery, probes/floats, sensors, **automatic line leak detector 3 gph trip test**), annual sump/handheld-equipment inspection, meter calibration (state W&M), Stage I vapor (where applicable).
- Every 3 years: spill-bucket tightness test, containment-sump test (if used for interstitial monitoring), overfill-prevention operability test.
- As required: tank/line tightness tests, cathodic-protection survey (60 days after install then every 3 years), ATG certification after install.
Records must show what was checked, pass/fail, and corrective action; retention 1–3 years. Bill these as flat-rate per-tank/per-line/per-bucket SKUs with a per-site trip charge, and attach the test report to the ticket/invoice so the owner (or Titan Cloud/Canary) can file it.

**Warranty labor handling:** Gilbarco Veeder-Root now runs warranty registration and claims through interactive.gilbarco.com (warranty@gilbarco.com); parts must have been registered by an authorized distributor; ASC status is generally required for warranty repairs; as of Sept 15, 2025 Veeder-Root stopped offering parts *credit* in lieu of replacement and stopped prepaying warranty return freight. Practical model: ticket lines with `charge_type = WARRANTY_MFR` roll into a `warranty_claim` record (manufacturer, claim #, RMA #, failed serial, replacement serial, labor hours claimed, reimbursement received) and the failed part moves through the ledger as `WARRANTY_RETURN` to a "Vendor RMA" location until credited or written off.

---

## Recommendations for the RPS Module

### Recommended fields

**Quote:** quote_no, customer, site/store_no, brand, site address, contact, estimator, pricing_mode (fixed|tm|progress), scope narrative, lines (part/labor/service/trip/permit/sub, qty, unit, unit_price, cost, markup, taxable, optional flag), inclusions, exclusions, conditions, rate-card snapshot, deposit, payment terms (default Net 30), valid_until (default +30 d), nte_amount, portal_wo_no, warranty text, status, approval signature/name/title/date, PO no, converted_job_id.

**Service ticket:** ticket_no, job_id, quote_id, customer PO, store_no, portal_wo_no, priority/SLA, asset(s) (type, mfr, model, serial, tank/position), problem, work performed, cause/resolution codes, per-tech labor (tech, rate class, start, stop, travel), parts_used (part, qty, from_location, serial, charge_type), parts_returned, warranty_return lines, compliance results (test type, method, pass/fail, readings, report file), photos (before/after/nameplate), tech signature, customer signature (name, title, ts), status, billable flag, needs_quote flag.

**Invoice:** invoice_no, ticket_ids, quote_id, PO, store_no, portal_wo_no, service dates, line groups (labor ST/OT/DT, materials, trip, equipment, sub, permits), zero-dollar warranty/no-charge/contract lines, tax by site jurisdiction, terms, due date, deposit applied, retainage, attachments (signed ticket, test reports), portal_submitted_at, status (draft|sent|portal_submitted|paid|disputed).

### Recommended inventory model
Price book (all quotable items) ⊃ stocked parts. Locations = Office warehouse + one per truck (+ Vendor-RMA + Jobsite). Per-location min/max templates by truck role (ATG truck vs. construction crew). Append-only ledger with the transaction types above; on-hand and costs derived. Parts placed on a ticket create `ISSUE_TO_TICKET` from the tech's truck at ticket-sign; unused lines create `RETURN_FROM_TICKET`. Nightly replenishment job: for each truck, if `on_hand + on_order < min` → create a warehouse→truck transfer (Pending → Picked → Received), or a PO to the primary vendor if the warehouse is short. Quarterly cycle count per truck via mobile scan; variances post as ADJUST with reason.

### 5–8 practices to copy
1. **One ticket, many charge types.** Every labor/part line carries Billable / No-Charge / Warranty / Contract / Callback so the same ticket feeds the customer invoice, the PM contract, and the manufacturer warranty claim (Davisware/Aptora pattern).
2. **Min/max templates per truck role with replenish-to-max** and warehouse-first, PO-second fulfillment (ServiceTitan).
3. **Two-legged transfers with Pending/Picked/Received** so in-transit parts are never "lost" (ServiceTitan).
4. **Estimated vs. actual lines** on every job; quote lines copy in as estimates, techs record actuals, and the invoice chooses which to bill based on pricing mode (Simpro/ServiceTitan).
5. **Cost from the receipt, price from the book**: avg/last cost updates only on RECEIVE; sell price from the price book with customer-tier override precedence (Simpro).
6. **Portal-aware billing**: store NTE, portal WO #, check-in/out timestamps, and root-cause/resolution codes on the ticket; block invoice > NTE and prompt a proposal instead; one invoice per WO; attach signed ticket + test report (ServiceChannel/Corrigo rules).
7. **Compliance services as scheduled SKUs** with interval and asset linkage, auto-generating next-due tickets and attaching pass/fail reports (Fieldpoint/Aptora service agreements + EPA 2015 intervals).
8. **Dual on-glass signatures with embedded PDF** — tech and customer sign on the tablet; the signature image and timestamp render on the ticket and invoice PDF, and quote approvals can carry a deposit (Jobber pattern).

---

## Sources
- ServiceTitan – Truck inventory replenishment overview: https://help.servicetitan.com/docs/truck-inventory-replenishment-overview
- ServiceTitan – Create and edit inventory templates: https://help.servicetitan.com/docs/create-and-edit-inventory-templates
- ServiceTitan – Replenish items using transfers: https://help.servicetitan.com/v1/docs/replenish-items-using-transfers
- ServiceTitan – Replenish items with purchase orders: https://help.servicetitan.com/roofing/docs/replenish-items-with-purchase-orders
- Home Service Engine – ServiceTitan inventory setup + workflows: https://homeserviceengine.co/blog/servicetitan-inventory/
- ECI Davisware – Petroleum equipment field service: https://www.ecisolutions.com/industries/field-service/petroleum-equipment/
- Fieldpoint – Petroleum equipment field service software: https://fieldpoint.net/petroleum-equipment/
- Aptora 360 – PEI software: https://www.aptora.com/industries/pei-software
- FieldEquip – Field inventory management: https://www.fieldequip.com/field-inventory-management-software/
- FieldEdge – Field service software: https://fieldedge.com/field-service-software/
- Simpro – Estimated and actual costs: https://helpguide.simprogroup.com/Content/Service-and-Enterprise/estimated-and-actual-costs.htm
- Simpro – Catalogue overview: https://helpguide.simprogroup.com/Content/Service-and-Enterprise/Catalogue-Overview.htm
- Simpro – Pre-builds: https://helpguide.simprogroup.com/Content/Service-and-Enterprise/Create-a-Pre-Build.htm
- Simpro – Pricing tiers: https://helpguide.simprogroup.com/Content/Service-and-Enterprise/Pricing-Tiers.htm
- BuildOps – Field inventory management playbook: https://buildops.com/resources/field-service-inventory-management
- Jobber – Quote approvals: https://help.getjobber.com/hc/en-us/articles/115012715008-Quote-Approvals
- Jobber – Deposits on quotes: https://help.getjobber.com/en/articles/deposits-on-quotes/
- ServiceChannel – Invoice promptly to get paid fast: https://servicechannel.com/learning-channel/get-paid-faster/
- ServiceChannel – Trade partner guide: https://servicechannel.com/services-providers/trade-partner-guide/
- ServiceChannel – 2025 NTE Insights Report: https://servicechannel.com/wp-content/uploads/2025/07/ServiceChannel-2025-NTE-Insights-Report-20250414.pdf
- CorrigoPro – Submitting quotes: https://developer.corrigopro.com/docs/submitting-a-quote
- Coupa – Invoicing for services in the CSP: https://docs.coupa.com/en/supplier-documentation/coupa-for-suppliers/the-coupa-supplier-portal-or-csp/features-and-processes-in-the-coupa-supplier-portal/service-sheets/invoicing-for-services-in-the-csp
- SAP Community – Invoicing in SAP Ariba: https://community.sap.com/t5/spend-management-blog-posts-by-sap/invoicing-in-sap-ariba/ba-p/13580659
- EPA – Operating and maintaining UST systems, 2015 requirements: https://www.epa.gov/ust/operating-and-maintaining-ust-systems-2015-requirements
- EPA – 2015 UST technical compendium: https://19january2021snapshot.epa.gov/ust/underground-storage-tank-ust-technical-compendium-about-2015-ust-regulation_.html
- Tanknology – Compliance testing services: https://tanknology.com/services/compliance-testing-services/
- Veeder-Root – Warranty and order support: https://www.veeder.com/us/veeder-root-warranty-and-order-support
- Veeder-Root – Warranty & commission transition FAQ: https://docs.veeder.com/gold/download.cfm?doc_id=12138
- Gilbarco – Warranties: https://www.gilbarco.com/eu/support/warranties
- Total Environmental Concepts – Gilbarco Veeder-Root ASC: https://totalenvironmental.net/gilbarco-veeder-root-authorized-service-contractor-asc/
- SJ Civil – Proposal terms and conditions: https://sjcivil.com/proposal-terms-conditions/
- NJ Treasury – Aboveground fuel tank installation RFP: https://www.nj.gov/treasury/purchase/noa/attachments/t0849-rfp.pdf
- Perlo – Change proposals and change orders: https://perlo.biz/construction-terms-change-proposals-and-change-orders/
- Procore – Contractor's guide to AIA billing (G702/G703): https://www.procore.com/library/aia-billing
- ABB – 2025 standard field service rate sheet: https://library.e.abb.com/public/e724f58241b24ac68bca00d53d347172/2025_upstreamoil%26gas_standard%20field%20service%20rate%20sheet.pdf
- All World Machinery – Service rates and conditions: https://www.allworldmachinery.com/customer/docs/Service_Rates_and_Conditions.pdf
- Miller Environmental – Emergency response rate sheet: https://legistarweb-production.s3.amazonaws.com/uploads/attachment/pdf/263135/2018_Spill_Response_Rate_Sheet.pdf
- Microsoft Learn – Dynamics 365 inventory journals: https://learn.microsoft.com/en-us/dynamics365/supply-chain/inventory/inventory-journals
- Microsoft Learn – Dynamics 365 Field Service inventory, purchasing, returns: https://learn.microsoft.com/en-us/dynamics365/field-service/inventory-purchasing-returns-overview
- Oracle JD Edwards – Understanding inventory transactions: https://docs.oracle.com/en/applications/jd-edwards/supply-chain-manufacturing/9.2/eoaim/understanding-inventory-transactions.html
- OPW – 1-2100-EVR thread-on spill containers: https://www.opwglobal.com/products/us/retail-fueling-products/underground-storage-tank-equipment/spill-containers/1-2100-evr-series-thread-on-spill-containers
- OPW/Fibrelite – Tank sump systems: https://www.opwglobal.com/docs/libraries/retail-fueling/product-catalogs/below-ground/piping-and-containment-equipment/fibrelite-tank-sump-systems.pdf
- Franklin Fueling – Entry boots/seals: https://www.franklinfueling.com/en/franklin-fueling-systems/products/piping--containment/entry-bootsseals/
- Franklin Fueling – 4" STP accessories & parts: https://www.franklinfueling.com/en/products/submersible-pumping/4-submersible-pumps/4-stp-accessories--parts/
- John W. Kennedy – Tank gauging probes: https://www.johnwkennedyco.com/catalog/shop/Fuel-Management-Systems/Tank-Gauging/Probes/dept-2YJ?a=1
- Freedom Electronics – Veeder-Root 847390-109 Mag probe: https://freedomelectronics.com/product/847390-109-10-foot-mag-probe-0-1-gph-for-tls-300-350-350plus-450-450plus
- Global Fueling Systems – Veeder-Root parts: https://globalfuelingsystems.com/brands/veeder-root/parts/
- Petroleum Equipment Institute: https://pei.org/
