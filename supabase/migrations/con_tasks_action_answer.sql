-- A plate task can carry what it takes to resolve it from the list itself:
--   action = {"type":"quote_line_price","quote_id":…,"line_id":…}   price a quote line (and the catalog) from the row
--   action = {"type":"order_email","vendor":"ICON","to":…,"cc":[…],"site":…,"takeoff":…,"draft":{…}}   draft the order mail
-- answer = what Trae typed when he closed it, kept with the row.
ALTER TABLE con_tasks
  ADD COLUMN IF NOT EXISTS action jsonb,
  ADD COLUMN IF NOT EXISTS answer text,
  ADD COLUMN IF NOT EXISTS answered_at timestamptz;
