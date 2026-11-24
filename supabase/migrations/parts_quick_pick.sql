-- Rate-card items (concrete, equipment, disposables, subs, permits, lodging, mobilization)
-- show up as one-click chips in the quote builder.
ALTER TABLE parts ADD COLUMN IF NOT EXISTS quick_pick boolean NOT NULL DEFAULT false;
UPDATE parts SET quick_pick = true WHERE sku = 'REV19_RATE_CARD';
