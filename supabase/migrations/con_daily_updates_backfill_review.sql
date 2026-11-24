-- Backfilled field-ticket daily updates (from const.inv.rp + econstruction
-- Gmail history) must never be treated as final without a human confirming
-- the transcription first — same "draft, then you confirm" rule already used
-- for con_documents.review_status and Service ticket signatures. Reuses that
-- exact 'filed'/'needs_review' vocabulary so the existing Documents-review
-- muscle memory (badge, review queue) applies here unchanged.
alter table con_daily_updates
  add column if not exists review_status text not null default 'filed',
  add column if not exists source        text not null default 'manual',
  add column if not exists source_refs   jsonb;

alter table con_daily_updates drop constraint if exists con_daily_updates_review_status_check;
alter table con_daily_updates add constraint con_daily_updates_review_status_check
  check (review_status in ('filed', 'needs_review'));

alter table con_daily_updates drop constraint if exists con_daily_updates_source_check;
alter table con_daily_updates add constraint con_daily_updates_source_check
  check (source in ('manual', 'gmail_backfill'));

comment on column con_daily_updates.review_status is
  'needs_review = a human must confirm this record (e.g. an auto-transcribed field ticket) before it is treated as final.';
comment on column con_daily_updates.source is
  'manual = entered through the app UI; gmail_backfill = filed by the historical field-ticket backfill pipeline.';
comment on column con_daily_updates.source_refs is
  'Traceability for backfilled rows: {ticket_message_id, update_message_id, ticket_attachment_id, ...} Gmail ids the data was transcribed from.';

create index if not exists con_daily_updates_review_idx on con_daily_updates (company_id, review_status);
