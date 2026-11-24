-- ============================================================
-- Phase 2c — stop reusing quote / invoice / daily-update numbers
--
-- The old triggers derived the next number from MAX(existing) + 1.
-- Delete the highest-numbered invoice of the year and the next one
-- issued silently reclaims that number — so two different invoices
-- can carry INV-2026-0007 in the customer record. Repair tickets
-- already avoid this by using a real sequence (schema.sql:595);
-- the construction module never followed suit.
--
-- Fix: a counter table that only ever moves forward. Deleting a row
-- leaves a gap, which is the correct behaviour for a document number.
--
-- Safe to re-run. Existing numbers are never altered; counters are
-- seeded above the highest number already issued.
-- ============================================================

create table if not exists con_number_counters (
  company_id uuid not null references companies on delete cascade,
  kind       text not null check (kind in ('quote', 'invoice', 'daily_update')),
  yr         int  not null,
  last_value int  not null default 0,
  primary key (company_id, kind, yr)
);

-- Only the SECURITY DEFINER function below touches this table.
alter table con_number_counters enable row level security;

-- Hand out the next value atomically. SECURITY DEFINER so the counter
-- advances regardless of who is inserting the quote/invoice.
create or replace function con_next_number(p_company uuid, p_kind text, p_year int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v int;
begin
  insert into con_number_counters (company_id, kind, yr, last_value)
  values (p_company, p_kind, p_year, 1)
  on conflict (company_id, kind, yr)
  do update set last_value = con_number_counters.last_value + 1
  returning last_value into v;
  return v;
end;
$$;

-- ── seed counters from what has already been issued ─────────
-- Uses the same year basis as each trigger, so the first number handed
-- out after this migration is strictly greater than every existing one.
insert into con_number_counters (company_id, kind, yr, last_value)
select company_id,
       'quote',
       to_char(coalesce(proposal_date, created_at::date), 'YYYY')::int,
       coalesce(max(nullif(regexp_replace(quote_number, '^Q-\d{4}-', ''), '')::int), 0)
  from con_quotes
 where quote_number is not null and quote_number <> ''
 group by 1, 2, 3
on conflict (company_id, kind, yr)
do update set last_value = greatest(con_number_counters.last_value, excluded.last_value);

insert into con_number_counters (company_id, kind, yr, last_value)
select company_id,
       'invoice',
       to_char(coalesce(invoice_date, created_at::date), 'YYYY')::int,
       coalesce(max(nullif(regexp_replace(invoice_number, '^INV-\d{4}-', ''), '')::int), 0)
  from con_invoices
 where invoice_number is not null and invoice_number <> ''
 group by 1, 2, 3
on conflict (company_id, kind, yr)
do update set last_value = greatest(con_number_counters.last_value, excluded.last_value);

insert into con_number_counters (company_id, kind, yr, last_value)
select company_id,
       'daily_update',
       to_char(coalesce(work_date, created_at::date), 'YYYY')::int,
       coalesce(max(nullif(regexp_replace(update_number, '^DU-\d{4}-', ''), '')::int), 0)
  from con_daily_updates
 where update_number is not null and update_number <> ''
 group by 1, 2, 3
on conflict (company_id, kind, yr)
do update set last_value = greatest(con_number_counters.last_value, excluded.last_value);

-- Belt and braces: never hand out a number at or below one already in use,
-- even for a year that somehow escaped the seed above.
create or replace function con_seed_counter_from(p_company uuid, p_kind text, p_year int, p_high int)
returns void
language sql
security definer
set search_path = public
as $$
  insert into con_number_counters (company_id, kind, yr, last_value)
  values (p_company, p_kind, p_year, p_high)
  on conflict (company_id, kind, yr)
  do update set last_value = greatest(con_number_counters.last_value, excluded.last_value);
$$;

-- ── rewire the three triggers ───────────────────────────────
create or replace function con_set_quote_number() returns trigger
language plpgsql as $$
declare
  yr  int := to_char(coalesce(new.proposal_date, current_date), 'YYYY')::int;
  seq int;
begin
  if new.quote_number is null or new.quote_number = '' then
    perform con_seed_counter_from(new.company_id, 'quote', yr, coalesce((
      select max(nullif(regexp_replace(quote_number, '^Q-\d{4}-', ''), '')::int)
        from con_quotes
       where company_id = new.company_id
         and quote_number like 'Q-' || yr::text || '-%'), 0));
    seq := con_next_number(new.company_id, 'quote', yr);
    new.quote_number := 'Q-' || yr::text || '-' || lpad(seq::text, 4, '0');
  end if;
  return new;
end;
$$;

create or replace function con_set_invoice_number() returns trigger
language plpgsql as $$
declare
  yr  int := to_char(coalesce(new.invoice_date, current_date), 'YYYY')::int;
  seq int;
begin
  if new.invoice_number is null or new.invoice_number = '' then
    perform con_seed_counter_from(new.company_id, 'invoice', yr, coalesce((
      select max(nullif(regexp_replace(invoice_number, '^INV-\d{4}-', ''), '')::int)
        from con_invoices
       where company_id = new.company_id
         and invoice_number like 'INV-' || yr::text || '-%'), 0));
    seq := con_next_number(new.company_id, 'invoice', yr);
    new.invoice_number := 'INV-' || yr::text || '-' || lpad(seq::text, 4, '0');
  end if;
  return new;
end;
$$;

create or replace function con_set_daily_update_number() returns trigger
language plpgsql as $$
declare
  yr  int := to_char(coalesce(new.work_date, current_date), 'YYYY')::int;
  seq int;
begin
  if new.update_number is null or new.update_number = '' then
    perform con_seed_counter_from(new.company_id, 'daily_update', yr, coalesce((
      select max(nullif(regexp_replace(update_number, '^DU-\d{4}-', ''), '')::int)
        from con_daily_updates
       where company_id = new.company_id
         and update_number like 'DU-' || yr::text || '-%'), 0));
    seq := con_next_number(new.company_id, 'daily_update', yr);
    new.update_number := 'DU-' || yr::text || '-' || lpad(seq::text, 4, '0');
  end if;
  return new;
end;
$$;

-- Triggers themselves are unchanged in shape; recreate so they bind to the
-- new function bodies regardless of what state this database was left in.
drop trigger if exists con_quotes_set_number on con_quotes;
create trigger con_quotes_set_number before insert on con_quotes
  for each row execute function con_set_quote_number();

drop trigger if exists con_invoices_set_number on con_invoices;
create trigger con_invoices_set_number before insert on con_invoices
  for each row execute function con_set_invoice_number();

drop trigger if exists con_daily_update_number_trg on con_daily_updates;
create trigger con_daily_update_number_trg before insert on con_daily_updates
  for each row execute function con_set_daily_update_number();
