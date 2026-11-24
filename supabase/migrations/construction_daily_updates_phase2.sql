-- ============================================================
-- Phase 2 — Construction Daily Updates
-- Field-crew daily update per job: date, ticket image, work description,
-- techs (name + initials + hours) -> man-hours rollup, optional disposables.
-- Follows construction_module.sql conventions: company_id scoping, con_can_*()
-- RLS helpers, auto-numbered per-company via a BEFORE INSERT trigger.
-- ============================================================

-- ── parent: one row per crew per job per day ────────────────
create table if not exists con_daily_updates (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  job_id            uuid not null references con_jobs(id) on delete cascade,
  update_number     text,                       -- DU-YYYY-0001 (per company)
  work_date         date not null default (now() at time zone 'America/New_York')::date,
  work_description  text not null default '',
  ticket_storage_path text,                     -- uploaded work-ticket image (construction-docs bucket)
  ticket_document_id uuid references con_documents(id) on delete set null,  -- same file, filed in the doc center
  weather           text,
  notes             text,
  submitted_by      uuid references profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists con_daily_updates_job_idx  on con_daily_updates(job_id, work_date desc);
create index if not exists con_daily_updates_comp_idx on con_daily_updates(company_id, work_date desc);

-- ── child: one row per tech on that update (feeds man-hours) ─
create table if not exists con_daily_update_techs (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  daily_update_id  uuid not null references con_daily_updates(id) on delete cascade,
  tech_name        text not null,
  initials         text,
  hours            numeric not null default 0 check (hours >= 0),
  created_at       timestamptz not null default now()
);
create index if not exists con_daily_update_techs_parent_idx on con_daily_update_techs(daily_update_id);

-- ── disposables form (fixed list stored as JSONB; standalone or attached) ──
create table if not exists con_disposables_forms (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  daily_update_id  uuid references con_daily_updates(id) on delete cascade,
  job_id           uuid references con_jobs(id) on delete set null,
  tech_name        text,
  truck            text,
  form_date        date not null default (now() at time zone 'America/New_York')::date,
  -- items: [{ code, label, amount, ordered }]  forms: [{ name, copies }]
  items            jsonb not null default '[]'::jsonb,
  forms            jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists con_disposables_forms_parent_idx on con_disposables_forms(daily_update_id);

-- ── auto-number update_number per company: DU-YYYY-0001 ─────
create or replace function con_set_daily_update_number() returns trigger
language plpgsql as $$
declare yr text; seq int;
begin
  if new.update_number is not null and new.update_number <> '' then
    return new;
  end if;
  yr := to_char(coalesce(new.work_date, current_date), 'YYYY');
  perform pg_advisory_xact_lock(hashtext('con_daily_update_number:' || new.company_id::text || ':' || yr));
  select coalesce(max((regexp_replace(update_number, '^DU-\d{4}-', ''))::int), 0) + 1
    into seq
    from con_daily_updates
   where company_id = new.company_id
     and update_number like 'DU-' || yr || '-%';
  new.update_number := 'DU-' || yr || '-' || lpad(seq::text, 4, '0');
  return new;
end $$;

drop trigger if exists con_daily_update_number_trg on con_daily_updates;
create trigger con_daily_update_number_trg
  before insert on con_daily_updates
  for each row execute function con_set_daily_update_number();

-- keep updated_at fresh
create or replace function con_touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists con_daily_updates_touch_trg on con_daily_updates;
create trigger con_daily_updates_touch_trg
  before update on con_daily_updates
  for each row execute function con_touch_updated_at();

-- ── RLS: same company-scoped read/write helpers as the rest of con_* ──
alter table con_daily_updates      enable row level security;
alter table con_daily_update_techs enable row level security;
alter table con_disposables_forms  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['con_daily_updates','con_daily_update_techs','con_disposables_forms'] loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format(
      'create policy %I_read on %I for select using (company_id = con_user_company_id() and con_can_read())',
      t, t);
    execute format(
      'create policy %I_write on %I for all using (company_id = con_user_company_id() and con_can_write()) with check (company_id = con_user_company_id() and con_can_write())',
      t, t);
  end loop;
end $$;
