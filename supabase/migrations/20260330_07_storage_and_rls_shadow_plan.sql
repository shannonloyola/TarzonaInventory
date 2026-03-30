-- DRAFT ONLY - DO NOT APPLY WITHOUT SQL REVIEW
-- Phase 4 prep: Storage and strict RLS shadow plan (non-enforcing)
-- Created: 2026-03-30

-- This migration intentionally avoids changing active storage/object policies.
-- It provides review artifacts only, so user-visible behavior stays unchanged.

CREATE OR REPLACE VIEW public.security_hardening_shadow_plan AS
SELECT *
FROM (
  VALUES
    ('products', 'Restrict write operations to admin/staff policy functions in strict mode'),
    ('inventory_snapshot', 'Allow writes only to authorized roles and valid product lifecycle states'),
    ('inventory_transactions', 'Insert-only policy path with select visibility by role'),
    ('staff_permissions', 'Admin-only write; controlled read for active staff context'),
    ('profiles', 'Self-read + admin-read/write boundaries'),
    ('storage.objects/product-images', 'Remove public write/delete and scope by role/path')
) AS t(target_object, planned_strict_policy_change);

-- Planned strict-policy SQL examples (commented by design; not active):
-- DROP POLICY IF EXISTS "Public upload product images" ON storage.objects;
-- DROP POLICY IF EXISTS "Public update product images" ON storage.objects;
-- DROP POLICY IF EXISTS "Public delete product images" ON storage.objects;
-- CREATE POLICY product_images_write_policy ON storage.objects FOR INSERT
--   WITH CHECK (bucket_id = 'product-images' AND public.current_actor_is_admin());
