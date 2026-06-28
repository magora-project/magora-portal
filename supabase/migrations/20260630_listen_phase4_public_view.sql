-- Listen Phase 4: public, sanitized view of completed mobile detections for the
-- feed + map.
--
-- mobile_detections has owner-only RLS, so the public feed can't read other
-- users' Listens directly. This view (definer-rights, so it bypasses the base
-- table's RLS for the columns we choose) exposes ONLY safe fields and coarsens
-- coordinates to ~100m so a personal recording spot isn't pinpointed. It hides
-- user_id, observer_notes, audio_path, and device_info entirely.
create or replace view public.public_mobile_detections
  with (security_invoker = false) as
  select
    id,
    detected_at,
    round(lat::numeric, 3) as lat,   -- 3 decimals ≈ 110m
    round(lon::numeric, 3) as lon,
    species,
    habitat_type,
    canopy_cover,
    water_present,
    disturbance_level
  from public.mobile_detections
  where status = 'complete';

grant select on public.public_mobile_detections to anon, authenticated;
