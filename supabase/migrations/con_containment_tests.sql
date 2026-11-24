-- Sump / UDC / spill bucket integrity test reports filled on the phone at the site. One test per site visit, one row per
-- bucket or sump tested. The state (MD / VA / WV, from the site address) picks which agency form the PDF is printed on:
-- MD = MDE "Maryland Catchment Basin and Containment Sump Test Report"; VA = DEQ "Triennial UST Spill Bucket Integrity
-- Testing" + "Triennial UST Containment Sump / UDC Integrity Testing"; WV = WVDEP "Spill and Overfill Testing Report
-- Form" (section C) + "Miscellaneous Testing Report Form" (section C, sumps/UDC). Readings are text so units ride along.
CREATE TABLE IF NOT EXISTS con_containment_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  job_id uuid REFERENCES con_jobs ON DELETE SET NULL, site_id uuid REFERENCES con_sites ON DELETE SET NULL,
  state text NOT NULL CHECK (state IN ('MD','VA','WV')),
  site_number text, facility_name text, facility_id text, address text, city text, zip text, county text,
  facility_contact text, contact_phone text,
  owner_name text, owner_address text, owner_city text, owner_state text, owner_zip text, owner_phone text,
  test_date date NOT NULL DEFAULT current_date, weather text, temperature text,
  tester_name text, tester_cert text, tester_cert_type text, tester_phone text, tester_email text,
  method_by text, method_other text, test_equipment text, equipment_precision text, gauge_range text,
  reason text, reason_other text, sump_test_kind text NOT NULL DEFAULT 'full' CHECK (sump_test_kind IN ('full','low_level')),
  signature text, signed_at timestamptz, comments text, next_due date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','complete','sent')),
  pdf_document_id uuid REFERENCES con_documents ON DELETE SET NULL, pdf_path text, sent_to text, sent_at timestamptz,
  created_by uuid REFERENCES profiles ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS con_containment_tests_company_idx ON con_containment_tests (company_id, status, test_date);
CREATE INDEX IF NOT EXISTS con_containment_tests_job_idx ON con_containment_tests (job_id);

CREATE TABLE IF NOT EXISTS con_containment_test_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES con_containment_tests ON DELETE CASCADE, sort_order integer NOT NULL DEFAULT 1,
  kind text NOT NULL CHECK (kind IN ('spill_bucket','stage1_bucket','udc','stp','tank_top','transition','vent_riser','other')),
  label text, kind_other text, tank_size text, product text, manufacturer text,
  construction text CHECK (construction IN ('sw','dw')), install_type text CHECK (install_type IN ('direct','direct_liner','sump')),
  material text CHECK (material IN ('frp','plastic')), installed_after_2008 boolean,
  method text CHECK (method IN ('hydrostatic','vacuum','pressure','other')),
  debris_removed boolean, visual text CHECK (visual IN ('pass','fail')), riser_cap text CHECK (riser_cap IN ('yes','no','na')),
  drain_valve text CHECK (drain_valve IN ('yes','no','na')),
  depth text, penetration_height text, wait_minutes text,
  start_time text, start_reading text, end_time text, end_reading text, level_change text, threshold text,
  ist_start_time text, ist_start_reading text, ist_end_time text, ist_end_reading text,
  sensor_restored text CHECK (sensor_restored IN ('yes','no','na')), sensor_low boolean, sensor_alarmed boolean, sensor_shutoff text CHECK (sensor_shutoff IN ('yes','no','na')), alarm_level text,
  result text CHECK (result IN ('pass','fail')), failure_reported_at text, notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS con_containment_test_items_test_idx ON con_containment_test_items (test_id, sort_order);

ALTER TABLE con_containment_tests ENABLE ROW LEVEL SECURITY; ALTER TABLE con_containment_test_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS con_containment_tests_read ON con_containment_tests;  CREATE POLICY con_containment_tests_read ON con_containment_tests FOR SELECT USING (company_id = con_user_company_id() AND con_can_read());
DROP POLICY IF EXISTS con_containment_tests_write ON con_containment_tests; CREATE POLICY con_containment_tests_write ON con_containment_tests FOR ALL USING (company_id = con_user_company_id() AND con_can_write());
DROP POLICY IF EXISTS con_containment_test_items_read ON con_containment_test_items;  CREATE POLICY con_containment_test_items_read ON con_containment_test_items FOR SELECT USING (company_id = con_user_company_id() AND con_can_read());
DROP POLICY IF EXISTS con_containment_test_items_write ON con_containment_test_items; CREATE POLICY con_containment_test_items_write ON con_containment_test_items FOR ALL USING (company_id = con_user_company_id() AND con_can_write());
