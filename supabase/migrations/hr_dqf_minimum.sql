-- 2026-11-05: Trae — "only keep up with what we absolutely have to have to make our DOT files pass an audit for
-- non-CDL drivers". The required set is exactly what 49 CFR 391.51(b) lists for a non-CDL CMV driver file.
-- Everything else becomes optional: it still shows on a file if it was recorded, but it is no longer "missing".

-- Required (every DOT driver), in file order
update hr_requirement_types set applies_to = 'dot', is_active = true, sort_order = v.o
from (values
  ('Driver''s Application for Employment', 10),
  ('Request for Check of Driving Record (pre-hire MVR)', 20),
  ('Safety Performance History (prior employers)', 30),
  ('Record of Road Test', 40),
  ('Medical Examiner''s Certificate - DOT Card', 50),
  ('Medical Examiner National Registry Verification', 60),
  ('Annual MVR', 70),
  ('Annual Review of Driving Record', 80)
) as v(n, o)
where hr_requirement_types.name = v.n and hr_requirement_types.category = 'dqf';

-- Not required for a non-CDL DQF → optional (kept if already on file)
update hr_requirement_types set applies_to = 'optional', sort_order = 200 + sort_order
where category = 'dqf' and applies_to = 'dot' and name in (
  'Driver License',
  'Cert. of Compliance with Driver License Req.',
  'Drivers Statement of On-Duty Hours',
  'Driver Record Card',
  'Drug and Alcohol Policy Acknowledgement Form'
);

update hr_requirement_types set description = 'Optional. Not a 49 CFR 391.51 file item — the MVRs prove the license is valid. Handy to keep a copy and get an expiry reminder.'
  where name = 'Driver License';
update hr_requirement_types set description = 'Optional. The license-compliance statement is a CDL (Part 383) form; the driver application already covers licenses held.'
  where name = 'Cert. of Compliance with Driver License Req.';
update hr_requirement_types set description = 'Optional for the DQF. This 7-day statement is an hours-of-service record (49 CFR 395.8(j)(2)) for a new driver''s first day — keep it with time records, not in the driver file.'
  where name = 'Drivers Statement of On-Duty Hours';
update hr_requirement_types set description = 'Optional company card — not a DOT requirement.' where name = 'Driver Record Card';
update hr_requirement_types set description = 'Optional company policy receipt — DOT drug & alcohol rules (Part 382) apply only to CDL drivers.'
  where name = 'Drug and Alcohol Policy Acknowledgement Form';
update hr_requirement_types set is_active = false where name = 'Certification of Violations (Not required after 5/9/2022)';

-- Notices: DOT driver items always notify; certifications and personnel paperwork are tracked and shown,
-- but send no automatic emails unless that certification type is switched on in Settings.
alter table hr_requirement_types add column if not exists notify boolean not null default true;
update hr_requirement_types set notify = (category = 'dqf');

update hr_requirement_types set expires = false, renewal_months = null where name = 'Medical Examiner National Registry Verification';
