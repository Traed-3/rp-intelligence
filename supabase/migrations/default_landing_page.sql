-- Lets each employee's login send them straight to the dashboard they
-- actually use (e.g. Service Dispatch for Dave/Chris/Starsky) instead of
-- always landing on the company-wide overview. NULL = the normal default
-- (/dashboard).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS default_landing_page text;

COMMENT ON COLUMN profiles.default_landing_page IS
  'Path (e.g. /service, /maintenance) a user is redirected to right after login. NULL falls back to /dashboard.';
