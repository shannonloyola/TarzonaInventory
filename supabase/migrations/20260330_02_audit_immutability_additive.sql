-- DRAFT ONLY - DO NOT APPLY WITHOUT SQL REVIEW
-- Phase 2.2: Immutable / insert-only audit log hardening
-- Created: 2026-03-30

-- 1) Block UPDATE/DELETE at table level via trigger
CREATE OR REPLACE FUNCTION public.block_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'inventory_transactions is immutable (insert-only)';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_inventory_transactions_update ON public.inventory_transactions;
DROP TRIGGER IF EXISTS trg_block_inventory_transactions_delete ON public.inventory_transactions;

CREATE TRIGGER trg_block_inventory_transactions_update
BEFORE UPDATE ON public.inventory_transactions
FOR EACH ROW
EXECUTE FUNCTION public.block_audit_mutation();

CREATE TRIGGER trg_block_inventory_transactions_delete
BEFORE DELETE ON public.inventory_transactions
FOR EACH ROW
EXECUTE FUNCTION public.block_audit_mutation();

-- 2) RLS posture draft (tighten in Phase 3 rollout)
-- Keep existing select policy compatibility, but force write path to INSERT-only.
-- These policies are draft-only and should be reviewed with current auth model first.

-- Example draft policy sequence:
-- DROP POLICY IF EXISTS "Allow all on inventory_transactions" ON public.inventory_transactions;
-- CREATE POLICY inventory_transactions_select_policy
--   ON public.inventory_transactions FOR SELECT
--   USING (true);
-- CREATE POLICY inventory_transactions_insert_policy
--   ON public.inventory_transactions FOR INSERT
--   WITH CHECK (true);
-- (No UPDATE/DELETE policies on purpose)
