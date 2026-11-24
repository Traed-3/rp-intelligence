-- DQF: "no DOT-regulated employer in the 3 years before hire" check mark (49 CFR 391.23(a)(2) note to file).
-- APPLIED 2026-11-16 via the Supabase MCP connector.
alter table hr_employees
  add column if not exists no_prior_dot_employer boolean not null default false,
  add column if not exists no_prior_dot_noted_at date,
  add column if not exists no_prior_dot_noted_by text;
