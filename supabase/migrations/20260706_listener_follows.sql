-- listener_follows: which users follow which Listeners' field journals.
-- Mirrors node_follows (places), extending "follow" to people. A user's own
-- Listens surface in a follower's "Following" feed via the public listener_handle.

create table if not exists public.listener_follows (
  user_id     uuid        not null default auth.uid() references auth.users(id) on delete cascade,  -- the follower
  followed_id uuid        not null references public.listeners(id) on delete cascade,               -- the followed Listener
  created_at  timestamptz not null default now(),
  primary key (user_id, followed_id),
  check (user_id <> followed_id)  -- no following yourself
);

alter table public.listener_follows enable row level security;

-- A signed-in user can see, create, and remove only their own follows.
create policy "select own listener follows" on public.listener_follows
  for select to authenticated using (auth.uid() = user_id);

create policy "insert own listener follows" on public.listener_follows
  for insert to authenticated with check (auth.uid() = user_id);

create policy "delete own listener follows" on public.listener_follows
  for delete to authenticated using (auth.uid() = user_id);

-- Public follower count per Listener, without exposing who follows whom.
create or replace function public.listener_follower_count(l uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.listener_follows where followed_id = l;
$$;

grant execute on function public.listener_follower_count(uuid) to anon, authenticated;
