-- Quote numbers are Q<year>-<site>, then A, B … Z, then AA, BB … for further
-- quotes on the same site in the same year. The site key is the site number
-- with the punctuation stripped (SU-13400 → SU13400, IP-1234 → IP1234, 40312).
-- Replaces the sequential Q-YYYY-0001 trigger (2026-09-21, per Trae).

CREATE OR REPLACE FUNCTION con_quote_suffix(n integer) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN n <= 0 THEN ''
    WHEN n <= 26 THEN chr(64 + n)
    ELSE repeat(chr(64 + ((n - 27) % 26) + 1), 2 + (n - 27) / 26)
  END
$$;

CREATE OR REPLACE FUNCTION con_set_quote_number() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  yr   text := to_char(COALESCE(NEW.proposal_date, current_date), 'YYYY');
  site text := upper(regexp_replace(COALESCE(NULLIF(NEW.site_number, ''), NULLIF(NEW.store_label, ''), 'NOSITE'), '[^A-Za-z0-9]', '', 'g'));
  base text;
  n    integer;
BEGIN
  IF NEW.quote_number IS NULL OR NEW.quote_number = '' THEN
    base := 'Q' || yr || '-' || site;
    PERFORM pg_advisory_xact_lock(hashtext('con_quote_' || NEW.company_id::text || '_' || base));
    SELECT count(*) INTO n FROM con_quotes
     WHERE company_id = NEW.company_id AND quote_number ~ ('^' || base || '[A-Z]*$');
    NEW.quote_number := base || con_quote_suffix(n);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS con_quotes_set_number ON con_quotes;
CREATE TRIGGER con_quotes_set_number BEFORE INSERT ON con_quotes
  FOR EACH ROW EXECUTE FUNCTION con_set_quote_number();

-- Renumber what was issued under the old scheme, oldest first, so the suffix order is by creation.
DO $$
DECLARE r record; base text; n integer;
BEGIN
  FOR r IN SELECT id, company_id, proposal_date, created_at, site_number, store_label FROM con_quotes
            WHERE quote_number ~ '^Q-\d{4}-\d{4}$' ORDER BY created_at LOOP
    base := 'Q' || to_char(COALESCE(r.proposal_date, r.created_at::date), 'YYYY') || '-'
         || upper(regexp_replace(COALESCE(NULLIF(r.site_number, ''), NULLIF(r.store_label, ''), 'NOSITE'), '[^A-Za-z0-9]', '', 'g'));
    SELECT count(*) INTO n FROM con_quotes WHERE company_id = r.company_id AND quote_number ~ ('^' || base || '[A-Z]*$');
    UPDATE con_quotes SET quote_number = base || con_quote_suffix(n) WHERE id = r.id;
  END LOOP;
END $$;
