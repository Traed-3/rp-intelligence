-- Accident reports (Forms -> Accident Report): the Smartsheet "RPS Work Vehicle Accident Report" form, filled on the
-- phone. One row per report. The question list (labels, which ones are required, which hang off a Yes) lives in
-- lib/accident.ts; every question key there is a column here. Photos sit in the private `construction-docs` bucket
-- under <company>/accident-reports/<id>/ and are listed in `photos`. The PDF is drawn from the row on demand.
create table if not exists public.accident_reports (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete cascade,

  employee_name           text,
  employee_phone          text,
  accident_date           date not null default current_date,
  accident_time           text,                                   -- HH:MM as picked on the phone
  unit_number             text,                                   -- truck / equipment number as written
  asset_id                uuid references public.assets(id) on delete set null,   -- set when the number matches an asset
  location                text,

  reported_to             text,
  instructions            text,

  description             text,
  vehicle_damage          text,

  injured                 boolean,                                -- null = not answered yet
  injury_description      text,
  time_off_needed         boolean,
  return_date             date,

  other_vehicle           boolean,
  other_driver_name       text,
  other_driver_phone      text,
  other_vehicle_desc      text,
  other_plate             text,
  other_license           text,
  other_insurance_company text,
  other_policy            text,

  property_damaged        boolean,
  property_description    text,
  property_owner          text,
  property_damage         text,

  police_called           boolean,
  police_dept             text,
  officer_name            text,
  police_report_number    text,

  witnesses               text,

  photos                  jsonb not null default '[]'::jsonb,     -- [{ "path": "...", "name": "..." }]
  signature               text,                                   -- PNG data URL from the phone screen
  signed_at               timestamptz,
  status                  text not null default 'draft' check (status in ('draft', 'complete')),
  completed_at            timestamptz,
  emailed_to              text,
  emailed_at              timestamptz,
  created_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists accident_reports_company_idx on public.accident_reports (company_id, accident_date desc);
create index if not exists accident_reports_asset_idx on public.accident_reports (asset_id);
create index if not exists accident_reports_created_by_idx on public.accident_reports (created_by);

-- Service role only: every read and write goes through the server, which applies the Forms rules (a tech sees the
-- reports they filed, the construction office roles see all). No policies, so the browser client cannot read the
-- table (it holds other drivers' license and insurance numbers).
alter table public.accident_reports enable row level security;
