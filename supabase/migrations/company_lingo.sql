-- ============================================================
-- Company lingo — the running list of RPS's own words and abbreviations
-- (RUL, MUL, PUL, ATG, STP, OS, RTN ...). The ticket reader is given this
-- list every time it reads a ticket so it can decipher the handwriting, and
-- anyone in the office can add to it (Service -> All tickets -> Words & lingo).
-- `misreads` = what the term has been mistaken for ("PVL, POL" for PUL).
-- ============================================================
CREATE TABLE IF NOT EXISTS company_lingo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  term        text NOT NULL,
  meaning     text,
  misreads    text,
  category    text NOT NULL DEFAULT 'general',
  note        text,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES profiles ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS company_lingo_term_idx ON company_lingo (company_id, lower(term));
ALTER TABLE company_lingo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS company_lingo_read ON company_lingo;
CREATE POLICY company_lingo_read ON company_lingo FOR SELECT TO authenticated USING (company_id = con_user_company_id());

INSERT INTO company_lingo (company_id, term, meaning, misreads, category)
SELECT c.id, v.term, v.meaning, v.misreads, v.category
FROM (SELECT id FROM companies ORDER BY created_at LIMIT 1) c,
(VALUES
  ('RUL',  'Regular unleaded',                                   NULL,      'fuel'),
  ('MUL',  'Midgrade unleaded',                                  'MVL, MID', 'fuel'),
  ('PUL',  'Premium unleaded',                                   'PVL, POL',      'fuel'),
  ('DSL',  'Diesel',                                             'OSL',      'fuel'),
  ('KERO', 'Kerosene',                                           NULL,            'fuel'),
  ('DEF',  'Diesel exhaust fluid',                               NULL,            'fuel'),
  ('E85',  'Ethanol flex fuel',                                  NULL,            'fuel'),
  ('ATG',  'Automatic tank gauge',                               'AT6',      'equipment'),
  ('STP',  'Submersible pump (in the tank sump)',                NULL,      'equipment'),
  ('UDC',  'Under-dispenser containment (the sump under a dispenser)', NULL, 'equipment'),
  ('VR',   'Veeder-Root (tank gauge / console)',                 NULL,            'equipment'),
  ('PLLD', 'Pressurized line leak detector (Veeder-Root)',       NULL,     'equipment'),
  ('LD',   'Leak detector',                                      NULL,            'equipment'),
  ('MAG',  'Mag sensor / mag probe (Veeder-Root)',               NULL,            'equipment'),
  ('SB',   'Spill bucket',                                       NULL,            'equipment'),
  ('DSP',  'Dispenser',                                          NULL,           'equipment'),
  ('P1 … P16', 'Pump / fueling position number (P3/4 = positions 3 and 4)', NULL, 'equipment'),
  ('CNI',  NULL,                                                 NULL,            'equipment'),
  ('FRP',  'Fiberglass reinforced pipe',                                    NULL,            'equipment'),
  ('Shear valve', 'Emergency shut-off valve under the dispenser', 'sheer valve',  'equipment'),
  ('Drop tube', 'Fill tube inside the tank riser',               NULL,            'equipment'),
  ('DOT barrel', 'Waste drum for pumped-out liquid',             NULL,            'equipment'),
  ('W&M',  'Weights and Measures (state inspectors)',            NULL,            'general'),
  ('OS',   'On site — written before the times: "OS 11:30-13:00-1.5 x2" = on site 11:30 to 13:00, 1.5 hours, 2 men', '05', 'ticket'),
  ('RTN',  'Return trip needed',                                 NULL,      'ticket'),
  ('x2 / (X2)', 'Crew size — the number of men on the ticket',   NULL,            'ticket'),
  ('WOT',  '7-Eleven work order number (WOT + 7 digits)',        NULL,           'ticket'),
  ('FWKD', 'Wawa work order number (FWKD + 7 digits)',           NULL,            'ticket'),
  ('INC',  '7-Eleven incident number (INC + 8 digits)',          NULL,            'ticket'),
  ('SU-',  'Sunoco site number prefix (SU-2333)',                NULL,           'ticket'),
  ('7/11', '7-Eleven (store numbers are 5 digits)',              NULL,            'ticket'),
  ('GRD-', 'Stock part number prefix, e.g. GRD-OPW10P-0152', NULL,     'parts'),
  ('VDR-', 'Veeder-Root part number prefix',                     NULL,          'parts'),
  ('GIL-', 'Gilbarco part number prefix',                        NULL,            'parts'),
  ('FIL-', 'Filter part number prefix',                          NULL,            'parts'),
  ('OPW',  'OPW (fueling equipment maker)',                      NULL,           'parts')
) AS v(term, meaning, misreads, category)
ON CONFLICT DO NOTHING;
