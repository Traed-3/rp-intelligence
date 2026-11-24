-- New roles: parts_manager (Christine Baker) and construction_admin (Peggy Wilmoth). APPLIED 2026-11-06.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role = any (array[
  'owner','manager','shop_manager','shop_employee','mechanic','service_tech','construction_tech','office_staff',
  'viewer','construction_manager','estimator','field_surveyor','construction_admin','parts_manager']));

-- Construction RLS helpers mirror CON_READ_ROLES / CON_WRITE_ROLES in lib/construction.ts.
create or replace function public.con_can_read() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from profiles where id = auth.uid()
    and role in ('owner','manager','construction_manager','construction_admin','estimator','viewer'))
$$;
create or replace function public.con_can_write() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from profiles where id = auth.uid()
    and role in ('owner','manager','construction_manager','construction_admin','estimator'))
$$;
