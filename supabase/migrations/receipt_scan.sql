-- Photo-first receipts (Expenses → New): snap the receipt, the app reads it and pre-fills the form.
--
-- 1. expense_cards: card last-4 → payment method + cardholder. Every tech has their own TEC card,
--    so the last 4 digits on a receipt identify both "TEC" and whose card it is. Rows are learned
--    automatically (each saved TEC receipt that shows a last-4, plus the backfill from past
--    receipts in the Construction Receipts inbox) and can be corrected on Settings → Payment Methods.
-- 2. expenses: keep what the scan read (card_last4, ai_extracted) and which fields it filled.
-- 3. time_clock_entries: which job someone is clocked into, so receipts default to that job.

create table if not exists public.expense_cards (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  last4               text not null check (last4 ~ '^[0-9]{4}$'),
  brand               text,                         -- VISA / MC / AMEX …
  payment_method_code text not null default 'TEC',  -- matches payment_methods.code
  holder_profile_id   uuid references public.profiles(id) on delete set null,
  holder_label        text,                         -- fallback name when the holder has no login
  source              text not null default 'learned' check (source in ('learned', 'backfill', 'manual')),
  seen_count          integer not null default 0,
  conflict_note       text,                         -- e.g. "also seen on 3 of Tristin's receipts"
  last_seen_at        timestamptz,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, last4)
);
create index if not exists expense_cards_holder_idx on public.expense_cards (holder_profile_id);

alter table public.expense_cards enable row level security;
drop policy if exists expense_cards_company_read on public.expense_cards;
create policy expense_cards_company_read on public.expense_cards for select
  using (company_id = (select company_id from public.profiles where id = auth.uid()));

alter table public.expenses
  add column if not exists card_last4   text,
  add column if not exists ai_extracted jsonb,
  add column if not exists ai_filled    text[];

alter table public.time_clock_entries
  add column if not exists con_job_id   uuid references public.con_jobs(id) on delete set null,
  add column if not exists store_number text;
create index if not exists time_clock_entries_open_idx on public.time_clock_entries (profile_id) where clock_out is null;
