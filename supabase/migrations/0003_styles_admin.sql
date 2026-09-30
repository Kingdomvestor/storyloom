-- 0003_styles_admin.sql — safe to run again in the Supabase SQL editor.
--
-- Admin-only style registry. The renderer stays generic; the database stores the
-- approved visual settings for a style family. This keeps theme control in data
-- rather than hard-coded in the repo while preserving a curated library.

alter table public.profiles add column if not exists is_admin boolean not null default false;

create table if not exists public.styles (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid references auth.users(id) on delete set null,
  name        text not null,
  slug        text not null unique,
  description text not null default '',
  status      text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  is_system   boolean not null default false,
  settings    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists styles_status_updated on public.styles (status, updated_at desc);

alter table public.styles enable row level security;

-- Everyone can read published styles. The app-level auth gate still enforces
-- signed-in access for the list endpoint; this is the DB-level safeguard.
drop policy if exists "published styles read" on public.styles;
create policy "published styles read" on public.styles
  for select using (status = 'published' or is_system or auth.uid() = created_by);

-- Only admins may write styles. This is a database fact, and the server checks it
-- again before writing so a mistaken client-side access path cannot bypass it.
drop policy if exists "admin manage styles" on public.styles;
create policy "admin manage styles" on public.styles
  for all
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin = true
  ));
