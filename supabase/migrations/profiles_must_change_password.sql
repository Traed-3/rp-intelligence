-- APPLIED 2026-11-13 via the Supabase MCP connector.
-- Temporary passwords: an owner/manager sets a starter password and the person must pick their own at first sign-in.
alter table public.profiles add column if not exists must_change_password boolean not null default false;
comment on column public.profiles.must_change_password is 'True after an owner/manager sets a temporary password; proxy.ts sends the person to /change-password until they choose their own.';
