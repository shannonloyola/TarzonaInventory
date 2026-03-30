-- DRAFT ONLY - DO NOT APPLY WITHOUT SQL REVIEW
-- Phase 2.4: Admin password re-verification support objects
-- Created: 2026-03-30

-- This is additive scaffolding for future server-side enforcement.
-- Current app still performs client-side password re-verification.

CREATE TABLE IF NOT EXISTS public.admin_reauth_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action_scope text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_admin_reauth_events_profile_scope
  ON public.admin_reauth_events (admin_profile_id, action_scope, expires_at DESC);

-- Optional helper function for later policy checks.
CREATE OR REPLACE FUNCTION public.has_recent_admin_reauth(
  p_admin_profile_id uuid,
  p_action_scope text,
  p_grace_interval interval DEFAULT interval '10 minutes'
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_reauth_events e
    WHERE e.admin_profile_id = p_admin_profile_id
      AND e.action_scope = p_action_scope
      AND e.verified_at >= (now() - p_grace_interval)
      AND e.expires_at > now()
  );
$$;
