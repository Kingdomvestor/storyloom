-- Public brand logos are referenced by saved decks and rendered by Puppeteer.
-- Keep each account's uploads in its own folder; anyone can read published
-- logos, while only the owning authenticated account can upload or delete them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-logos',
  'brand-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Brand logos are publicly readable" on storage.objects;
create policy "Brand logos are publicly readable"
  on storage.objects for select
  to public
  using (bucket_id = 'brand-logos');

drop policy if exists "Users upload their own brand logos" on storage.objects;
create policy "Users upload their own brand logos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'brand-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete their own brand logos" on storage.objects;
create policy "Users delete their own brand logos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'brand-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
