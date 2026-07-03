-- Listen Sessions (Task G) — Phase A: database.
--
-- A "session" is one listener outing that can hold several captures and carries a
-- single synthesized "what your session heard" insight, instead of one insight
-- per capture. Each capture is still a mobile_detections row (BirdNET still runs
-- per clip through the existing audio_inference queue); the row now points at its
-- session via session_id.
--
-- Consent model: the SESSION is the public unit. Its captures stay published=false
-- (their per-clip coords/notes never go public); publishing the session
-- (listen_sessions.published=true) is what surfaces it, aggregated, on the feed.
-- So this migration does NOT touch public_mobile_detections — legacy per-capture
-- Listens (session_id is null) keep working exactly as before.

-- ── Table: listen_sessions ───────────────────────────────────────────────────
create table if not exists public.listen_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,

  -- Session centroid (coarsened to ~110m in the public view). Nullable until the
  -- first capture sets it. location is derived for any future PostGIS use;
  -- ST_MakePoint is strict, so it stays null while lat/lon are null.
  lat float8,
  lon float8,
  location geography(Point, 4326) generated always as (
    ST_SetSRID(ST_MakePoint(lon, lat), 4326)
  ) stored,

  -- Place metadata for the whole outing (collected once at "finish").
  habitat_type      text,
  canopy_cover      text,
  water_present     boolean,
  disturbance_level text,
  observer_notes    text,

  insight   text,     -- the synthesized session insight
  published boolean not null default false
);

-- ── Link captures to their session ───────────────────────────────────────────
-- Nullable: legacy Listens and all node detections keep session_id null and are
-- unaffected. on delete set null so discarding a session doesn't delete captures.
alter table public.mobile_detections
  add column if not exists session_id uuid references public.listen_sessions(id) on delete set null;

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists mobile_detections_session_idx
  on public.mobile_detections (session_id);
create index if not exists listen_sessions_user_time_idx
  on public.listen_sessions (user_id, started_at desc);
create index if not exists listen_sessions_published_idx
  on public.listen_sessions (started_at desc) where published = true;

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Owner-only, mirroring mobile_detections. The public feed reads the sanitized
-- view below (definer-rights), never the base table.
alter table public.listen_sessions enable row level security;

create policy "select own sessions" on public.listen_sessions
  for select to authenticated using (auth.uid() = user_id);
create policy "insert own sessions" on public.listen_sessions
  for insert to authenticated with check (auth.uid() = user_id);
create policy "update own sessions" on public.listen_sessions
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own sessions" on public.listen_sessions
  for delete to authenticated using (auth.uid() = user_id);

-- ── Public, sanitized view ───────────────────────────────────────────────────
-- One row per published session. Exposes the coarsened centroid, the outing
-- metadata, the session insight, the listener handle, and the species heard
-- ACROSS the session's completed captures (deduped by common name, keeping the
-- highest confidence). Raw species are exposed as-is (the client applies the
-- same >=30% + hidden-species filters it already uses for per-capture cards).
-- Hides user_id, precise per-clip coords, audio, and device info entirely.
create or replace view public.public_listen_sessions
  with (security_invoker = false) as
select
  s.id,
  s.started_at,
  s.ended_at,
  round(s.lat::numeric, 3) as lat,
  round(s.lon::numeric, 3) as lon,
  s.habitat_type,
  s.canopy_cover,
  s.water_present,
  s.disturbance_level,
  s.insight,
  l.handle as listener_handle,
  agg.species,
  agg.capture_count
from public.listen_sessions s
left join public.listeners l on l.id = s.user_id
cross join lateral (
  select
    coalesce(
      jsonb_agg(top.sp order by (top.sp->>'confidence')::float8 desc),
      '[]'::jsonb
    ) as species,
    (
      select count(*)
      from public.mobile_detections d2
      where d2.session_id = s.id and d2.status = 'complete'
    ) as capture_count
  from (
    -- One entry per common name across all completed captures, max confidence.
    select distinct on (elem->>'common_name') elem as sp
    from public.mobile_detections d
    cross join lateral jsonb_array_elements(d.species) elem
    where d.session_id = s.id
      and d.status = 'complete'
      and d.species is not null
    order by (elem->>'common_name'), (elem->>'confidence')::float8 desc
  ) top
) agg
where s.published = true
  and agg.capture_count > 0;

grant select on public.public_listen_sessions to anon, authenticated;

-- ── Cache the session insight (on-demand regeneration) ───────────────────────
-- Mirror of set_detection_insight: a non-owner viewer who taps "What's the
-- ecosystem saying?" on an older session generates it once and writes it back.
-- SECURITY DEFINER + write-only-when-null, so it's idempotent under concurrent
-- first-viewers and can never overwrite an existing insight.
create or replace function public.set_session_insight(session_id uuid, insight_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.listen_sessions
     set insight = insight_text
   where id = session_id
     and insight is null;
end;
$$;

grant execute on function public.set_session_insight(uuid, text) to anon, authenticated;
