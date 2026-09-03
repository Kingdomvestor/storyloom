-- 0001_auth_credits_decks.sql - safe to run again in the Supabase SQL editor.

create extension if not exists pgcrypto with schema extensions;

-- profiles: 1:1 with auth.users, holds the credit balance.
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  credits    int  not null default 10 check (credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- decks: one JSON deck per row, owned by a user.
create table if not exists public.decks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null default 'Untitled',
  source     text not null default 'ai',       -- 'ai' | 'template'
  deck       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists decks_user_updated on public.decks (user_id, updated_at desc);

-- Backfill profiles for any auth users created before this migration/trigger ran.
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do update
  set email = coalesce(excluded.email, public.profiles.email),
      updated_at = now();

-- Every new signup gets a profile row at 10 credits.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        updated_at = now();
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Server-side repair hook for old projects where the trigger was missing.
create or replace function public.ensure_profile(uid uuid, user_email text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare balance int;
begin
  insert into public.profiles (id, email)
  values (uid, user_email)
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        updated_at = now()
  returning credits into balance;
  return balance;
end;
$$;

-- Atomic spend: no check-then-decrement race.
-- Returns the new balance, or NULL when the user is out.
create or replace function public.spend_credit(uid uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare balance int;
begin
  insert into public.profiles (id) values (uid) on conflict (id) do nothing;

  update public.profiles
  set credits = credits - 1,
      updated_at = now()
  where id = uid and credits > 0
  returning credits into balance;

  return balance;
end;
$$;

-- Mirror, used to refund a failed generation.
create or replace function public.add_credit(uid uuid)
returns int
language sql
security definer
set search_path = public
as $$
  update public.profiles set credits = credits + 1, updated_at = now()
  where id = uid
  returning credits;
$$;

-- RLS: defense in depth. Express (service-role) is the real gate and bypasses
-- this, but if the anon key ever touched these tables directly, rows stay private.
alter table public.profiles enable row level security;
alter table public.decks    enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "own decks" on public.decks;
create policy "own decks" on public.decks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
