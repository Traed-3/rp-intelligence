-- Pre-trip inspections (Forms -> Pre-Trip Inspection): the paper "Vehicle / Trailer Pre trip inspection (Non CDL)"
-- sheet filled on the phone. One row per inspection. `results` holds one mark per checklist line
-- ({"tire":"ok","horn":"remark","spare_tire":"na", ...}); the line keys live in lib/pretrip.ts.
-- The PDF is drawn from the row on demand, so nothing is stored in a bucket.
create table if not exists public.pretrip_inspections (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  kind            text not null check (kind in ('vehicle', 'trailer')),
  asset_id        uuid references public.assets(id) on delete set null,   -- set when the number typed matches an asset
  unit_number     text,                                                    -- vehicle / trailer number as written on the form
  equipment       text,                                                    -- trailer sheet only
  inspection_date date not null default current_date,
  checked_by      text,
  results         jsonb not null default '{}'::jsonb,
  remarks         text,
  signature       text,                                                    -- PNG data URL from the phone screen
  signed_at       timestamptz,
  status          text not null default 'draft' check (status in ('draft', 'complete')),
  completed_at    timestamptz,
  emailed_to      text,
  emailed_at      timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists pretrip_inspections_company_idx on public.pretrip_inspections (company_id, inspection_date desc);
create index if not exists pretrip_inspections_asset_idx on public.pretrip_inspections (asset_id);
create index if not exists pretrip_inspections_created_by_idx on public.pretrip_inspections (created_by);

-- Service role only: every read and write goes through the server, which applies the Forms rules (techs see their
-- own inspections, the construction office roles see all). No policies, so the browser client cannot read the table.
alter table public.pretrip_inspections enable row level security;
drop policy if exists pretrip_inspections_company_read on public.pretrip_inspections;
