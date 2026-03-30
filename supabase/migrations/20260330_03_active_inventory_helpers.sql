-- DRAFT ONLY - DO NOT APPLY WITHOUT SQL REVIEW
-- Phase 2.3: Active inventory helpers (archived-product exclusion)
-- Created: 2026-03-30

-- Canonical active snapshot view used by app/services/reporting.
CREATE OR REPLACE VIEW public.active_inventory_snapshot AS
SELECT
  s.id,
  s.product_id,
  s.snapshot_date,
  s.beginning_qty,
  s.stock_in_qty,
  s.stock_out_qty,
  s.end_qty,
  s.updated_at
FROM public.inventory_snapshot s
JOIN public.products p
  ON p.id = s.product_id
WHERE COALESCE(p.archived, false) = false;

-- Optional helper view for low-stock threshold checks:
-- low stock when end <= 20% of beg and beg > 0
CREATE OR REPLACE VIEW public.active_low_stock_snapshot AS
SELECT
  s.*,
  (s.beginning_qty * 0.2)::numeric AS low_stock_threshold
FROM public.active_inventory_snapshot s
WHERE s.beginning_qty > 0
  AND s.end_qty <= (s.beginning_qty * 0.2);

-- Optional index recommendation (review on large datasets only):
-- CREATE INDEX IF NOT EXISTS idx_inventory_snapshot_snapshot_date
--   ON public.inventory_snapshot (snapshot_date);
