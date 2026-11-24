-- Flat per-visit Trip Fee schedule (separate from the existing hourly
-- trip_rate/trip_mode, which stays as-is for live service-ticket invoicing).
-- Per Trae's contract figures (2026-09-25): 7-Eleven $102.50; Sunoco $80
-- regular / $120 for P1 (after-hours/weekends); Independent $110.
-- Wawa has NO rate-card row yet — its hourly labor rate is unknown and must
-- be asked, not invented, so no Wawa row is added here.
alter table billing_rate_cards
  add column if not exists trip_fee_flat numeric,
  add column if not exists trip_fee_flat_afterhours numeric;

comment on column billing_rate_cards.trip_fee_flat is
  'Flat per-visit trip fee (contract Trip Fee schedule), independent of the hourly trip_rate/trip_mode columns used by live service-ticket invoicing.';
comment on column billing_rate_cards.trip_fee_flat_afterhours is
  'Flat per-visit trip fee for after-hours/weekend visits, where the contract sets a different rate (e.g. Sunoco P1).';

update billing_rate_cards set trip_fee_flat = 102.50 where name = '7-Eleven';
update billing_rate_cards set trip_fee_flat = 80.00, trip_fee_flat_afterhours = 120.00 where name = 'Sunoco';
update billing_rate_cards set trip_fee_flat = 110.00 where name = 'Independent';
