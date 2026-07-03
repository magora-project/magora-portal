-- Journal follows (Task D): a Listener (person) follows a node's Journal.
--
-- This supersedes node_follows as the node-follow mechanism, re-modelling a
-- follow as an act by a *Listener identity* (not a bare auth user) so that a
-- follower can, with explicit consent, be shown publicly. node_follows is left
-- in place (non-destructive) but the app now reads/writes journal_follows; its
-- existing rows are backfilled below.
--
-- SCHEMA DEVIATIONS from the task DDL (the real schema differs from the brief):
--   * listeners has NO `user_id` column. Its primary key `id` IS auth.users(id)
--     (see 20260703_listener_profiles.sql), so a Listener's id == auth.uid().
--     RLS ownership therefore resolves as `follower_id = auth.uid()` directly,
--     not via `(select id from listeners where user_id = auth.uid())`.
--   * follower_id defaults to auth.uid() to match node_follows / listener_follows
--     ergonomics (insert only needs node_id).
--   * Display columns on listeners are: handle, display_name, avatar_path.
--     listeners has no email column at all (email lives in auth.users), and no
--     user_id — so the public view cannot leak either even by accident.

create table if not exists public.journal_follows (
  id          uuid        primary key default gen_random_uuid(),
  follower_id uuid        not null default auth.uid() references public.listeners(id) on delete cascade,
  node_id     uuid        not null references public.nodes(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (follower_id, node_id)
);

create index if not exists journal_follows_follower_idx on public.journal_follows (follower_id);
create index if not exists journal_follows_node_idx on public.journal_follows (node_id);

alter table public.journal_follows enable row level security;

-- Ownership resolves through listeners.id = auth.uid() (a Listener row's id IS
-- the auth uid), so `follower_id = auth.uid()` is the ownership test.
create policy "own journal follows: select" on public.journal_follows
  for select to authenticated using (follower_id = auth.uid());

create policy "own journal follows: insert" on public.journal_follows
  for insert to authenticated with check (follower_id = auth.uid());

create policy "own journal follows: delete" on public.journal_follows
  for delete to authenticated using (follower_id = auth.uid());

-- Consent flag: follow visibility is opt-in, default private. This is the first
-- place a PERSON (not a place) becomes publicly visible in Magora, so it holds
-- the same consent bar detections get (mobile_detections.published).
alter table public.listeners
  add column if not exists follows_public boolean not null default false;

-- Sanitized public follower view: display-safe fields ONLY, and ONLY for
-- Listeners who opted in. security_invoker = false (security definer) so a
-- non-owner can read the consented list past journal_follows' owner-only RLS --
-- mirrors public_mobile_detections. NEVER selects user_id or email (listeners
-- has neither column; the follower's auth identity is unreachable from here).
create or replace view public.public_journal_followers
  with (security_invoker = false) as
select
  jf.node_id,
  jf.follower_id as listener_id,
  l.handle,
  l.display_name,
  l.avatar_path,
  jf.created_at
from public.journal_follows jf
join public.listeners l on l.id = jf.follower_id
where l.follows_public = true;

grant select on public.public_journal_followers to anon, authenticated;

-- Total follower count (includes non-public followers; aggregate only, no
-- identities). security definer so non-owners read the count past RLS -- the
-- ONLY path by which a non-owner learns totals.
create or replace function public.journal_follower_count(target_node uuid)
  returns integer
  language sql
  stable
  security definer
  set search_path = public
as $$
  select count(*)::int from public.journal_follows where node_id = target_node;
$$;

grant execute on function public.journal_follower_count(uuid) to anon, authenticated;

-- Backfill: preserve existing place-follows for users who have a Listener
-- profile. node_follows.user_id is the auth uid, which equals listeners.id, so
-- the join both maps the follower and enforces the FK (users without a Listener
-- row have no public identity to model and are skipped).
insert into public.journal_follows (follower_id, node_id, created_at)
select nf.user_id, nf.node_id, nf.created_at
from public.node_follows nf
join public.listeners l on l.id = nf.user_id
on conflict (follower_id, node_id) do nothing;
