-- ============================================================
-- Phase 2b — job numbers + per-update document galleries
--
-- 1. con_documents.daily_update_id
--    Lets a daily update show its own photos/ticket without the
--    document center losing track of them.
--
-- 2. con_jobs.job_number  ->  SITE-YY  (3625-26, 210-22, CPG703-23)
--    A second project at the same site in the same year gets a
--    letter: 3625-26A, then 3625-26B. First project carries no
--    letter. Capped at 20 (A-T) per Trae's rule.
--
-- Safe to re-run. No data is dropped.
-- ============================================================

-- ── 1. per-update document link ─────────────────────────────
alter table con_documents
  add column if not exists daily_update_id uuid references con_daily_updates (id) on delete set null;

create index if not exists con_documents_daily_update_idx
  on con_documents (daily_update_id);

-- ── 2. job number ───────────────────────────────────────────
alter table con_jobs
  add column if not exists job_number text;

create index if not exists con_jobs_job_number_idx on con_jobs (company_id, job_number);

-- The year a job belongs to, or null when nothing in the row says.
-- created_at is deliberately NOT used: for imported jobs it is the day
-- the import ran, not the year the work happened.
create or replace function con_job_year(j con_jobs) returns int
language sql immutable as $$
  select extract(year from coalesce(j.project_start_date, j.date_received))::int
$$;

-- Build SITE-YY[letter] for one job, counting how many jobs already
-- exist at the same site in the same year.
create or replace function con_build_job_number(
  p_company uuid, p_site text, p_year int, p_self uuid
) returns text
language plpgsql stable as $$
declare
  n int;
  site text := nullif(btrim(p_site), '');
begin
  if site is null or p_year is null then
    return null;
  end if;

  select count(*) into n
    from con_jobs j
   where j.company_id = p_company
     and btrim(j.site_number) = site
     and con_job_year(j) = p_year
     and (p_self is null or j.id <> p_self)
     and coalesce(j.project_start_date, j.date_received)
         < coalesce((select coalesce(project_start_date, date_received) from con_jobs where id = p_self), 'infinity'::date);

  -- first project of the year carries no letter; repeats get A, B, C…
  if n <= 0 then
    return site || '-' || lpad((p_year % 100)::text, 2, '0');
  elsif n <= 19 then
    return site || '-' || lpad((p_year % 100)::text, 2, '0') || chr(64 + n);
  else
    -- past the 20-per-site ceiling; keep it unique rather than collide
    return site || '-' || lpad((p_year % 100)::text, 2, '0') || 'X' || n::text;
  end if;
end;
$$;

-- Assign on insert, and again if a date arrives later on a job that
-- never had one (the "needs a date" case).
create or replace function con_set_job_number() returns trigger
language plpgsql as $$
begin
  if new.job_number is not null and new.job_number <> '' then
    return new;
  end if;
  perform pg_advisory_xact_lock(
    hashtext('con_job_number:' || new.company_id::text || ':' || coalesce(btrim(new.site_number), ''))
  );
  new.job_number := con_build_job_number(
    new.company_id, new.site_number,
    extract(year from coalesce(new.project_start_date, new.date_received))::int,
    new.id
  );
  return new;
end;
$$;

drop trigger if exists con_jobs_set_number on con_jobs;
create trigger con_jobs_set_number
  before insert or update of project_start_date, date_received, site_number
  on con_jobs
  for each row execute function con_set_job_number();

-- ── 3. backfill existing jobs that have a real date ─────────
-- Ordered oldest-first per site+year so the earliest project is the
-- unlettered one. Jobs with no date are left null on purpose — they
-- surface in the app's "needs a date" list instead of being guessed.
with ranked as (
  select id, company_id, btrim(site_number) as site,
         extract(year from coalesce(project_start_date, date_received))::int as yr,
         row_number() over (
           partition by company_id, btrim(site_number),
                        extract(year from coalesce(project_start_date, date_received))
           order by coalesce(project_start_date, date_received), created_at, id
         ) as rn
    from con_jobs
   where coalesce(project_start_date, date_received) is not null
     and nullif(btrim(site_number), '') is not null
)
update con_jobs j
   set job_number = case
         when r.rn = 1  then r.site || '-' || lpad((r.yr % 100)::text, 2, '0')
         when r.rn <= 20 then r.site || '-' || lpad((r.yr % 100)::text, 2, '0') || chr((64 + r.rn - 1)::int)
         else r.site || '-' || lpad((r.yr % 100)::text, 2, '0') || 'X' || (r.rn - 1)::text
       end
  from ranked r
 where j.id = r.id
   and (j.job_number is null or j.job_number = '');
