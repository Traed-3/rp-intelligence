-- ============================================================
-- BILLING + INVENTORY MODULE  (Phase 0 schema)
-- Shared by Construction and Service. Adds:
--   * customers/rate cards (per-brand labor + trip rates)
--   * parts catalog (price book)  ⊃  stocked parts
--   * stock locations (Office, one per truck, Vendor-RMA, Jobsite)
--   * append-only inventory ledger (on-hand is derived, never edited)
--   * service tickets with tech + customer signatures
--   * department tag on existing con_quotes / con_invoices so the
--     existing Construction quote/invoice tables serve Service too
-- Run in Supabase SQL editor. Idempotent (IF NOT EXISTS everywhere).
-- ============================================================

-- ------------------------------------------------------------
-- 0. Department tag on the existing billing documents
-- ------------------------------------------------------------
ALTER TABLE con_quotes   ADD COLUMN IF NOT EXISTS department text NOT NULL DEFAULT 'construction'
  CHECK (department IN ('construction','service'));
ALTER TABLE con_invoices ADD COLUMN IF NOT EXISTS department text NOT NULL DEFAULT 'construction'
  CHECK (department IN ('construction','service'));
ALTER TABLE con_quotes   ADD COLUMN IF NOT EXISTS valid_until date;
ALTER TABLE con_quotes   ADD COLUMN IF NOT EXISTS nte_amount numeric;          -- portal not-to-exceed
ALTER TABLE con_quotes   ADD COLUMN IF NOT EXISTS portal_wo_number text;       -- ServiceChannel / Corrigo WO
ALTER TABLE con_invoices ADD COLUMN IF NOT EXISTS portal_wo_number text;
ALTER TABLE con_invoices ADD COLUMN IF NOT EXISTS service_ticket_id uuid;      -- FK added after table exists
ALTER TABLE con_quote_line_items   ADD COLUMN IF NOT EXISTS part_id uuid;
ALTER TABLE con_invoice_line_items ADD COLUMN IF NOT EXISTS part_id uuid;
ALTER TABLE con_invoice_line_items ADD COLUMN IF NOT EXISTS charge_type text DEFAULT 'billable'
  CHECK (charge_type IN ('billable','no_charge','warranty','contract','callback'));

-- ------------------------------------------------------------
-- 1. Customer rate cards  (the four RPS labor rates + trip rules)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_rate_cards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  name            text NOT NULL,                 -- '7-Eleven', 'Global', 'Sunoco', 'Independent'
  labor_rate      numeric NOT NULL,              -- $/hr straight time
  overtime_rate   numeric,                       -- $/hr, null = 1.5x
  trip_rate       numeric,                       -- $ per trip-hour or flat, see trip_mode
  trip_mode       text DEFAULT 'per_hour' CHECK (trip_mode IN ('per_hour','flat','none')),
  material_markup numeric DEFAULT 0.20,          -- decimal, 20% flat per RPS rule
  sub_markup      numeric DEFAULT 0.15,
  sales_tax_pct   numeric DEFAULT 0,             -- material-only, by site state
  terms_days      integer DEFAULT 30,
  active          boolean DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (company_id, name)
);
ALTER TABLE billing_rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_customers ADD COLUMN IF NOT EXISTS rate_card_id uuid REFERENCES billing_rate_cards ON DELETE SET NULL;
ALTER TABLE con_customers ADD COLUMN IF NOT EXISTS brand text;   -- '7-Eleven','Sunoco','Wawa','Sheetz','Global','Independent'

