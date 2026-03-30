-- DRAFT ONLY - DO NOT APPLY WITHOUT SQL REVIEW
-- Phase 2.1: Additive data integrity constraints for inventory operations
-- Created: 2026-03-30

-- 1) Non-negative quantity checks (additive)
ALTER TABLE public.inventory_snapshot
  ADD CONSTRAINT inventory_snapshot_beginning_qty_nonnegative_chk
  CHECK (beginning_qty >= 0) NOT VALID;

ALTER TABLE public.inventory_snapshot
  ADD CONSTRAINT inventory_snapshot_stock_in_qty_nonnegative_chk
  CHECK (stock_in_qty >= 0) NOT VALID;

ALTER TABLE public.inventory_snapshot
  ADD CONSTRAINT inventory_snapshot_stock_out_qty_nonnegative_chk
  CHECK (stock_out_qty >= 0) NOT VALID;

ALTER TABLE public.inventory_snapshot
  ADD CONSTRAINT inventory_snapshot_end_qty_nonnegative_chk
  CHECK (end_qty >= 0) NOT VALID;

-- 2) Stock math checks (total = beg + in, end = total - out)
-- Equivalent expression: end_qty = beginning_qty + stock_in_qty - stock_out_qty
ALTER TABLE public.inventory_snapshot
  ADD CONSTRAINT inventory_snapshot_stock_math_chk
  CHECK (end_qty = (beginning_qty + stock_in_qty - stock_out_qty)) NOT VALID;

-- 3) No future snapshot dates
CREATE OR REPLACE FUNCTION public.enforce_inventory_snapshot_no_future_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.snapshot_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Future snapshot dates are not allowed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_snapshot_no_future_date ON public.inventory_snapshot;

CREATE TRIGGER trg_inventory_snapshot_no_future_date
BEFORE INSERT OR UPDATE ON public.inventory_snapshot
FOR EACH ROW
EXECUTE FUNCTION public.enforce_inventory_snapshot_no_future_date();

-- 4) Quantity integer hardening (safety if column types ever drift)
CREATE OR REPLACE FUNCTION public.enforce_inventory_snapshot_integer_quantities()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.beginning_qty <> FLOOR(NEW.beginning_qty) OR
     NEW.stock_in_qty <> FLOOR(NEW.stock_in_qty) OR
     NEW.stock_out_qty <> FLOOR(NEW.stock_out_qty) OR
     NEW.end_qty <> FLOOR(NEW.end_qty) THEN
    RAISE EXCEPTION 'Inventory quantities must be integers';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_snapshot_integer_quantities ON public.inventory_snapshot;

CREATE TRIGGER trg_inventory_snapshot_integer_quantities
BEFORE INSERT OR UPDATE ON public.inventory_snapshot
FOR EACH ROW
EXECUTE FUNCTION public.enforce_inventory_snapshot_integer_quantities();

-- NOTE: Apply validation in a controlled rollout window after checking existing data.
-- ALTER TABLE public.inventory_snapshot VALIDATE CONSTRAINT inventory_snapshot_beginning_qty_nonnegative_chk;
-- ALTER TABLE public.inventory_snapshot VALIDATE CONSTRAINT inventory_snapshot_stock_in_qty_nonnegative_chk;
-- ALTER TABLE public.inventory_snapshot VALIDATE CONSTRAINT inventory_snapshot_stock_out_qty_nonnegative_chk;
-- ALTER TABLE public.inventory_snapshot VALIDATE CONSTRAINT inventory_snapshot_end_qty_nonnegative_chk;
-- ALTER TABLE public.inventory_snapshot VALIDATE CONSTRAINT inventory_snapshot_stock_math_chk;
