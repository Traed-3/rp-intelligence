-- Survey types: ICON Fittings Survey first (renamed from icon_sump); Spill Bucket and Tank Top reserved (Trae 10/1/26).
ALTER TABLE con_surveys DROP CONSTRAINT IF EXISTS con_surveys_survey_type_check;
UPDATE con_surveys SET survey_type = 'icon_fittings' WHERE survey_type = 'icon_sump';
ALTER TABLE con_surveys ALTER COLUMN survey_type SET DEFAULT 'icon_fittings';
ALTER TABLE con_surveys ADD CONSTRAINT con_surveys_survey_type_check CHECK (survey_type IN ('icon_fittings','spill_bucket','tank_top'));
-- Sump identity as a pick, not a typed label: UDC 3/4, STP RUL, Other (vent / probe / transition).
ALTER TABLE con_survey_sumps
  ADD COLUMN IF NOT EXISTS sump_type text CHECK (sump_type IN ('udc','stp','other')),
  ADD COLUMN IF NOT EXISTS sump_number text;
UPDATE con_survey_sumps SET sump_type = CASE WHEN sump_label ILIKE 'Dispenser%' OR sump_label ILIKE 'UDC%' THEN 'udc' WHEN sump_label ILIKE '%STP%' THEN 'stp' ELSE 'other' END,
  sump_number = COALESCE(sump_number, NULLIF(regexp_replace(sump_label, '^(Dispenser|UDC|STP)\s*', '', 'i'), '')) WHERE sump_type IS NULL;