-- ------------------------------------------------------------
-- 2. Parts catalog (price book).  Anything quotable lives here:
--    parts, consumables, labor SKUs, trip charge, test services.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  sku               text,                          -- RPS internal, optional
  part_number       text,                          -- manufacturer / vendor part #
  manufacturer      text,                          -- OPW, Veeder-Root, Franklin, Icon, ...
  description       text NOT NULL,
  category          integer,                       -- REV19 category 1..12
  category_name     text,
  subcategory       text,
  uom               text DEFAULT 'EA',             -- EA, FT, BOX, PAIL, CY, DAY, HR
  item_type         text DEFAULT 'material'
                    CHECK (item_type IN ('material','labor','trip','equipment','disposables','sub','permit','service','lodging')),
  taxable           boolean DEFAULT true,          -- cats 1-4 taxable per RPS rule
  is_stocked        boolean DEFAULT false,         -- true = tracked in inventory
  is_serialized     boolean DEFAULT false,
  unit_cost         numeric,                       -- RPS cost (receipt / vendor quote / book)
  cost_source       text,                          -- 'receipt' | 'vendor_quote' | 'book' | 'web' | 'estimate' | 'rate_card'
  cost_vendor       text,
  cost_invoice_ref  text,
  cost_date         date,
  price_status      text DEFAULT 'ok' CHECK (price_status IN ('ok','price_needed','verify','held_high')),
  freight_per_unit  numeric DEFAULT 0,
  markup_pct        numeric,                       -- null = use rate card material_markup
  sell_price        numeric,                       -- explicit sell (service tickets); null = computed
  last_cost         numeric,                       -- updated on RECEIVE
  avg_cost          numeric,                       -- updated on RECEIVE
  min_qty           numeric,                       -- office reorder point (per-location overrides below)
  max_qty           numeric,
  primary_vendor    text,
  superseded_by     uuid REFERENCES parts ON DELETE SET NULL,
  notes             text,
  active            boolean DEFAULT true,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parts_company_idx     ON parts (company_id);
CREATE INDEX IF NOT EXISTS parts_part_number_idx ON parts (company_id, part_number);
CREATE INDEX IF NOT EXISTS parts_category_idx    ON parts (company_id, category);
CREATE INDEX IF NOT EXISTS parts_desc_trgm_idx   ON parts USING gin (to_tsvector('simple', coalesce(part_number,'') || ' ' || description));
DROP TRIGGER IF EXISTS parts_updated_at ON parts;
CREATE TRIGGER parts_updated_at BEFORE UPDATE ON parts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;

-- Every price we have ever seen for a part (receipts, vendor quotes, web, billed sell).
CREATE TABLE IF NOT EXISTS part_price_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id      uuid NOT NULL REFERENCES parts ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('cost_receipt','cost_vendor_quote','cost_book','cost_web','sell_billed')),
  price        numeric NOT NULL,
  vendor       text,
  reference    text,          -- invoice #, quote #, or RPS invoice file
  observed_on  date,
  source_note  text,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS part_price_history_part_idx ON part_price_history (part_id, observed_on DESC);
ALTER TABLE part_price_history ENABLE ROW LEVEL SECURITY;

-- Pre-built assemblies (dispenser electrical kit, STP termination kit, ...)
CREATE TABLE IF NOT EXISTS part_assemblies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_id   uuid NOT NULL REFERENCES parts ON DELETE CASCADE,   -- the kit itself is a part
  component_id  uuid NOT NULL REFERENCES parts ON DELETE CASCADE,
  quantity      numeric NOT NULL DEFAULT 1,
  UNIQUE (assembly_id, component_id)
);
ALTER TABLE part_assemblies ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 3. Stock locations.  A truck is a location (linked to the asset), not a person.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_locations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  name           text NOT NULL,                   -- 'Office / Hill', 'Truck 32346', 'Vendor RMA'
  kind           text NOT NULL CHECK (kind IN ('office','truck','jobsite','vendor_rma','customer_owned')),
  asset_id       uuid REFERENCES assets ON DELETE SET NULL,      -- truck number lives on assets
  assigned_tech  uuid REFERENCES profiles ON DELETE SET NULL,
  technician_id  uuid REFERENCES svc_technicians ON DELETE SET NULL,   -- Service Dispatch tech roster
  department     text CHECK (department IN ('construction','service','shared')) DEFAULT 'shared',
  active         boolean DEFAULT true,
  created_at     timestamptz DEFAULT now(),
  UNIQUE (company_id, name)
);
ALTER TABLE stock_locations ENABLE ROW LEVEL SECURITY;

