-- Private feedback submissions. Writes and admin operations go through the
-- server's service-role API; RLS protects direct authenticated-client access.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  category text not null
    check (category in ('suggestion', 'bug', 'question', 'other')),
  message text not null
    check (char_length(btrim(message)) between 1 and 4000),
  context_page text
    check (context_page is null or char_length(context_page) <= 200),
  deck_id uuid references public.decks(id) on delete set null,
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'planned', 'resolved', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feedback_created_at
  on public.feedback (created_at desc);
create index if not exists feedback_user_created_at
  on public.feedback (user_id, created_at desc);

alter table public.feedback enable row level security;
revoke insert, update, delete on public.feedback from anon, authenticated;
grant select on public.feedback to authenticated;
grant all on public.feedback to service_role;

drop policy if exists "Users read their own feedback" on public.feedback;
create policy "Users read their own feedback"
  on public.feedback for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Admins read all feedback" on public.feedback;
create policy "Admins read all feedback"
  on public.feedback for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );

drop policy if exists "Admins update feedback" on public.feedback;
create policy "Admins update feedback"
  on public.feedback for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.is_admin = true
    )
  );
