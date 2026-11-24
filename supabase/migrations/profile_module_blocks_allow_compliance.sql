-- Allow per-user blocking of the DQF & Certifications module (lib/modules.ts key 'compliance').
-- The check constraint predated the compliance module, so Settings -> Users could not save a DQF block.
alter table public.profile_module_blocks drop constraint profile_module_blocks_module_check;
alter table public.profile_module_blocks add constraint profile_module_blocks_module_check
  check (module = any (array['maintenance','shop','tickets','construction','service_dispatch','billing','inventory','reports_payroll','compliance']));