-- Per-location min/max (truck stock templates)
CREATE TABLE IF NOT EXISTS stock_levels (
  location_id  uuid NOT NULL REFERENCES stock_locations ON DELETE CASCADE,
  part_id      uuid NOT NULL REFERENCES parts ON DELETE CASCADE,
  min_qty      numeric DEFAULT 0,
  max_qty      numeric DEFAULT 0,
  bin          text,
  PRIMARY KEY (location_id, part_id)
);
ALTER TABLE stock_levels ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 4. Inventory ledger — APPEND ONLY. On-hand = SUM(qty) per location/part.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  txn_type         text NOT NULL CHECK (txn_type IN
                     ('receive','issue_to_ticket','return_from_ticket','transfer_out','transfer_in',
                      'adjust','count','warranty_return','scrap')),
  part_id          uuid NOT NULL REFERENCES parts ON DELETE RESTRICT,
  location_id      uuid NOT NULL REFERENCES stock_locations ON DELETE RESTRICT,
  qty              numeric NOT NULL,              -- signed: + into location, - out of location
  unit_cost        numeric,
  transfer_group   uuid,                          -- pairs transfer_out / transfer_in legs
  ref_type         text,                          -- 'service_ticket' | 'con_job' | 'purchase' | 'packing_slip' | 'count'
  ref_id           uuid,
  ref_label        text,                          -- vendor invoice #, packing slip #, ticket #
  serial_number    text,
  note             text,
  created_by       uuid REFERENCES profiles ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inv_txn_part_loc_idx ON inventory_transactions (part_id, location_id);
CREATE INDEX IF NOT EXISTS inv_txn_ref_idx      ON inventory_transactions (ref_type, ref_id);
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW stock_on_hand AS
  SELECT t.company_id, t.location_id, l.name AS location_name, l.kind AS location_kind,
         t.part_id, p.part_number, p.description,
         SUM(t.qty) AS on_hand,
         sl.min_qty, sl.max_qty,
         (SUM(t.qty) < COALESCE(sl.min_qty, 0)) AS below_min
  FROM inventory_transactions t
  JOIN stock_locations l ON l.id = t.location_id
  JOIN parts p ON p.id = t.part_id
  LEFT JOIN stock_levels sl ON sl.location_id = t.location_id AND sl.part_id = t.part_id
  GROUP BY t.company_id, t.location_id, l.name, l.kind, t.part_id, p.part_number, p.description, sl.min_qty, sl.max_qty;

-- Pending transfers header (two-legged: pending -> picked -> received)
CREATE TABLE IF NOT EXISTS stock_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  from_location   uuid NOT NULL REFERENCES stock_locations,
  to_location     uuid NOT NULL REFERENCES stock_locations,
  status          text DEFAULT 'pending' CHECK (status IN ('pending','picked','received','cancelled')),
  requested_by    uuid REFERENCES profiles ON DELETE SET NULL,
  received_by     uuid REFERENCES profiles ON DELETE SET NULL,
  note            text,
  created_at      timestamptz DEFAULT now(),
  received_at     timestamptz
);
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS stock_transfer_lines (
  transfer_id  uuid NOT NULL REFERENCES stock_transfers ON DELETE CASCADE,
  part_id      uuid NOT NULL REFERENCES parts,
  qty          numeric NOT NULL,
  PRIMARY KEY (transfer_id, part_id)
);
ALTER TABLE stock_transfer_lines ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 5. Service tickets (the field document techs sign on a phone)
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS service_ticket_seq START 5000;
CREATE TABLE IF NOT EXISTS service_tickets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  ticket_number       text NOT NULL DEFAULT ('ST-' || nextval('service_ticket_seq')),
  department          text NOT NULL DEFAULT 'service' CHECK (department IN ('construction','service')),
  customer_id         uuid REFERENCES con_customers ON DELETE SET NULL,
  site_id             uuid REFERENCES con_sites ON DELETE SET NULL,
  job_id              uuid REFERENCES con_jobs ON DELETE SET NULL,
  quote_id            uuid REFERENCES con_quotes ON DELETE SET NULL,
  work_order_id       uuid REFERENCES svc_work_orders ON DELETE SET NULL,   -- portal dispatch (7help / Wawa / Sunoco)
  technician_id       uuid REFERENCES svc_technicians ON DELETE SET NULL,
  store_number        text,                       -- '41617', 'SU-11904'
  csr_number          text,                       -- 'WOT1211757', '(80013292)'
  po_number           text,
  portal_wo_number    text,
  brand               text,
  site_address        text,
  city_state_zip      text,
  problem_reported    text,
  work_performed      text,                       -- becomes the invoice PROJECT DESCRIPTION
  status              text DEFAULT 'open' CHECK (status IN ('open','dispatched','on_site','complete','signed','invoiced','void')),
  needs_quote         boolean DEFAULT false,      -- work exceeds NTE / needs proposal
  charge_type         text DEFAULT 'billable' CHECK (charge_type IN ('billable','no_charge','warranty','contract','callback')),
  truck_location_id   uuid REFERENCES stock_locations ON DELETE SET NULL,   -- which truck's stock was used
  tech_signature_url  text,  tech_signed_by uuid REFERENCES profiles, tech_signed_at timestamptz,
  site_signature_url  text,  site_signer_name text, site_signer_title text, site_signed_at timestamptz,
  gmail_thread_id     text,
  created_by          uuid REFERENCES profiles ON DELETE SET NULL,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  UNIQUE (company_id, ticket_number)
);
DROP TRIGGER IF EXISTS service_tickets_updated_at ON service_tickets;
CREATE TRIGGER service_tickets_updated_at BEFORE UPDATE ON service_tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE service_tickets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='con_invoices_service_ticket_fk') THEN
    ALTER TABLE con_invoices ADD CONSTRAINT con_invoices_service_ticket_fk
      FOREIGN KEY (service_ticket_id) REFERENCES service_tickets ON DELETE SET NULL;
  END IF;
