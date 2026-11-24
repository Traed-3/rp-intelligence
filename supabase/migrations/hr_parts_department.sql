-- 2026-11-05: Parts Department is its own department (Christine Baker), not Mechanics / Warehouse.
alter table hr_employees drop constraint if exists hr_employees_department_check;
alter table hr_employees add constraint hr_employees_department_check
  check (department in ('construction','service','mechanics','parts','office','management'));

-- 2026-11-05: RPS does not hire or require CDL drivers (DOT drivers of non-CDL trucks over 10,001 lb only).
update hr_requirement_types set is_active = false where applies_to = 'cdl';
update hr_employees set is_cdl = false where is_cdl;
update hr_requirement_types set regulation = 'Company policy',
  description = 'Driver''s signed receipt of the company drug & alcohol policy (company policy — RPS does not employ CDL drivers, so FMCSA Part 382 testing does not apply).'
  where name = 'Drug and Alcohol Policy Acknowledgement Form';
