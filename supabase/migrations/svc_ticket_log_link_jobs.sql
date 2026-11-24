-- Ticket log: tie tickets to their call / construction job by the work order number written on the ticket.
-- APPLIED 2026-11-13 via Supabase MCP. Runs hourly (pg_cron 'svc-ticket-link-jobs').
-- (The one-time catch-up job 'svc-ticket-reread' / svc_ticket_reread_tick() from the same day removes itself when done.)

CREATE OR REPLACE FUNCTION public.svc_ticket_link_jobs() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := 0; m int;
BEGIN
  -- A ticket whose work order number is on a construction job belongs to that job.
  UPDATE svc_work_order_documents d SET con_job_id = j.id
    FROM con_jobs j
   WHERE d.con_job_id IS NULL AND j.company_id = d.company_id
     AND d.ticket_wo_number ~* '^(WOT|FWKD|INC)\d{6,9}$'
     AND position(upper(d.ticket_wo_number) in upper(coalesce(j.work_order_number, ''))) > 0;
  GET DIAGNOSTICS m = ROW_COUNT; n := n + m;
  -- ...and to its service call, when the email subject did not carry the number.
  UPDATE svc_work_order_documents d SET work_order_id = w.id
    FROM svc_work_orders w
   WHERE d.work_order_id IS NULL AND w.company_id = d.company_id
     AND d.ticket_wo_number ~* '^(WOT|FWKD|INC)\d{6,9}$'
     AND (upper(w.portal_wo_number) = upper(d.ticket_wo_number) OR upper(w.incident_number) = upper(d.ticket_wo_number));
  GET DIAGNOSTICS m = ROW_COUNT; n := n + m;
  -- copies follow their original
  UPDATE svc_work_order_documents c
     SET work_order_id = coalesce(c.work_order_id, o.work_order_id), con_job_id = coalesce(c.con_job_id, o.con_job_id)
    FROM svc_work_order_documents o
   WHERE c.duplicate_of = o.id
     AND ((c.work_order_id IS NULL AND o.work_order_id IS NOT NULL) OR (c.con_job_id IS NULL AND o.con_job_id IS NOT NULL));
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.svc_ticket_link_jobs() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('svc-ticket-link-jobs', '37 * * * *', $$select public.svc_ticket_link_jobs()$$);
