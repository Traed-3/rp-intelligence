-- Run this in Supabase → SQL Editor (safe to re-run: everything is IF NOT EXISTS / guarded).
-- Tools & Supplies per truck/asset, with a repeat-purchase watch window per item type.
-- Every entry can also post one row to the existing `expenses` table (expense_id) so the
-- company expense reports pick up the totals without double entry.

-- ── Item types (drives the repeat-purchase window) ───────────────────────────
CREATE TABLE IF NOT EXISTS asset_tool_types (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  name                 text NOT NULL,
  kind                 text NOT NULL DEFAULT 'tool' CHECK (kind IN ('tool','supply','fluid')),
  repeat_window_months integer NOT NULL DEFAULT 12 CHECK (repeat_window_months >= 0),
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz DEFAULT now(),
  UNIQUE (company_id, name)
);
ALTER TABLE asset_tool_types ENABLE ROW LEVEL SECURITY;

-- ── Tool / supply purchases per asset ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asset_tool_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  asset_id     uuid NOT NULL REFERENCES assets ON DELETE CASCADE,
  type_id      uuid REFERENCES asset_tool_types ON DELETE SET NULL,
  item_name    text NOT NULL,
  kind         text NOT NULL DEFAULT 'tool' CHECK (kind IN ('tool','supply','fluid')),
  mileage      integer,        -- odometer at purchase (fluids → cost per mile)
  quantity     numeric(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  total_cost   numeric(10,2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  purchased_on date NOT NULL,
  vendor       text,
  receipt_url  text,
  status       text NOT NULL DEFAULT 'on_truck'
               CHECK (status IN ('on_truck','lost','replaced','consumed','removed')),
  notes        text,
  expense_id   uuid REFERENCES expenses ON DELETE SET NULL,
  created_by   uuid REFERENCES profiles ON DELETE SET NULL,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_tool_items_asset_idx      ON asset_tool_items (asset_id, purchased_on DESC);
CREATE INDEX IF NOT EXISTS asset_tool_items_asset_type_idx ON asset_tool_items (asset_id, type_id, purchased_on);
DROP TRIGGER IF EXISTS asset_tool_items_updated_at ON asset_tool_items;
CREATE TRIGGER asset_tool_items_updated_at BEFORE UPDATE ON asset_tool_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE asset_tool_items ENABLE ROW LEVEL SECURITY;

-- ── Seed item types for every company (window = months before a re-buy is flagged) ──
INSERT INTO asset_tool_types (company_id, name, kind, repeat_window_months)
SELECT c.id, t.name, t.kind, t.months
FROM companies c
CROSS JOIN (VALUES
  ('Extension cord',              'tool',   12),
  ('Drill bit',                   'tool',   12),
  ('Power drill',                 'tool',   36),
  ('Metal cutters / snips',       'tool',   24),
  ('Utility knife',               'tool',    6),
  ('Dremel / rotary tool',        'tool',   36),
  ('Hammer',                      'tool',   36),
  ('Wrench / socket set',         'tool',   36),
  ('Tape measure',                'tool',   12),
  ('Flashlight',                  'tool',   12),
  ('Ladder',                      'tool',   60),
  ('Hand tool (other)',           'tool',   12),
  ('Phone charger',               'supply',  6),
  ('Gloves',                      'supply',  3),
  ('Safety vest',                 'supply', 12),
  ('Caulk / sealant',             'supply',  3),
  ('Hardware (nuts / bolts / washers)', 'supply', 6),
  ('Sanding supplies',            'supply',  6),
  ('Blades',                      'supply',  6),
  ('Rags / towels',               'supply',  3),
  ('Supply (other)',              'supply', 12),
  -- Fluids: re-bought routinely, so no repeat alert (window 0). Tracked for cost per mile.
  ('DEF',                         'fluid',   0),
  ('Engine oil',                  'fluid',   0),
  ('Coolant',                     'fluid',   0),
  ('Washer fluid',                'fluid',   0),
  ('Transmission fluid',          'fluid',   0),
  ('Grease',                      'fluid',   0),
  ('Fluid (other)',               'fluid',   0)
) AS t(name, kind, months)
ON CONFLICT (company_id, name) DO NOTHING;

-- ── Expense categories (Truck Tools & Equipment already exists) ──
INSERT INTO expense_categories (company_id, name, context, sort_order)
SELECT c.id, n.name, 'asset', n.sort_order
FROM companies c
CROSS JOIN (VALUES ('Truck Supplies', 11), ('Truck Fluids', 12)) AS n(name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM expense_categories x
  WHERE x.company_id = c.id AND x.context = 'asset' AND x.name = n.name
);
