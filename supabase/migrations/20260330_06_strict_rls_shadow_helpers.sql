-- DRAFT ONLY - DO NOT APPLY WITHOUT SQL REVIEW
-- Phase 4 prep: RLS helper functions for strict-policy rollout (additive)
-- Created: 2026-03-30

-- Returns the current actor profile id from auth context.
-- Supports either profiles.id = auth.uid() or profiles.auth_user_id = auth.uid().
CREATE OR REPLACE FUNCTION public.current_actor_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT p.id
  FROM public.profiles p
  WHERE p.id = auth.uid()
     OR p.auth_user_id = auth.uid()
  ORDER BY CASE WHEN p.id = auth.uid() THEN 0 ELSE 1 END
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_actor_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT p.role
  FROM public.profiles p
  WHERE p.id = public.current_actor_profile_id()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_actor_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(public.current_actor_role() = 'admin', false);
$$;

CREATE OR REPLACE FUNCTION public.current_actor_has_staff_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    CASE p_permission
      WHEN 'can_add_product' THEN COALESCE(sp.can_add_product, false)
      WHEN 'can_delete_product' THEN COALESCE(sp.can_delete_product, false)
      WHEN 'can_edit_product' THEN COALESCE(sp.can_edit_product, false)
      WHEN 'can_archive_product' THEN COALESCE(sp.can_archive_product, false)
      WHEN 'can_grant_admin' THEN COALESCE(sp.can_grant_admin, false)
      ELSE false
    END
  FROM public.staff_permissions sp
  WHERE sp.staff_profile_id = public.current_actor_profile_id()
  LIMIT 1;
$$;

-- Optional read-only summary view for policy debugging in staging.
CREATE OR REPLACE VIEW public.current_actor_security_context AS
SELECT
  auth.uid() AS auth_uid,
  public.current_actor_profile_id() AS profile_id,
  public.current_actor_role() AS role,
  public.current_actor_is_admin() AS is_admin;
