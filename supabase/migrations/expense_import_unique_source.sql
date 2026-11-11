-- Emailed receipts → expenses (lib/receipt-expense-import.ts): one expense per inbox email, ever.
-- Needs expense_submitter_from_email.sql (adds expenses.source_document_id) first.
drop index if exists public.expenses_source_document_id_idx;
create unique index if not exists expenses_source_document_id_key
  on public.expenses (source_document_id) where source_document_id is not null;
