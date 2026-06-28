-- Listen: store a per-capture ecological insight. Generated in the modal from the
-- WHOLE capture (all species heard + the listener's place metadata and notes), so
-- the synthesized insight can incorporate the private notes without exposing the
-- raw notes publicly. The public view surfaces the insight text, not the notes.
alter table public.mobile_detections add column if not exists insight text;

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
    disturbance_level,
    insight
  from public.mobile_detections
  where status = 'complete' and published = true;

grant select on public.public_mobile_detections to anon, authenticated;
