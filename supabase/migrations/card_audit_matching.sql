-- Card audit (Expenses → Card audit): tick a receipt off once it is matched to the card statement.
-- Additive only. Receipts live in billing_inbox_documents (one row per emailed receipt).
alter table public.billing_inbox_documents
  add column if not exists card_matched_at timestamptz,
  add column if not exists card_matched_by uuid; -- profiles.id; deliberately NO foreign key (see below)

create index if not exists billing_inbox_documents_company_received_idx
  on public.billing_inbox_documents (company_id, received_at);

-- No FK on card_matched_by: a second billing_inbox_documents -> profiles relationship makes the
-- `profiles(full_name)` embed on the Receive-queue receipt page ambiguous, and PostgREST then
-- returns an error (the page 404s). Applied version had the FK; it was dropped on 2026-11-06.
alter table public.billing_inbox_documents drop constraint if exists billing_inbox_documents_card_matched_by_fkey;
