-- Change orders (con_quotes.kind='change_order' + parent_quote_id) already
-- exist as columns from billing_rev19_module.sql; this just indexes the FK
-- now that createChangeOrder() actually uses it.
CREATE INDEX IF NOT EXISTS con_quotes_parent_quote_idx ON con_quotes (parent_quote_id);
