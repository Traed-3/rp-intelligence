-- APPLIED to zktmhxheouwbyupeizjq on 2026-11-11 (service dispatch audit).
-- A call cleared from the board as "Completed" that later goes back to an open status (a new return-trip ticket) must
-- reappear on the board instead of changing status invisibly while archived. Only rows archived by that cleanup.
CREATE OR REPLACE FUNCTION public.svc_wo_reopen_unarchive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.archived AND NEW.archived AND OLD.status = 'completed' AND NEW.status <> 'completed'
     AND OLD.archived_reason LIKE 'Completed - cleared from the active dashboard%' THEN
    NEW.archived := false; NEW.archived_at := NULL; NEW.archived_reason := NULL; NEW.archived_by := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS svc_wo_reopen_unarchive ON public.svc_work_orders;
CREATE TRIGGER svc_wo_reopen_unarchive BEFORE UPDATE OF status ON public.svc_work_orders
  FOR EACH ROW EXECUTE FUNCTION public.svc_wo_reopen_unarchive();
