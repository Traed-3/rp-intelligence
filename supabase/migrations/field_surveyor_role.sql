-- Field Survey Only role (Trae 2026-10-02, for Glen Blankenship): a login that can use the Field Surveys screens and
-- nothing else. The app layer (proxy.ts) allow-lists /construction/surveys; this migration is the database layer so the
-- role also cannot read other tables straight through the Supabase REST API with its own session token.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role = any (array[
  'owner','manager','shop_manager','shop_employee','mechanic','service_tech','construction_tech',
  'office_staff','viewer','construction_manager','estimator','field_surveyor']));

-- True only for a signed-in field_surveyor. SECURITY DEFINER because profiles has RLS with no policies; reads the
-- role from the table (never from the JWT, whose user_metadata the user can edit).
create or replace function public.is_field_surveyor() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'field_surveyor')
$$;
revoke all on function public.is_field_surveyor() from public, anon;
grant execute on function public.is_field_surveyor() to authenticated;

-- RESTRICTIVE policies are AND-ed with every permissive policy, so this one blanket denies the role on every table
-- that has policies. Tables with RLS on and no policies already deny everyone but the service role. The Field Survey
-- screens read and write through the server (service role), so they are unaffected.
-- RE-RUN THIS LOOP whenever a new table with policies is added.
do $$
declare r record;
begin
  for r in select distinct tablename from pg_policies where schemaname = 'public' and policyname <> 'deny_field_surveyor' loop
    execute format('drop policy if exists deny_field_surveyor on public.%I', r.tablename);
    execute format('create policy deny_field_surveyor on public.%I as restrictive for all to authenticated using (not public.is_field_surveyor()) with check (not public.is_field_surveyor())', r.tablename);
  end loop;
end $$;
