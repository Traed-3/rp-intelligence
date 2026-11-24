-- ============================================================
-- BILLING MODULE — REV19 quotes and invoices, shared by Construction
-- and Service. Quotes/invoices leave the Construction module and live
-- at /billing. The tables keep their con_* names (371 historical
-- invoices + service-ticket conversion depend on them); every line now
-- carries its REV19 category (1–12) and the inputs that category needs.
-- Idempotent.
-- ============================================================

-- ── line items: category + REV19 inputs ──────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['con_quote_line_items','con_invoice_line_items'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS category smallint CHECK (category BETWEEN 1 AND 12)', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS subcategory text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS part_number text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS sales_tax_pct numeric', t);      -- cats 1–4: tax on cost, recovered through markup
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS markup_pct numeric', t);         -- cats 1–4 material markup, cat 11 sub markup
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS freight_per_unit numeric', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS markup_applies boolean DEFAULT false', t);  -- cats 5,9,10,12: MARKUP? Y/N
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS sell_unit numeric', t);          -- computed sell per unit
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS men numeric', t);                -- cat 7
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS hrs_each numeric', t);           -- cat 7
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS travel_days numeric', t);        -- cat 8
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS techs numeric', t);              -- cat 8
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS day_label text', t);             -- cat 7 (DAY 1, 9/16/26), cat 8 (WEEK 1)
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS crew text', t);                  -- cat 7/8: construction | service
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS source_note text', t);           -- WHERE THE PRICE CAME FROM
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS price_flag text', t);            -- ok | estimate | price_needed | held_high | verify
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS sort_order integer', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (category)', t || '_category_idx', t);
  END LOOP;
END $$;

-- Backfill category from the old item_type on lines that predate categories.
UPDATE con_quote_line_items SET category = CASE item_type
  WHEN 'labor' THEN 7 WHEN 'trip' THEN 8 WHEN 'equipment' THEN 9 WHEN 'disposables' THEN 10
  WHEN 'sub' THEN 11 WHEN 'permit' THEN 12 WHEN 'lodging' THEN 6 WHEN 'service' THEN 11 ELSE 4 END
WHERE category IS NULL;
UPDATE con_invoice_line_items SET category = CASE item_type
  WHEN 'labor' THEN 7 WHEN 'trip' THEN 8 WHEN 'equipment' THEN 9 WHEN 'disposables' THEN 10
  WHEN 'sub' THEN 11 WHEN 'permit' THEN 12 WHEN 'lodging' THEN 6 WHEN 'service' THEN 11 ELSE 4 END
WHERE category IS NULL;

-- ── document headers: REV19 INPUTS block + header block + roll-ups ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['con_quotes','con_invoices'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS site_number text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS bid_due date', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS project_manager text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS construction_manager text DEFAULT ''Starsky Dodson''', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS foreman text DEFAULT ''Ernie Lewis''', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS compiled_by text DEFAULT ''Trae Dodson''', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS material_markup_pct numeric DEFAULT 0.20', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS material_tax_pct numeric DEFAULT 0.053', t);   -- tax paid on cost, cats 1–4
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS sub_markup_pct numeric DEFAULT 0.15', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS labor_rate numeric', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS rate_card_id uuid REFERENCES billing_rate_cards ON DELETE SET NULL', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS contingency_pct numeric DEFAULT 0', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS contingency_flat numeric DEFAULT 0', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS contingency_amount numeric DEFAULT 0', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS scope_rows jsonb DEFAULT ''[]''::jsonb', t);      -- [{scope, description}]
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS exclusions text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS warranty_line text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS category_totals jsonb DEFAULT ''{}''::jsonb', t);  -- {"1": 123.45, ...}
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS taxable_material_total numeric DEFAULT 0', t);   -- 1+2+3+4
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS concrete_equipment_total numeric DEFAULT 0', t); -- 5+9+10+11+12
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS labor_mobilization_total numeric DEFAULT 0', t); -- 6+7+8
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS is_starting_quote boolean DEFAULT true', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS work_order_number text', t);
  END LOOP;
END $$;

-- Quotes can now also be "change_order" — an ADDITIONAL SCOPE OF WORK block on an existing quote.
ALTER TABLE con_quotes ADD COLUMN IF NOT EXISTS parent_quote_id uuid REFERENCES con_quotes ON DELETE SET NULL;
ALTER TABLE con_quotes ADD COLUMN IF NOT EXISTS kind text DEFAULT 'quote' CHECK (kind IN ('quote','change_order'));

