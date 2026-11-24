-- 2026-11-05: let specific people use DQF & Certs regardless of their app role (Peggy Wilmoth is a "viewer"
-- but keeps the driver files). Picked in DQF → Notices & settings → "Who else can use DQF & Certs".
alter table hr_compliance_settings add column if not exists access_profile_ids uuid[] not null default '{}';
