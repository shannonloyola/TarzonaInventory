-- Run this SQL once in Supabase SQL Editor
-- Creates secure password reset token storage

create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_password_reset_tokens_profile_id
  on public.password_reset_tokens(profile_id);

create index if not exists idx_password_reset_tokens_expires_at
  on public.password_reset_tokens(expires_at);

create index if not exists idx_password_reset_tokens_used_at
  on public.password_reset_tokens(used_at);

-- Optional hardening: keep token rows private from anon/authenticated users.
alter table public.password_reset_tokens enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'password_reset_tokens'
      and policyname = 'No direct client access to reset tokens'
  ) then
    create policy "No direct client access to reset tokens"
      on public.password_reset_tokens
      for all
      using (false)
      with check (false);
  end if;
end $$;