-- Standard REV19 rate lines live in the catalog so the builder can pick them.
-- Idempotent on (company, sku, part_number/description).
INSERT INTO parts (company_id, sku, part_number, description, category, category_name, subcategory, item_type, taxable, unit_cost, cost_source, cost_date, price_status, freight_per_unit, notes)
SELECT c.id, 'REV19_RATE_CARD', v.pn, v.descr, v.cat, v.catname, v.sub, v.it, false, v.cost, 'rate_card', '2026-09-15', 'ok', 0, 'REV19 rate card'
FROM companies c, (VALUES
  ('LODGING-ROOM',      'HOTEL ROOM, 2 TECHS PER ROOM - PER ROOM PER NIGHT',      6, 'HOTEL LODGING / PER DIEM', 'Lodging',      'lodging',     225.00),
  ('PER-DIEM',          'PER DIEM - MEALS - PER MAN PER NIGHT',                    6, 'HOTEL LODGING / PER DIEM', 'Per diem',     'lodging',     50.00),
  ('LODGING-COMBINED',  'LODGING / PER DIEM COMBINED - PER TECH PER NIGHT',        6, 'HOTEL LODGING / PER DIEM', 'Combined',     'lodging',     104.79),
  ('MOBILIZATION',      'TRIP CHARGE / MOBILIZATION - PER TECH PER TRAVEL DAY',    8, 'TRIP CHARGES / MOBILIZATION', 'Mobilization', 'trip',     100.00),
  ('DISPOSABLES-DAY',   'PPE AND DAILY DISPOSABLES - PER TECH PER DAY',            10,'MISC / DISPOSABLES / DOT BARRELS', 'Disposables', 'disposables', 13.20),
  ('DISPOSABLES-SVC',   'SERVICE DISPOSABLES - PER TECH PER DAY',                  10,'MISC / DISPOSABLES / DOT BARRELS', 'Disposables', 'disposables', 17.50),
  ('PERMIT-TRADE',      'COUNTY OR CITY TRADE PERMIT - ACTUAL FEE',                12,'TRADE PERMITS AND ONSITE INSPECTIONS', 'Permits', 'permit', NULL),
  ('INSPECTION-FEE',    'ONSITE INSPECTION FEE - ACTUAL FEE',                      12,'TRADE PERMITS AND ONSITE INSPECTIONS', 'Inspections', 'permit', NULL)
) AS v(pn, descr, cat, catname, sub, it, cost)
WHERE c.id = (SELECT id FROM companies ORDER BY created_at LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM parts p WHERE p.company_id = c.id AND p.part_number = v.pn AND p.sku = 'REV19_RATE_CARD');

-- Header fields that only one of the two tables had.
ALTER TABLE con_quotes ADD COLUMN IF NOT EXISTS csr_number text;
ALTER TABLE con_quotes ADD COLUMN IF NOT EXISTS po_number text;
ALTER TABLE con_invoices ADD COLUMN IF NOT EXISTS customer_email text;
ALTER TABLE con_invoices ADD COLUMN IF NOT EXISTS valid_until date;
ALTER TABLE con_invoices ADD COLUMN IF NOT EXISTS nte_amount numeric;

-- ── Signer is chosen per document (2026-09-18) ─────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS job_title text;
ALTER TABLE con_quotes   ALTER COLUMN prepared_by DROP DEFAULT;
ALTER TABLE con_invoices ALTER COLUMN prepared_by DROP DEFAULT;
ALTER TABLE con_quotes   ALTER COLUMN construction_manager DROP DEFAULT;
ALTER TABLE con_invoices ALTER COLUMN construction_manager DROP DEFAULT;
ALTER TABLE con_quotes   ALTER COLUMN foreman DROP DEFAULT;
ALTER TABLE con_invoices ALTER COLUMN foreman DROP DEFAULT;
ALTER TABLE con_quotes   ALTER COLUMN compiled_by DROP DEFAULT;
ALTER TABLE con_invoices ALTER COLUMN compiled_by DROP DEFAULT;
ALTER TABLE con_quotes   ADD COLUMN IF NOT EXISTS signer_id uuid REFERENCES profiles ON DELETE SET NULL;
ALTER TABLE con_invoices ADD COLUMN IF NOT EXISTS signer_id uuid REFERENCES profiles ON DELETE SET NULL;