END $$;

-- Labor per tech per day (mirrors the invoice "Labor 9/11/26" + "Trip" rows)
CREATE TABLE IF NOT EXISTS service_ticket_labor (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    uuid NOT NULL REFERENCES service_tickets ON DELETE CASCADE,
  tech_id      uuid REFERENCES profiles ON DELETE SET NULL,
  work_date    date NOT NULL,
  kind         text NOT NULL DEFAULT 'labor' CHECK (kind IN ('labor','trip','overtime')),
  hours        numeric NOT NULL,
  rate_applied numeric,                            -- filled from rate card at invoice time
  note         text
);
ALTER TABLE service_ticket_labor ENABLE ROW LEVEL SECURITY;

-- Parts used / returned on the ticket (drives inventory issue/return)
CREATE TABLE IF NOT EXISTS service_ticket_parts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     uuid NOT NULL REFERENCES service_tickets ON DELETE CASCADE,
  part_id       uuid REFERENCES parts ON DELETE SET NULL,
  description   text NOT NULL,                     -- free text allowed when part not in catalog
  quantity      numeric NOT NULL DEFAULT 1,
  unit_cost     numeric,
  sell_price    numeric,
  charge_type   text DEFAULT 'billable' CHECK (charge_type IN ('billable','no_charge','warranty','contract')),
  from_location uuid REFERENCES stock_locations ON DELETE SET NULL,
  returned_qty  numeric DEFAULT 0,
  serial_number text,
  is_stock      boolean DEFAULT false
);
ALTER TABLE service_ticket_parts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS service_ticket_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES service_tickets ON DELETE CASCADE,
  url         text NOT NULL,
  kind        text DEFAULT 'after' CHECK (kind IN ('before','after','nameplate','test','packing_slip','other')),
  caption     text,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE service_ticket_photos ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 6. RLS — same company-scoped pattern as the rest of the app
-- ------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_rate_cards','parts','stock_locations','inventory_transactions',
                           'stock_transfers','service_tickets']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s company read"  ON %1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s company write" ON %1$s', t);
    EXECUTE format('CREATE POLICY "%1$s company read"  ON %1$s FOR SELECT TO authenticated USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()))', t);
    EXECUTE format('CREATE POLICY "%1$s company write" ON %1$s FOR ALL    TO authenticated USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())) WITH CHECK (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()))', t);
  END LOOP;
END $$;
-- child tables: scope through parent
DROP POLICY IF EXISTS "part_price_history via part" ON part_price_history;
CREATE POLICY "part_price_history via part" ON part_price_history FOR ALL TO authenticated
  USING (part_id IN (SELECT id FROM parts WHERE company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())));
