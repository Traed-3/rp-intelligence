-- RPS is under service contract with Sunoco, 7-Eleven and Wawa: every work order
-- is accepted the moment it is dispatched. Retire the New / Accepted / En Route
-- states so the board shows only what a dispatcher can act on.
UPDATE svc_work_orders SET status = 'dispatched'
 WHERE status IN ('new', 'accepted');
UPDATE svc_work_orders SET status = 'on_site'
 WHERE status = 'en_route';
ALTER TABLE svc_work_orders ALTER COLUMN status SET DEFAULT 'dispatched';
