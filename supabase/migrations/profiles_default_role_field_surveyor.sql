-- New profiles default to the locked Field Survey Only role.
-- The app always passes a role explicitly; this is the backstop for any insert path that omits it
-- (dashboard-created users, future code, one-off scripts). Existing profiles are untouched.
alter table public.profiles alter column role set default 'field_surveyor';
