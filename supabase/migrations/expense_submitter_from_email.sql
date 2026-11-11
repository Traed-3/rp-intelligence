-- Receipts that arrive by email should be credited to whoever sent the email,
-- not to whoever happened to be logged in when the expense was keyed in.
--
-- expenses.submitted_by stays the profile FK (null when the sender has no app
-- login). submitter_name / submitter_email always hold the email's From so the
-- UI can still show a name for a sender who isn't in profiles.
-- source_document_id links the expense to the billing-inbox email it came from.

alter table public.expenses
  add column if not exists submitter_name     text,
  add column if not exists submitter_email    text,
  add column if not exists source_document_id uuid references public.billing_inbox_documents(id) on delete set null;

create index if not exists expenses_source_document_id_idx on public.expenses(source_document_id);

alter table public.asset_tool_items
  add column if not exists submitter_name  text,
  add column if not exists submitter_email text;
