-- Listener Field Journal: public listener profiles and sanitized journal pages.

create table if not exists public.listeners (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique check (
    handle = lower(handle)
    and handle ~ '^[a-z0-9_]{3,24}$'
    and handle not in (
      'admin','api','journal','me','support','help','www','mail',
      'node','species','dashboard','register','about','donate','listen'
    )
  ),
  display_name text,
  bio text,
  home_region text,
  avatar_path text,
  created_at timestamptz not null default now()
);

alter table public.listeners enable row level security;

create policy "public select listeners" on public.listeners
  for select to public using (true);

create policy "insert own listener" on public.listeners
  for insert to authenticated with check (auth.uid() = id);

create policy "update own listener" on public.listeners
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "delete own listener" on public.listeners
  for delete to authenticated using (auth.uid() = id);

insert into storage.buckets (id, name, public)
values ('listener-avatars', 'listener-avatars', true)
on conflict (id) do nothing;

create policy "upload own listener avatar" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'listener-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- uploadListenerAvatar uses upsert: re-uploading to the same path is an UPDATE on
-- the storage object, so without this policy a second avatar save fails RLS.
create policy "update own listener avatar" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'listener-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'listener-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "delete own listener avatar" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'listener-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace view public.public_mobile_detections
  with (security_invoker = false) as
select
  m.id,
  m.detected_at,
  round(m.lat::numeric, 3) as lat,
  round(m.lon::numeric, 3) as lon,
  m.species,
  m.habitat_type,
  m.canopy_cover,
  m.water_present,
  m.disturbance_level,
  m.insight,
  l.handle as listener_handle
from public.mobile_detections m
left join public.listeners l on l.id = m.user_id
where m.status = 'complete' and m.published = true;

grant select on public.public_mobile_detections to anon, authenticated;
