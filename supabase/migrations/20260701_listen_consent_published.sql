-- Listen: consent gate. A recording is processed privately (the worker needs the
-- row to write results to), but must NOT appear on the public map/feed until the
-- user explicitly posts it. `published` defaults false; the public view requires
-- it true. Users can delete their own drafts (discard).

alter table public.mobile_detections
  add column if not exists published boolean not null default false;

-- Don't silently drop already-visible Listens from the map — backfill existing
-- completed rows as published. The consent gate applies to new recordings.
update public.mobile_detections set published = true where status = 'complete';

-- Public view now also requires published = true.
create or replace view public.public_mobile_detections
  with (security_invoker = false) as
  select
    id,
    detected_at,
    round(lat::numeric, 3) as lat,
    round(lon::numeric, 3) as lon,
    species,
    habitat_type,
    canopy_cover,
    water_present,
    disturbance_level
  from public.mobile_detections
  where status = 'complete' and published = true;

grant select on public.public_mobile_detections to anon, authenticated;

-- Let a user discard (delete) their own recording.
create policy "delete own detections" on public.mobile_detections
  for delete to authenticated using (auth.uid() = user_id);
