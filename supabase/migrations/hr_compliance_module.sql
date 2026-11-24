-- DQF & Certifications module (replaces the Smartsheet "DQF & Cert Tracker").
--
-- Two sides:
--   1. Driver Qualification Files (FMCSA 49 CFR 391.51) for DOT drivers — application, MVRs, road test,
--      medical card, annual review, etc.
--   2. Certifications — manufacturer (OPW, NOV, ICON, Bravo, Xerxes, FFS, OmegaFlex…), jurisdiction
--      (MDE, DC DOEE, WVDEP, PA…) and safety (API, OSHA, CPR, equipment operator) cards.
-- Plus the personnel-file checklist (W-4, direct deposit, policy acknowledgements…) the sheet also tracked.
--
-- Tables
--   hr_employees          the roster this module tracks (linked to profiles / con_contacts when known)
--   hr_requirement_types  catalog: what can be on file, how long it lasts, who it applies to, notice overrides
--   hr_employee_items     one row per employee × requirement: dates, card #, status, scanned card
--   hr_item_history       old dates/cards kept when an item is renewed
--   hr_compliance_settings per-company notice days + who gets emailed
--   hr_notice_log         every notice sent, so the daily check never sends the same one twice
--
-- Passwords/codes columns in the Smartsheet were deliberately NOT carried over.