DROP POLICY IF EXISTS "part_assemblies via part" ON part_assemblies;
CREATE POLICY "part_assemblies via part" ON part_assemblies FOR ALL TO authenticated
  USING (assembly_id IN (SELECT id FROM parts WHERE company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())));
DROP POLICY IF EXISTS "stock_levels via location" ON stock_levels;
CREATE POLICY "stock_levels via location" ON stock_levels FOR ALL TO authenticated
  USING (location_id IN (SELECT id FROM stock_locations WHERE company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())));
DROP POLICY IF EXISTS "stock_transfer_lines via transfer" ON stock_transfer_lines;
CREATE POLICY "stock_transfer_lines via transfer" ON stock_transfer_lines FOR ALL TO authenticated
  USING (transfer_id IN (SELECT id FROM stock_transfers WHERE company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())));
DROP POLICY IF EXISTS "service_ticket_labor via ticket" ON service_ticket_labor;
CREATE POLICY "service_ticket_labor via ticket" ON service_ticket_labor FOR ALL TO authenticated
  USING (ticket_id IN (SELECT id FROM service_tickets WHERE company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())));
DROP POLICY IF EXISTS "service_ticket_parts via ticket" ON service_ticket_parts;
CREATE POLICY "service_ticket_parts via ticket" ON service_ticket_parts FOR ALL TO authenticated
  USING (ticket_id IN (SELECT id FROM service_tickets WHERE company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())));
DROP POLICY IF EXISTS "service_ticket_photos via ticket" ON service_ticket_photos;
CREATE POLICY "service_ticket_photos via ticket" ON service_ticket_photos FOR ALL TO authenticated
  USING (ticket_id IN (SELECT id FROM service_tickets WHERE company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())));

-- ------------------------------------------------------------
-- 7. Seed: the four RPS rate cards + office location
-- ------------------------------------------------------------
INSERT INTO billing_rate_cards (company_id, name, labor_rate, trip_mode, trip_rate)
SELECT c.id, v.name, v.rate, 'per_hour', v.rate
FROM companies c, (VALUES ('7-Eleven',78.50),('Global',82.50),('Sunoco',80.00),('Independent',95.00)) AS v(name,rate)
WHERE c.id = (SELECT id FROM companies ORDER BY created_at LIMIT 1)
ON CONFLICT (company_id, name) DO NOTHING;

INSERT INTO stock_locations (company_id, name, kind, department)
SELECT c.id, v.name, v.kind, v.dept FROM companies c,
  (VALUES ('Office / Hill','office','shared'),('Construction Shelf','office','construction'),('Vendor RMA','vendor_rma','shared')) AS v(name,kind,dept)
WHERE c.id = (SELECT id FROM companies ORDER BY created_at LIMIT 1)
ON CONFLICT (company_id, name) DO NOTHING;

-- One stock location per live truck / van, linked to the asset so the truck number is the location name.
INSERT INTO stock_locations (company_id, name, kind, asset_id, department)
SELECT a.company_id, 'Truck ' || a.unit_number, 'truck', a.id,
       CASE WHEN t.name ILIKE '%construction%' THEN 'construction' WHEN t.name ILIKE '%service%' THEN 'service' ELSE 'shared' END
FROM assets a JOIN asset_types t ON t.id = a.asset_type_id
WHERE t.name IN ('Service Truck','Construction Truck','Pickup Truck')
  AND a.status IN ('active','available','in_shop','down')
ON CONFLICT (company_id, name) DO NOTHING;

-- ------------------------------------------------------------
-- 8. (Phase 2, applied 2026-09-15) quote/invoice lines link to catalog parts
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='con_quote_line_items_part_fk') THEN
    ALTER TABLE con_quote_line_items ADD CONSTRAINT con_quote_line_items_part_fk FOREIGN KEY (part_id) REFERENCES parts ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='con_invoice_line_items_part_fk') THEN
    ALTER TABLE con_invoice_line_items ADD CONSTRAINT con_invoice_line_items_part_fk FOREIGN KEY (part_id) REFERENCES parts ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS con_quote_line_items_part_idx ON con_quote_line_items (part_id);
CREATE INDEX IF NOT EXISTS con_invoice_line_items_part_idx ON con_invoice_line_items (part_id);
