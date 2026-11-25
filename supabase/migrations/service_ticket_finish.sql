-- Field tickets: the tech's "turn it in" step (Trae, 2026-11-25: make the in-app ticket usable).
-- completion = what the tech said when he turned the ticket in: complete, or a return trip is needed (with why).
-- Additive only.
alter table service_tickets
  add column if not exists completion  text check (completion in ('complete', 'rtn')),
  add column if not exists rtn_reason  text,
  add column if not exists finished_at timestamptz,
  add column if not exists finished_by uuid;

create index if not exists service_tickets_finished_idx on service_tickets (company_id, finished_at desc) where finished_at is not null;
