-- Published template content is immutable. Re-publishing an edited template
-- creates a new version in the same family and makes it the current gallery
-- choice; decks already copied from earlier versions are unaffected.

alter table public.starter_templates
  add column if not exists family_id uuid,
  add column if not exists version integer not null default 1,
  add column if not exists is_current boolean not null default true,
  add column if not exists published_at timestamptz;

update public.starter_templates
set family_id = id
where family_id is null;

alter table public.starter_templates
  alter column family_id set default gen_random_uuid(),
  alter column family_id set not null;

update public.starter_templates
set published_at = coalesce(updated_at, created_at, now())
where status in ('published', 'archived') and published_at is null;

alter table public.starter_templates
  drop constraint if exists starter_templates_slug_key;

create unique index if not exists starter_templates_family_version
  on public.starter_templates (family_id, version);

create unique index if not exists starter_templates_current_family
  on public.starter_templates (family_id)
  where is_current = true;

create unique index if not exists starter_templates_current_slug
  on public.starter_templates (slug)
  where is_current = true;

create or replace function public.publish_starter_template_version(
  p_id uuid,
  p_name text,
  p_slug text,
  p_description text,
  p_deck jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  previous public.starter_templates%rowtype;
  next_version public.starter_templates%rowtype;
begin
  select * into previous
  from public.starter_templates
  where id = p_id and is_current = true
  for update;

  if not found then
    raise exception 'Current template version not found' using errcode = 'P0002';
  end if;

  if previous.status not in ('published', 'archived') then
    raise exception 'Only a published or archived template can create a successor'
      using errcode = '22023';
  end if;

  update public.starter_templates
  set is_current = false
  where id = previous.id;

  insert into public.starter_templates (
    family_id, version, is_current, created_by, name, slug, description,
    status, deck, draft, published_at
  ) values (
    previous.family_id, previous.version + 1, true, p_created_by, p_name, p_slug,
    p_description, 'published', p_deck, null, now()
  )
  returning * into next_version;

  return to_jsonb(next_version);
end;
$$;

revoke all on function public.publish_starter_template_version(uuid, text, text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.publish_starter_template_version(uuid, text, text, text, jsonb, uuid)
  to service_role;
