-- Admin-authored starter decks. Deck JSON is validated by the application schema.

create table if not exists public.starter_templates (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{1,40}$'),
  description text not null default '' check (char_length(description) <= 220),
  status      text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  deck        jsonb not null check (jsonb_typeof(deck) = 'object'),
  created_at  timestamptz not null default now()
);

create index if not exists starter_templates_published_created
  on public.starter_templates (created_at desc)
  where status = 'published';

alter table public.starter_templates enable row level security;

drop policy if exists "published starter templates read" on public.starter_templates;
create policy "published starter templates read" on public.starter_templates
  for select using (
    status = 'published'
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  );

drop policy if exists "admin manage starter templates" on public.starter_templates;
create policy "admin manage starter templates" on public.starter_templates
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  );
