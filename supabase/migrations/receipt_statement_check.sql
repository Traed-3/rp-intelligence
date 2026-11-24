-- Receipts by payment type (Expenses → Receipts by payment type): tick a receipt off once it has
-- been found on the monthly bill (credit card statement, Home Depot statement, vendor account bill).
-- Lives on `expenses` so hand-entered receipts can be ticked off the same way as emailed ones.

alter table public.expenses
  add column if not exists statement_checked_at timestamptz,
  add column if not exists statement_checked_by uuid; -- profiles.id; deliberately NO foreign key (see below)

-- No FK on statement_checked_by: another expenses -> profiles relationship would make more
-- PostgREST embeds ambiguous. Same choice as billing_inbox_documents.card_matched_by.

create index if not exists expenses_company_pay_date_idx
  on public.expenses (company_id, payment_method_code, expense_date);
