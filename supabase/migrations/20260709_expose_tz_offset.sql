-- Durable timezone fix: expose the recorder's own UTC offset in the public view.
--
-- The insight's time-of-day prefers the device's stored offset (civil/wall-clock
-- time) over the longitude/solar estimate, but device_info is hidden by the public
-- view, so regenerating an OLDER Listen's insight from the feed fell back to the
-- VIEWER's offset (imperfect cross-timezone). Surface only the tz_offset field (an
-- integer, not PII) so regeneration uses the recorder's own wall-clock time. The
-- rest of device_info (user agent, etc.) stays hidden.
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
  l.handle as listener_handle,
  -- Appended last: `create or replace view` can only add columns at the end.
  (m.device_info->>'tz_offset')::int as tz_offset
from public.mobile_detections m
left join public.listeners l on l.id = m.user_id
where m.status = 'complete' and m.published = true;

grant select on public.public_mobile_detections to anon, authenticated;
