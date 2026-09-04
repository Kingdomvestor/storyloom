-- 0002_brands_plan.sql — safe to run again in the Supabase SQL editor.

-- plan: which tier a user is on. The only thing it gates today is whether the
-- watermark may be switched off, and that is enforced server-side at export
-- time (src/server.js), not in the browser where the toggle lives.
alter table public.profiles add column if not exists plan text not null default 'free';
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check check (plan in ('free', 'pro'));

-- brands: a reusable footer identity, so it is authored once instead of retyped
-- into every deck. The deck still carries a resolved `brand` object (the schema
-- says so, and the renderer reads it) — this table is where it comes from.
--
-- No length checks here on purpose: schemas/carousel.schema.json owns the caps
-- (name 40, handle 30) and brands.js slices to them. A second copy in SQL is a
-- second thing to change when the schema moves.
create table if not exists public.brands (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null default '',
  handle     text not null default '',
  logo_url   text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists brands_user_updated on public.brands (user_id, updated_at desc);

-- At most one default per user. A partial unique index makes that a database
-- fact rather than a convention the application has to remember every time.
create unique index if not exists brands_one_default_per_user
  on public.brands (user_id) where is_default;

-- RLS: defense in depth, same as decks. Express (service-role) is the real gate
-- and bypasses this, but a stray anon-key query still sees only its own rows.
alter table public.brands enable row level security;
drop policy if exists "own brands" on public.brands;
create policy "own brands" on public.brands
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
