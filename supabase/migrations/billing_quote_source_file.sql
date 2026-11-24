-- Quotes imported from a REV19 workbook remember which file they came from.
ALTER TABLE con_quotes ADD COLUMN IF NOT EXISTS source_file text;
