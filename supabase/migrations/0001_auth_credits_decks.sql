-- 0001_auth_credits_decks.sql — run once in the Supabase SQL editor.

-- profiles: 1:1 with auth.users, holds the credit balance.
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  credits    int  not null default 10 check (credits >= 0),
  created_at timestamptz not null default now()
);

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

-- every new signup gets a profile row at 10 credits.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- atomic spend: one statement, no check-then-decrement race.
-- returns the new balance, or NULL (no row) when the user is out.
create or replace function public.spend_credit(uid uuid)
returns int language sql security definer as $$
  update public.profiles set credits = credits - 1
  where id = uid and credits > 0
  returning credits;
$$;

-- mirror, used to refund a failed generation.
create or replace function public.add_credit(uid uuid)
returns int language sql security definer as $$
  update public.profiles set credits = credits + 1
  where id = uid
  returning credits;
$$;

-- RLS: defense in depth. Express (service-role) is the real gate and bypasses
-- this, but if the anon key ever touched these tables directly, rows stay private.
alter table public.profiles enable row level security;
alter table public.decks    enable row level security;

create policy "own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "own decks" on public.decks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
