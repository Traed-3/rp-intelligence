-- Per-person layout choices (dashboard cards, sidebar, phone tabs). Additive; empty object = app defaults.
-- APPLIED 2026-11-12 via the Supabase MCP connector.
alter table public.profiles add column if not exists ui_prefs jsonb not null default '{}'::jsonb;
comment on column public.profiles.ui_prefs is 'Per-user layout preferences set on Settings > Personalize: {dashboard:{order,hidden}, nav:{order,hidden}, tabs:[hrefs]}';
