INSERT INTO part_price_history (part_id, kind, price, vendor, reference, observed_on, source_note)
SELECT id, CASE cost_source WHEN 'receipt' THEN 'cost_receipt' WHEN 'vendor_quote' THEN 'cost_vendor_quote' WHEN 'web' THEN 'cost_web' ELSE 'cost_book' END, unit_cost, cost_vendor, cost_invoice_ref, cost_date, notes
FROM parts WHERE company_id='f3d06874-2e21-40f3-a7d0-a1d86bad02e7' AND unit_cost IS NOT NULL AND sku IN ('REV19_LIBRARY','PRICE_BOOK','WEB_VERIFIED');
INSERT INTO part_price_history (part_id, kind, price, reference, observed_on, source_note)
SELECT id, 'sell_billed', sell_price, 'RPS service invoices Mar-Sep 2026', cost_date, notes FROM parts WHERE company_id='f3d06874-2e21-40f3-a7d0-a1d86bad02e7' AND sku='SVC_INVOICES_2026' AND sell_price IS NOT NULL;