create table if not exists hr_employees (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  full_name        text not null,
  email            text,                  -- work email; expiry notices go here
  personal_email   text,
  phone            text,
  department       text not null default 'construction'
                   check (department in ('construction','service','mechanics','office','management')),
  job_title        text,
  hire_date        date,
  is_dot_driver    boolean not null default false,  -- needs a full DQF
  is_cdl           boolean not null default false,  -- adds Clearinghouse / drug-test items
  license_number   text,
  license_state    text,
  license_class    text,
  is_active        boolean not null default true,
  termination_date date,
  notify_employee  boolean not null default true,   -- send this person their own expiry notices
  profile_id       uuid references profiles(id) on delete set null,
  contact_id       uuid references con_contacts(id) on delete set null,
  notes            text,
  smartsheet_row_id bigint,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists hr_employees_company_idx on hr_employees(company_id, is_active);
create unique index if not exists hr_employees_smartsheet_idx on hr_employees(smartsheet_row_id) where smartsheet_row_id is not null;

create table if not exists hr_requirement_types (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  name             text not null,
  category         text not null check (category in ('dqf','certification','personnel')),
  kind             text,                  -- certification sub-group: manufacturer / jurisdiction / safety / equipment
  issuer           text,                  -- OPW, MDE, FMCSA…
  applies_to       text not null default 'optional'
                   check (applies_to in ('dot','cdl','all','optional')),
                   -- dot = every DOT driver; cdl = CDL drivers only; all = every employee; optional = only when added
  departments      text[],                -- for applies_to = all: limit to these departments (null = everyone)
  expires          boolean not null default true,
  renewal_months   int,                   -- valid for N months after issue/completion (used when no printed expiry)
  notice_days      int[],                 -- override the company notice schedule for this type
  regulation       text,                  -- e.g. 49 CFR 391.43
  description      text,
  sort_order       int not null default 100,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists hr_employee_items (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  employee_id      uuid not null references hr_employees(id) on delete cascade,
  type_id          uuid not null references hr_requirement_types(id) on delete cascade,
  status           text not null default 'missing'
                   check (status in ('missing','in_progress','on_file','not_required')),
  issued_date      date,                  -- date issued / completed / reviewed
  expiration_date  date,                  -- printed expiry, or issued + renewal_months
  cert_number      text,
  notes            text,
  document_path    text,                  -- object in the private hr-compliance bucket
  document_name    text,
  verified_by      uuid references profiles(id) on delete set null,
  verified_at      timestamptz,
  smartsheet_row_id bigint,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (employee_id, type_id)
);
create index if not exists hr_employee_items_exp_idx on hr_employee_items(company_id, expiration_date);

create table if not exists hr_item_history (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  item_id          uuid not null references hr_employee_items(id) on delete cascade,
  issued_date      date,
  expiration_date  date,
  cert_number      text,
  document_path    text,
  document_name    text,
  replaced_by      uuid references profiles(id) on delete set null,
  replaced_at      timestamptz not null default now()
);

create table if not exists hr_compliance_settings (
  company_id              uuid primary key references companies(id) on delete cascade,
  emails_enabled          boolean not null default false, -- master switch; off until the roster is reviewed
  dqf_notice_days         int[] not null default '{60,30,14,7}',
  cert_notice_days        int[] not null default '{60,30,14,7}',
  overdue_repeat_days     int not null default 7,         -- re-send expired notices every N days
  notify_employee         boolean not null default true,  -- techs/drivers/staff get their own notices
  management_emails       text[] not null default '{}',   -- get every notice
  dqf_management_emails   text[] not null default '{}',   -- DQF notices only
  cert_management_emails  text[] not null default '{}',   -- certification notices only
  weekly_digest           boolean not null default true,  -- Monday roll-up incl. missing DQF items
  digest_weekday          int not null default 1 check (digest_weekday between 0 and 6), -- 0 = Sunday
  updated_by              uuid references profiles(id) on delete set null,
  updated_at              timestamptz not null default now()
);

create table if not exists hr_notice_log (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  item_id          uuid references hr_employee_items(id) on delete cascade,
  stage            text not null,         -- '60','30','14','7','expired','digest'
  expiration_date  date,
  recipient        text not null,
  sent_at          timestamptz not null default now()
);
create index if not exists hr_notice_log_item_idx on hr_notice_log(item_id, stage, expiration_date);

-- updated_at
create or replace function hr_touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists hr_employees_touch on hr_employees;
create trigger hr_employees_touch before update on hr_employees for each row execute function hr_touch_updated_at();
drop trigger if exists hr_employee_items_touch on hr_employee_items;
create trigger hr_employee_items_touch before update on hr_employee_items for each row execute function hr_touch_updated_at();

-- RLS: all access goes through server actions with the service role (same as the construction module);
-- enabling RLS with no policies keeps the anon/authenticated keys out entirely.
alter table hr_employees           enable row level security;
alter table hr_requirement_types   enable row level security;
alter table hr_employee_items      enable row level security;
alter table hr_item_history        enable row level security;
alter table hr_compliance_settings enable row level security;
alter table hr_notice_log          enable row level security;

-- Private bucket for scanned cards / DQF documents.
insert into storage.buckets (id, name, public)
values ('hr-compliance', 'hr-compliance', false)
on conflict (id) do nothing;

-- Seed the requirement catalog + settings for every company.
do $$
declare c record;
begin
  for c in select id from companies loop
    insert into hr_compliance_settings (company_id) values (c.id) on conflict do nothing;

    insert into hr_requirement_types (company_id, name, category, kind, issuer, applies_to, expires, renewal_months, regulation, sort_order, description) values
      -- Driver Qualification File (49 CFR 391.51)
      (c.id, 'Driver''s Application for Employment',        'dqf', null, 'FMCSA', 'dot', false, null, '49 CFR 391.21', 10, null),
      (c.id, 'Safety Performance History (prior employers)', 'dqf', null, 'FMCSA', 'dot', false, null, '49 CFR 391.23', 20, 'Inquiry to previous DOT employers for the past 3 years, within 30 days of hire.'),
      (c.id, 'Request for Check of Driving Record (pre-hire MVR)', 'dqf', null, 'FMCSA', 'dot', false, null, '49 CFR 391.23', 30, null),
      (c.id, 'Driver License',                               'dqf', null, 'State DMV', 'dot', true, null, '49 CFR 391.11', 40, null),
      (c.id, 'Cert. of Compliance with Driver License Req.', 'dqf', null, 'FMCSA', 'dot', false, null, '49 CFR 383.71', 50, null),
      (c.id, 'Drivers Statement of On-Duty Hours',           'dqf', null, 'FMCSA', 'dot', false, null, '49 CFR 395.8', 60, 'Required for new drivers (prior 7 days).'),
      (c.id, 'Record of Road Test',                          'dqf', null, 'FMCSA', 'dot', false, null, '49 CFR 391.31', 70, 'Road test certificate or accepted equivalent (391.33).'),
      (c.id, 'Driver Record Card',                           'dqf', null, 'RPS', 'dot', false, null, null, 80, null),
      (c.id, 'Medical Examiner''s Certificate - DOT Card',   'dqf', null, 'FMCSA', 'dot', true, 24, '49 CFR 391.43', 90, 'DOT physical card — valid up to 24 months.'),
      (c.id, 'Medical Examination Report',                   'dqf', null, 'FMCSA', 'dot', true, 24, '49 CFR 391.43', 100, null),
      (c.id, 'Medical Examiner National Registry Verification', 'dqf', null, 'FMCSA', 'dot', true, 24, '49 CFR 391.51(b)(9)', 110, 'Verify the examiner is on the National Registry; redo with each new med card.'),
      (c.id, 'Annual MVR',                                   'dqf', null, 'State DMV', 'dot', true, 12, '49 CFR 391.25', 120, 'Motor vehicle record pulled at least every 12 months.'),
      (c.id, 'Annual Review of Driving Record',              'dqf', null, 'FMCSA', 'dot', true, 12, '49 CFR 391.25', 130, 'Annual review of the MVR by the motor carrier (includes the old certification of violations).'),
      (c.id, 'Drug & Alcohol Clearinghouse Query',           'dqf', null, 'FMCSA', 'cdl', true, 12, '49 CFR 382.701', 140, 'Full query pre-hire, limited query every 12 months (CDL drivers).'),
      (c.id, 'Pre-Employment Drug Test',                     'dqf', null, 'FMCSA', 'cdl', false, null, '49 CFR 382.301', 150, 'CDL drivers only.'),
      (c.id, 'Drug and Alcohol Policy Acknowledgement Form', 'dqf', null, 'RPS', 'dot', false, null, '49 CFR 382.601', 160, null),
      (c.id, 'Certification of Violations (Not required after 5/9/2022)', 'dqf', null, 'FMCSA', 'optional', false, null, null, 900, 'Retired 5/9/2022 — kept for old files only.'),

      -- Certifications
      (c.id, 'API Safety Certification',           'certification', 'safety',        'API',         'optional', true, 24, null, 200, null),
      (c.id, 'OSHA 10',                            'certification', 'safety',        'OSHA',        'optional', false, null, null, 205, null),
      (c.id, 'OSHA 30',                            'certification', 'safety',        'OSHA',        'optional', false, null, null, 206, null),
      (c.id, 'CPR & First Aid',                    'certification', 'safety',        'Red Cross / AHA', 'optional', true, 24, null, 210, null),
      (c.id, 'Confined Space Training',            'certification', 'safety',        null,          'optional', true, 24, null, 215, null),
      (c.id, 'Confined Space Rescue',              'certification', 'safety',        null,          'optional', true, 24, null, 216, null),
      (c.id, 'Hot Work Training',                  'certification', 'safety',        null,          'optional', true, 24, null, 217, null),
      (c.id, 'OPW Certification',                  'certification', 'manufacturer',  'OPW',         'optional', true, null, null, 230, null),
      (c.id, 'NOV Certification',                  'certification', 'manufacturer',  'NOV',         'optional', true, null, null, 231, null),
      (c.id, 'NOV Certification - Pipe',           'certification', 'manufacturer',  'NOV',         'optional', true, null, null, 232, null),
      (c.id, 'ICON Certification',                 'certification', 'manufacturer',  'ICON',        'optional', true, null, null, 233, null),
      (c.id, 'Bravo Certification',                'certification', 'manufacturer',  'Bravo',       'optional', true, null, null, 234, null),
      (c.id, 'Double Trac Certification',          'certification', 'manufacturer',  'Containment Solutions', 'optional', true, null, null, 235, null),
      (c.id, 'Xerxes Certification',               'certification', 'manufacturer',  'Xerxes',      'optional', true, null, null, 236, null),
      (c.id, 'FFS Pro Certification',              'certification', 'manufacturer',  'Franklin Fueling', 'optional', true, null, null, 237, null),
      (c.id, 'FE Petro STP Certification',         'certification', 'manufacturer',  'Franklin Fueling', 'optional', true, null, null, 238, null),
      (c.id, 'OmegaFlex Certification',            'certification', 'manufacturer',  'OmegaFlex',   'optional', true, null, null, 239, null),
      (c.id, 'MDE Tank Tech Installer Certification',        'certification', 'jurisdiction', 'MDE (Maryland)', 'optional', true, null, null, 250, null),
      (c.id, 'DC Tank Tech Installer/Removal Certification', 'certification', 'jurisdiction', 'DC DOEE',        'optional', true, null, null, 251, null),
      (c.id, 'WVDEP Class A Tank Tech Installer Certification', 'certification', 'jurisdiction', 'WVDEP',      'optional', true, null, null, 252, null),
      (c.id, 'WVDEP Class B Tank Tech Installer Certification', 'certification', 'jurisdiction', 'WVDEP',      'optional', true, null, null, 253, null),
      (c.id, 'PA Tank Handler Certification',      'certification', 'jurisdiction',  'PA DEP',      'optional', true, null, null, 254, null),
      (c.id, 'Mini Excavator Certification',       'certification', 'equipment',     null,          'optional', true, 36, null, 270, null),
      (c.id, 'Skid Steer Certification',           'certification', 'equipment',     null,          'optional', true, 36, null, 271, null),
      (c.id, 'Telehandler Certification',          'certification', 'equipment',     null,          'optional', true, 36, null, 272, null),
      (c.id, 'Scissor Lift Certification',         'certification', 'equipment',     null,          'optional', true, 36, null, 273, null),
      (c.id, 'Boom Truck Certification',           'certification', 'equipment',     null,          'optional', true, 36, null, 274, null),
      (c.id, 'Sit Down Forklift Certification',    'certification', 'equipment',     null,          'optional', true, 36, null, 275, null),

      -- Personnel file
      (c.id, 'Resume',                                  'personnel', null, null, 'all', false, null, null, 300, null),
      (c.id, 'Employment Application',                  'personnel', null, null, 'all', false, null, null, 301, null),
      (c.id, 'W-4',                                     'personnel', null, null, 'all', false, null, null, 302, null),
      (c.id, 'Direct Deposit Form',                     'personnel', null, null, 'all', false, null, null, 303, null),
      (c.id, 'Social Security Card Copy',               'personnel', null, null, 'all', false, null, null, 304, null),
      (c.id, 'Cell Phone Set Up and Received',          'personnel', null, null, 'all', false, null, null, 305, null),
      (c.id, 'Policies and Procedures Acknowledgement', 'personnel', null, null, 'all', false, null, null, 306, null)
    on conflict (company_id, name) do nothing;
  end loop;
end $$;
