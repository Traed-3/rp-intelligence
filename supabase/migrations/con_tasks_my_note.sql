-- My Plate: a personal progress note on each card (Trae 11/12/26). APPLIED 2026-11-12 via the Supabase MCP connector.
alter table public.con_tasks add column if not exists my_note text, add column if not exists my_note_at timestamptz;
comment on column public.con_tasks.my_note is 'The plate owner''s own progress note ("where I am with it"). Only a person writes it; routines never touch it.';
