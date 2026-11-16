-- Site surveys (Forms -> Site Surveys): one flexible survey per site visit. Built from the site surveys on file in
-- Dropbox (7-Eleven Facility Site Survey, 7-11 / CSI Petroleum Survey, Source / ICON sump worksheets, emailed surveys
-- and site drawings). The question catalog lives in lib/site-survey.ts; nothing has a fixed count, so the answers are
-- kept as JSON:
--   data   = { one: {section: {field: answer}}, lists: {section: [{id, v: {field: answer}, extra: [{label, value}]}]}, extra: {section: [...]} }
--   plan   = the site plan drawing: shapes and lines on a 1000 x 1000 board, plus the aerial picture behind it
--   photos = [{id, path, ref, caption}] in the private construction-docs bucket under <company>/site-surveys/<id>/
-- The PDF is drawn from the row on demand.
create table if not exists public.site_surveys (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  job_id         uuid references public.con_jobs(id) on delete set null,
  site_number    text,
  site_name      text,
  address        text,
  survey_date    date not null default current_date,
  tech_name      text,
  survey_company text,
  data           jsonb not null default '{}'::jsonb,
  plan           jsonb,
  photos         jsonb not null default '[]'::jsonb,
  status         text not null default 'draft' check (status in ('draft', 'complete')),
  completed_at   timestamptz,
  emailed_to     text,
  emailed_at     timestamptz,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists site_surveys_company_idx on public.site_surveys (company_id, survey_date desc);
create index if not exists site_surveys_site_idx on public.site_surveys (company_id, site_number);
create index if not exists site_surveys_created_by_idx on public.site_surveys (created_by);
create index if not exists site_surveys_job_idx on public.site_surveys (job_id);

-- Service role only: every read and write goes through the server, which applies the Forms rules (techs see their
-- own surveys, the construction office roles see all). No policies, so the browser client cannot read the table.
alter table public.site_surveys enable row level security;
