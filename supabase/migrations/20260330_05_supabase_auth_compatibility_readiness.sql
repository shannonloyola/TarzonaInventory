-- DRAFT ONLY - DO NOT APPLY WITHOUT SQL REVIEW
-- Phase 4 prep: Supabase Auth compatibility linkage (additive)
-- Created: 2026-03-30

-- Optional linkage column for gradual migration from legacy user_accounts to auth.users.
-- Keeps current profile.id contract intact while allowing explicit auth user mapping.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auth_user_id uuid;

-- Unique mapping when populated.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_auth_user_id_unique
  ON public.profiles (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- Add FK only if auth.users table exists and constraint not yet present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'auth'
      AND table_name = 'users'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_auth_user_id_fkey'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_auth_user_id_fkey
      FOREIGN KEY (auth_user_id)
      REFERENCES auth.users(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

-- Read-only helper view for migration tracking.
CREATE OR REPLACE VIEW public.profiles_auth_linkage_status AS
SELECT
  p.id AS profile_id,
  p.username,
  p.role,
  p.auth_user_id,
  CASE
    WHEN p.auth_user_id IS NULL THEN 'unlinked'
    ELSE 'linked'
  END AS linkage_status
FROM public.profiles p;
