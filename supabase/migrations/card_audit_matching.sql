-- Card audit (Expenses → Card audit): tick a receipt off once it is matched to the card statement.
-- Additive only. Receipts live in billing_inbox_documents (one row per emailed receipt).
alter table public.billing_inbox_documents
  add column if not exists card_matched_at timestamptz,
  add column if not exists card_matched_by uuid references public.profiles(id) on delete set null;

create index if not exists billing_inbox_documents_company_received_idx
  on public.billing_inbox_documents (company_id, received_at);
