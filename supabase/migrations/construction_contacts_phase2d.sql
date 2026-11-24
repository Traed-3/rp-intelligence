-- ============================================================
-- Phase 2d — con_contacts
--
-- A place for people who are not app users. RPS crew, customer contacts,
-- vendor reps and service numbers all live in the "Current RPS Contacts"
-- export today and nowhere in the app. `profiles` is not the right home:
-- it is built around Google sign-in, and these people do not log in.
--
-- Safe to re-run.
-- ============================================================

create table if not exists con_contacts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies on delete cascade,
  name         text not null,
  kind         text not null default 'employee'
                 check (kind in ('employee', 'customer', 'vendor', 'service', 'other')),
  title        text,
  email        text,
  phone        text,
  mobile       text,
  -- who they work for, when that is one of our customers
  customer_id  uuid references con_customers on delete set null,
  employer     text,
  address      text,
  city         text,
  state        text,
  zip          text,
  is_active    boolean not null default true,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists con_contacts_company_idx  on con_contacts (company_id);
create index if not exists con_contacts_kind_idx     on con_contacts (company_id, kind);
create index if not exists con_contacts_customer_idx on con_contacts (customer_id);

-- One person should not be entered twice. Email is the reliable key when
-- present; the partial index leaves the many phone-only entries alone.
create unique index if not exists con_contacts_email_uniq
  on con_contacts (company_id, lower(email)) where email is not null;

drop trigger if exists con_contacts_updated_at on con_contacts;
create trigger con_contacts_updated_at before update on con_contacts
  for each row execute function update_updated_at();

alter table con_contacts enable row level security;

-- Same shape the other con_* tables use: scope to the caller's company and
-- then apply the role check. con_can_read()/con_can_write() take no argument.
drop policy if exists con_contacts_read on con_contacts;
create policy con_contacts_read on con_contacts
  for select using (company_id = con_user_company_id() and con_can_read());

drop policy if exists con_contacts_write on con_contacts;
create policy con_contacts_write on con_contacts
  for all using (company_id = con_user_company_id() and con_can_write())
  with check (company_id = con_user_company_id() and con_can_write());
