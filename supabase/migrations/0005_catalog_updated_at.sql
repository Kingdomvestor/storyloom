alter table public.starter_templates
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists draft jsonb
    check (draft is null or jsonb_typeof(draft) = 'object');

alter table public.styles
  add column if not exists draft jsonb
    check (draft is null or jsonb_typeof(draft) = 'object');

create index if not exists starter_templates_status_updated
  on public.starter_templates (status, updated_at desc);
