-- DQF Manager: DOT audit support (added 2026-11-05).
-- 1. Missing 49 CFR Part 382/391 file items (Clearinghouse pre-employment query, consent, random pool, ELDT, hazmat).
-- 2. Every DQF requirement gets plain "what it is / how to get it" guidance (shown on the item and in the audit).
-- Idempotent: safe to re-run.

do $$
declare c uuid;
begin
  for c in select id from companies loop
    insert into hr_requirement_types (company_id, name, category, issuer, applies_to, expires, renewal_months, regulation, sort_order, description)
    values
      (c, 'Clearinghouse Pre-Employment Full Query', 'dqf', 'FMCSA', 'cdl', false, null, '49 CFR 382.701(a)', 62,
       'Before a CDL driver first drives for us: run a FULL query in the FMCSA Drug & Alcohol Clearinghouse (clearinghouse.fmcsa.dot.gov). The driver must log in and give electronic consent. Print/save the query result to the file.'),
      (c, 'Clearinghouse Limited Query Consent', 'dqf', 'FMCSA', 'cdl', false, null, '49 CFR 382.703', 63,
       'Signed general consent from the driver allowing our annual LIMITED Clearinghouse queries. One signed form can cover the whole time they work here.'),
      (c, 'Random Testing Program Enrollment', 'dqf', null, 'cdl', false, null, '49 CFR 382.305', 64,
       'Proof the CDL driver is in our random drug & alcohol testing pool (consortium/TPA roster or enrollment letter). Add them the day they are hired; remove them when they leave.'),
      (c, 'Entry-Level Driver Training Certificate (ELDT)', 'dqf', 'FMCSA', 'cdl', false, null, '49 CFR 380.609', 65,
       'Only for drivers whose Class A/B CDL (or a P/S/H endorsement) was first issued on or after 2/7/2022 — print their ELDT completion from the Training Provider Registry. Mark "Not required" for anyone licensed earlier.'),
      (c, 'Hazmat Employee Training', 'dqf', null, 'optional', true, 36, '49 CFR 172.704', 70,
       'Required for anyone who loads, unloads or drives hazardous materials in quantities that need placards or shipping papers (e.g. hauling fuel/product, transfer tanks over the exempt limits). General awareness, function-specific, safety and security training; refresh every 3 years.')
    on conflict (company_id, name) do nothing;
  end loop;
end $$;

-- Guidance on the existing DQF items (by name, every company).
update hr_requirement_types t set description = v.d, regulation = coalesce(v.r, t.regulation)
from (values
  ('Driver''s Application for Employment', '49 CFR 391.21',
   'Completed and SIGNED by the driver before they drive: 3 years of addresses, every employer for the last 3 years (10 years for CDL drivers), accidents and violations for 3 years, any license suspensions, and every license held in the last 3 years.'),
  ('Safety Performance History (prior employers)', '49 CFR 391.23(a)(2)',
   'Within 30 days of hire, send a written inquiry to every DOT-regulated employer the driver had in the last 3 years (accidents; for CDL drivers also drug & alcohol history before 2023). Keep the replies — or a note of your good-faith attempts — in the file.'),
  ('Request for Check of Driving Record (pre-hire MVR)', '49 CFR 391.23(a)(1)',
   'Within 30 days of hire, order an MVR from every state the driver held a license in during the last 3 years. Keep the MVR(s) in the file.'),
  ('Driver License', '49 CFR 391.11',
   'Copy of the driver''s current license (front and back). Enter the expiration date so we are warned before it lapses.'),
  ('Cert. of Compliance with Driver License Req.', '49 CFR 383.71 / 391.21',
   'Driver''s signed statement that they hold only one license and it is valid (often part of the application).'),
  ('Drivers Statement of On-Duty Hours', '49 CFR 395.8(j)(2)',
   'New-hire statement of total on-duty hours for the 7 days before they first drive for us, and when they were last relieved from duty.'),
  ('Record of Road Test', '49 CFR 391.31 / 391.33',
   'Road test certificate signed by the person who gave it — OR a copy of a valid CDL / road test certificate from the last 3 years accepted in its place (391.33).'),
  ('Driver Record Card', null,
   'Company driver summary card (not a federal form).'),
  ('Medical Examiner''s Certificate - DOT Card', '49 CFR 391.41 / 391.43',
   'Current DOT medical card (MCSA-5876) from an examiner on the National Registry. Good for up to 24 months — often less; always enter the date printed on the card. For CDL drivers, the state MVR showing medical status also goes in the file.'),
  ('Medical Examination Report', '49 CFR 391.43',
   'The long-form exam report (MCSA-5875). Optional for the DQF, but keep it if the clinic gives it to you.'),
  ('Medical Examiner National Registry Verification', '49 CFR 391.51(b)(9)',
   'Each time a new medical card comes in, look the examiner up at nationalregistry.fmcsa.dot.gov and save a screenshot/print showing they are listed. Date it on or after the exam date.'),
  ('Annual MVR', '49 CFR 391.25(a)',
   'At least once every 12 months, order an MVR from every state the driver held a license in during the year.'),
  ('Annual Review of Driving Record', '49 CFR 391.25(b)',
   'Within 12 months of the last one: a manager reviews the annual MVR, decides whether the driver still meets minimum requirements, and signs/dates a note of the review (name of reviewer + date).'),
  ('Drug & Alcohol Clearinghouse Query', '49 CFR 382.701(b)',
   'Annual LIMITED query in the FMCSA Clearinghouse for every CDL driver, at least once every 12 months. Save the query record to the file.'),
  ('Pre-Employment Drug Test', '49 CFR 382.301',
   'Negative DOT pre-employment drug test result (MRO verified) BEFORE the CDL driver performs any safety-sensitive work.'),
  ('Drug and Alcohol Policy Acknowledgement Form', 'Company policy (49 CFR 382.601 for CDL drivers)',
   'Driver''s signed receipt of the company drug & alcohol policy. Required by 382.601 for CDL drivers; company policy for everyone else.'),
  ('Certification of Violations (Not required after 5/9/2022)', null,
   'Retired by FMCSA in 2022 — no longer needed. Old copies can stay in the file.')
) as v(n, r, d)
where t.name = v.n;
-- 2026-11-05: MCSA-5875 long form is the examiner's record, not a required DQF item
update hr_requirement_types set applies_to = 'optional' where name = 'Medical Examination Report';
