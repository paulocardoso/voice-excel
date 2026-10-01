-- WorkVoice stores derived learning data only. Raw audio is intentionally not
-- represented in this schema or in Supabase Storage.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  target_variety text not null default 'en-US' check (target_variety in ('en-US', 'en-GB')),
  goals jsonb not null default '[]'::jsonb,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  baseline jsonb,
  privacy_notice_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assessment_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id text not null,
  target_variety text not null check (target_variety in ('en-US', 'en-GB')),
  transcript text not null,
  scores jsonb not null,
  flagged_words jsonb not null default '[]'::jsonb,
  coaching_tip text not null,
  next_drill text not null,
  provider text not null default 'azure-speech',
  created_at timestamptz not null default now()
);

create index if not exists assessment_results_user_created_idx
  on public.assessment_results (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.assessment_results enable row level security;

create policy "users can read their own profile"
  on public.profiles for select using ((select auth.uid()) = id);

create policy "users can create their own profile"
  on public.profiles for insert with check ((select auth.uid()) = id);

create policy "users can update their own profile"
  on public.profiles for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "users can read their own assessment results"
  on public.assessment_results for select using ((select auth.uid()) = user_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();
