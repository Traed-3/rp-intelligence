-- ============================================================
-- Quote templates — reusable starting points for the REV19 quote
-- builder (FL100 Replacements, Entry Boot Replacements, Product Line
-- Replacements, Tank Top/Dispenser Pad Remodel, Dispenser Replacement,
-- Tank Top Replacement, Spill Bucket Replacement, Compliance Failure
-- Repairs, Drop Tube Replacements, and whatever gets added later).
--
-- A template pre-fills the SCOPE|DESCRIPTION rows and a checklist of
-- category line placeholders (description + category only — no price
-- or quantity, so nothing goes stale; the real quote picks the actual
-- part and price from the catalog as usual via rowsFromLines()).
--
-- notes_by_brand carries the small per-customer differences Trae
-- described (e.g. Sunoco: RPS removes the hydro-testing water; 7-Eleven:
-- their own environmental company removes the DOT barrels) — a map of
-- brand name -> note text, shown when that brand's quote starts from
-- this template.
-- ============================================================

CREATE TABLE IF NOT EXISTS con_quote_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  name           text NOT NULL,
  category       text,
  description    text,
  department     text DEFAULT 'construction' CHECK (department IN ('construction','service')),
  scope_rows     jsonb DEFAULT '[]'::jsonb,
  lines          jsonb DEFAULT '[]'::jsonb,
  exclusions     text,
  warranty_line  text,
  notes_by_brand jsonb DEFAULT '{}'::jsonb,
  is_active      boolean DEFAULT true,
  sort_order     integer DEFAULT 0,
  created_by     uuid REFERENCES profiles ON DELETE SET NULL,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS con_quote_templates_company_idx ON con_quote_templates (company_id);

DROP TRIGGER IF EXISTS con_quote_templates_updated_at ON con_quote_templates;
CREATE TRIGGER con_quote_templates_updated_at BEFORE UPDATE ON con_quote_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE con_quote_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS con_quote_templates_read  ON con_quote_templates;
DROP POLICY IF EXISTS con_quote_templates_write ON con_quote_templates;
CREATE POLICY con_quote_templates_read ON con_quote_templates FOR SELECT TO authenticated
  USING (company_id = con_user_company_id() AND con_can_read());
CREATE POLICY con_quote_templates_write ON con_quote_templates FOR ALL TO authenticated
  USING (company_id = con_user_company_id() AND con_can_write())
  WITH CHECK (company_id = con_user_company_id() AND con_can_write());
