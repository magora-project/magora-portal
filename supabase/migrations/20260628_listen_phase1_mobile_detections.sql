-- Listen feature — Phase 1: Database + Storage
-- Phone-based field recordings: a "Listen" captures 15s of audio, BirdNET runs
-- server-side (Phase 2 worker), results land back on the row via realtime.
--
-- Enqueue path (chosen over the spec's Storage-webhook + Edge Function):
--   phone uploads WAV to temp-audio/{user_id}/{id}.wav, THEN inserts a pending
--   mobile_detections row -> an AFTER INSERT trigger pushes a pgmq job. Simpler:
--   no Edge Function, phone already holds the row id for its realtime subscription.

-- ── Queue ────────────────────────────────────────────────────────────────────
-- pgmq ships with Supabase. If `create extension` errors, enable "pgmq" under
-- Database → Extensions (or Integrations → Queues) in the dashboard, then re-push.
create extension if not exists pgmq;
select pgmq.create('audio_inference');

-- ── Table: mobile_detections ─────────────────────────────────────────────────
create table if not exists public.mobile_detections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  detected_at timestamptz not null default now(),

  -- Location (lat/lon from the phone; location derived for PostGIS queries)
  lat float8 not null,
  lon float8 not null,
  location geography(Point, 4326) generated always as (
    ST_SetSRID(ST_MakePoint(lon, lat), 4326)
  ) stored,

  -- Inference
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'complete', 'failed')),
  species jsonb,  -- [{ common_name, scientific_name, confidence }]

  -- Ecological metadata (all optional, collected in the Listen modal)
  habitat_type      text,     -- forest | grassland | wetland | riparian | shrubland | urban | alpine | desert
  canopy_cover      text,     -- open | partial | closed
  water_present     boolean,
  disturbance_level text,     -- none | low | moderate | high
  observer_notes    text,

  -- Internal
  audio_path  text,   -- temp Storage path, nulled by the worker after inference
  device_info jsonb,  -- browser/OS for QA
  synced_at   timestamptz  -- when the offline queue flushed this (Phase 5)
);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Owner-only for now. The public map/feed (Phase 4) will read through a
-- sanitized VIEW so we never expose user_id / notes / precise coordinates.
-- The Phase 2 worker uses the service role, which bypasses RLS to write results.
alter table public.mobile_detections enable row level security;

create policy "select own detections" on public.mobile_detections
  for select to authenticated using (auth.uid() = user_id);

create policy "insert own detections" on public.mobile_detections
  for insert to authenticated with check (auth.uid() = user_id);

create policy "update own detections" on public.mobile_detections
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists mobile_detections_location_idx
  on public.mobile_detections using gist (location);
create index if not exists mobile_detections_user_time_idx
  on public.mobile_detections (user_id, detected_at desc);
create index if not exists mobile_detections_complete_idx
  on public.mobile_detections (detected_at desc) where status = 'complete';

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- Lets the phone subscribe to its own row and get pushed pending -> complete.
-- (Realtime honors RLS, so a user only ever sees their own rows stream.)
alter publication supabase_realtime add table public.mobile_detections;

-- ── Storage: temp-audio bucket ───────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('temp-audio', 'temp-audio', false)
on conflict (id) do nothing;

-- Authenticated users may upload only into their own {user_id}/ folder.
-- Reads/deletes are done by the worker via the service role (bypasses RLS).
create policy "upload own audio" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'temp-audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Enqueue trigger ──────────────────────────────────────────────────────────
-- Fires when a pending row arrives with its audio already uploaded.
create or replace function public.enqueue_mobile_inference()
returns trigger
language plpgsql
security definer
set search_path = public, pgmq
as $$
begin
  perform pgmq.send('audio_inference', jsonb_build_object(
    'detection_id', NEW.id,
    'audio_path',   NEW.audio_path,
    'user_id',      NEW.user_id
  ));
  return NEW;
end;
$$;

create trigger mobile_detections_enqueue
  after insert on public.mobile_detections
  for each row
  when (NEW.status = 'pending' and NEW.audio_path is not null)
  execute function public.enqueue_mobile_inference();
