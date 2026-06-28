-- node_follows: which users follow which listening posts (portal "follow" feature)

create table if not exists public.node_follows (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  node_id    uuid        not null references public.nodes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, node_id)
);

alter table public.node_follows enable row level security;

-- A signed-in user can see, create, and remove only their own follows
create policy "select own follows" on public.node_follows
  for select to authenticated using (auth.uid() = user_id);

create policy "insert own follows" on public.node_follows
  for insert to authenticated with check (auth.uid() = user_id);

create policy "delete own follows" on public.node_follows
  for delete to authenticated using (auth.uid() = user_id);

-- Public follower count per node, without exposing who follows whom
create or replace function public.node_follower_count(n uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.node_follows where node_id = n;
$$;

grant execute on function public.node_follower_count(uuid) to anon, authenticated;
