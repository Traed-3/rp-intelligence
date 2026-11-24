-- Master Schedule → construction jobs sync (scripts/sync-master-schedule-jobs.py), 2026-11-06.
-- One way: Starsky's workbook is only read. These columns let the sync act on CHANGES to the master instead of
-- re-asserting it every run, so edits made in the app (the email feed, the 6 AM job routine, a person) stand
-- until Starsky changes that row again.

-- Which app job each Job List row belongs to, and the stage text the sync last pushed from it.
alter table con_master_schedule_log add column if not exists job_id uuid references con_jobs(id) on delete set null;
alter table con_master_schedule_log add column if not exists synced_stage text;
alter table con_master_schedule_log add column if not exists synced_at timestamptz;
create index if not exists con_master_schedule_log_job_idx on con_master_schedule_log(job_id);

-- Completed Jobs rows the sync has already acted on (first sighting closes the matching open job, once).
create table if not exists con_master_completed_seen (
  fingerprint   text primary key,
  company_id    uuid not null references companies(id) on delete cascade,
  site_raw      text,
  site_key      text,
  wo            text,
  stage         text,
  scope         text,
  sheet_row     int,
  first_seen_at timestamptz not null default now(),
  job_id        uuid references con_jobs(id) on delete set null,
  action        text            -- baseline | closed | created | skipped:<why>
);
alter table con_master_completed_seen enable row level security;
drop policy if exists "company read" on con_master_completed_seen;
create policy "company read" on con_master_completed_seen for select
  using (company_id = con_user_company_id() and con_can_read());

-- "Leave this job alone": the sync never changes or closes a job with this set (e.g. 33244 WOT1345010 waits on its closeout).
alter table con_jobs add column if not exists master_sync_hold boolean not null default false;

-- Customer PO# (Shannon replies "PO # 24304" in econstruction). Until now it only lived in red notes on the master.
alter table con_jobs add column if not exists po_number text;
