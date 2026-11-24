-- Field surveys recorded in the app from the phone, starting with ICON's Sump Survey Worksheet (fittings, tank-sump lid,
-- structural damage). One survey per site visit; one row per sump; photos tied to the sump (and optionally to one entry).
-- (Applied to the live project 2026-10-01; kept here as the record.)
CREATE TABLE IF NOT EXISTS con_surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE, job_id uuid REFERENCES con_jobs ON DELETE SET NULL,
  survey_type text NOT NULL DEFAULT 'icon_sump' CHECK (survey_type IN ('icon_sump')), site_number text, site_name text, address text,
  survey_date date NOT NULL DEFAULT current_date, tech_name text, tech_phone text, tech_email text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','complete','sent')), notes text, pdf_document_id uuid REFERENCES con_documents ON DELETE SET NULL,
  sent_to text, sent_at timestamptz, created_by uuid REFERENCES profiles ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS con_surveys_company_idx ON con_surveys (company_id, status, survey_date);
CREATE INDEX IF NOT EXISTS con_surveys_job_idx ON con_surveys (job_id);
CREATE TABLE IF NOT EXISTS con_survey_sumps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE, survey_id uuid NOT NULL REFERENCES con_surveys ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 1, sump_label text NOT NULL, location text CHECK (location IN ('tank','disp')), material text CHECK (material IN ('poly','fiberglass')),
  profile text CHECK (profile IN ('flat','curved')), active_leak boolean, worksheets text[] NOT NULL DEFAULT '{fittings}',
  entries jsonb NOT NULL DEFAULT '[]'::jsonb, lid jsonb, damage text, notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS con_survey_sumps_survey_idx ON con_survey_sumps (survey_id, sort_order);
CREATE TABLE IF NOT EXISTS con_survey_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies ON DELETE CASCADE, survey_id uuid NOT NULL REFERENCES con_surveys ON DELETE CASCADE,
  sump_id uuid REFERENCES con_survey_sumps ON DELETE CASCADE, storage_path text NOT NULL, file_name text, caption text, entry_ref text, sort_order integer NOT NULL DEFAULT 1,
  taken_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS con_survey_photos_survey_idx ON con_survey_photos (survey_id, sump_id, sort_order);
ALTER TABLE con_surveys ENABLE ROW LEVEL SECURITY; ALTER TABLE con_survey_sumps ENABLE ROW LEVEL SECURITY; ALTER TABLE con_survey_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS con_surveys_read ON con_surveys;  CREATE POLICY con_surveys_read ON con_surveys FOR SELECT USING (company_id = con_user_company_id() AND con_can_read());
DROP POLICY IF EXISTS con_surveys_write ON con_surveys; CREATE POLICY con_surveys_write ON con_surveys FOR ALL USING (company_id = con_user_company_id() AND con_can_write());
DROP POLICY IF EXISTS con_survey_sumps_read ON con_survey_sumps;  CREATE POLICY con_survey_sumps_read ON con_survey_sumps FOR SELECT USING (company_id = con_user_company_id() AND con_can_read());
DROP POLICY IF EXISTS con_survey_sumps_write ON con_survey_sumps; CREATE POLICY con_survey_sumps_write ON con_survey_sumps FOR ALL USING (company_id = con_user_company_id() AND con_can_write());
DROP POLICY IF EXISTS con_survey_photos_read ON con_survey_photos;  CREATE POLICY con_survey_photos_read ON con_survey_photos FOR SELECT USING (company_id = con_user_company_id() AND con_can_read());
DROP POLICY IF EXISTS con_survey_photos_write ON con_survey_photos; CREATE POLICY con_survey_photos_write ON con_survey_photos FOR ALL USING (company_id = con_user_company_id() AND con_can_write());
