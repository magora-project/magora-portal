-- Pulse Agent v1 — canonical, voice-agnostic pulse payload store + versioned weights.
--
-- Pulse is the Notice+Wonder engine: it scores and stores structured "pulses" for a
-- node over a time window (run -> store -> notify-to-Slack). This migration provisions
-- the store and the weights config surface only; no voice/narrative, no node-feed
-- posting. Payloads are written by the on-demand / batch endpoints through the
-- SECURITY DEFINER upsert RPC below (anon key, no service role — mirrors the
-- set_*_insight cache RPCs), so the base table is never anon/authenticated-writable.
--
-- Design notes carried from the task def (docs/tasks/pulse-v1-task-definition.md):
--   * pulses hold PLACE data only. No person data enters this table: there is no
--     user_id / listener reference. (listeners.id IS auth.users(id) directly; that
--     identity is deliberately absent here.) node_follows is DEAD and is never
--     referenced.
--   * `absence` is provisioned in the enum now but is NEVER emitted in v1 (gated by the
--     PULSE_ABSENCE_ENABLED flag in code). Shipping the enum value now means no enum
--     migration is needed when absence is later enabled.
--
-- WRITE-ONLY migration: reviewed and applied manually. Do not auto-apply.

-- ── Enum: pulse_kind ─────────────────────────────────────────────────────────
do $$
begin
  create type public.pulse_kind as enum (
    'novel_detection',
    'activity_spike',
    'soundscape_shift',
    'survey_gap_question',
    'absence'               -- provisioned, never emitted in v1 (see PULSE_ABSENCE_ENABLED)
  );
exception
  when duplicate_object then null;
end
$$;

-- ── Weights config surface ───────────────────────────────────────────────────
-- Per (weights_version, kind) component weight maps. Weights are read from here at
-- scoring time, never inlined in code: changing weights = a new weights_version row,
-- no code change and no re-run needed to re-rank stored payloads (each pulse records
-- its component sub-scores + the weights_version it was scored under).
create table if not exists public.pulse_weights (
  weights_version text not null,
  kind            public.pulse_kind not null,
  weights         jsonb not null,          -- { component_name: weight, ... }, weights sum ~1
  created_at      timestamptz not null default now(),
  primary key (weights_version, kind)
);

-- Seed the v1 hand-set defaults (tuning-todo: refine against real birdnode11 +
-- Magic Lantern payloads later). absence carries no weights row in v1 (never scored).
insert into public.pulse_weights (weights_version, kind, weights) values
  ('v1', 'novel_detection',     '{"rarity": 0.5, "recency": 0.3, "confidence": 0.2}'::jsonb),
  ('v1', 'activity_spike',      '{"magnitude": 0.6, "baseline_stability": 0.4}'::jsonb),
  ('v1', 'soundscape_shift',    '{"delta_magnitude": 0.7, "direction": 0.3}'::jsonb),
  ('v1', 'survey_gap_question', '{"relationship_strength": 0.5, "phenology_alignment": 0.3, "data_absence": 0.2}'::jsonb)
on conflict (weights_version, kind) do nothing;

-- ── Table: pulses ────────────────────────────────────────────────────────────
create table if not exists public.pulses (
  id              uuid primary key default gen_random_uuid(),
  node_id         uuid not null references public.nodes(id) on delete cascade,
  kind            public.pulse_kind not null,

  window_start    timestamptz not null,
  window_end      timestamptz not null,
  cadence         text not null,           -- window/weight/routing profile: "on_demand" | "daily" | ...

  score           numeric not null,        -- aggregate notability, Σ weight_i · component_i
  components       jsonb not null default '{}'::jsonb,   -- per-component sub-scores (retro-tuning)
  weights_version text not null,

  subject         jsonb not null default '{}'::jsonb,    -- { species?: [...], metric? }
  survey_gap      jsonb,                                 -- present only for survey_gap_question
  evidence        jsonb not null default '{}'::jsonb,    -- kind-specific supporting counts/rows

  posted_to_feed  boolean not null default false,        -- v2 reserved; always false in v1
  generated_at    timestamptz not null default now(),

  -- Batch idempotency: one pulse per (node, window, cadence, kind).
  unique (node_id, window_start, window_end, cadence, kind)
);

create index if not exists pulses_node_generated_idx
  on public.pulses (node_id, generated_at desc);
create index if not exists pulses_node_window_idx
  on public.pulses (node_id, cadence, window_start, window_end);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Pulses are place data with no person data, so they are publicly readable (like the
-- node detections they summarize). All writes go through upsert_pulse (SECURITY
-- DEFINER); the base table has no insert/update/delete policy, so it is not directly
-- writable by anon or authenticated.
alter table public.pulses enable row level security;
create policy "pulses public read" on public.pulses
  for select to anon, authenticated using (true);

alter table public.pulse_weights enable row level security;
create policy "pulse_weights public read" on public.pulse_weights
  for select to anon, authenticated using (true);

-- ── Upsert RPC (idempotent store on the unique key) ──────────────────────────
-- SECURITY DEFINER so the on-demand / batch endpoints can write on the anon key
-- (base table is not anon-writable). Idempotent on (node_id, window_start,
-- window_end, cadence, kind): a re-run for the same window refreshes the payload in
-- place rather than creating a duplicate. posted_to_feed is intentionally NOT settable
-- here — it stays false in v1.
create or replace function public.upsert_pulse(
  p_node_id         uuid,
  p_kind            public.pulse_kind,
  p_window_start    timestamptz,
  p_window_end      timestamptz,
  p_cadence         text,
  p_score           numeric,
  p_components      jsonb,
  p_weights_version text,
  p_subject         jsonb,
  p_survey_gap      jsonb,
  p_evidence        jsonb
)
returns public.pulses
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.pulses;
begin
  -- Never emit absence in v1, even if a caller passes it.
  if p_kind = 'absence' then
    raise exception 'absence pulses are gated off in v1';
  end if;

  insert into public.pulses (
    node_id, kind, window_start, window_end, cadence,
    score, components, weights_version, subject, survey_gap, evidence, generated_at
  ) values (
    p_node_id, p_kind, p_window_start, p_window_end, p_cadence,
    p_score, coalesce(p_components, '{}'::jsonb), p_weights_version,
    coalesce(p_subject, '{}'::jsonb), p_survey_gap, coalesce(p_evidence, '{}'::jsonb), now()
  )
  on conflict (node_id, window_start, window_end, cadence, kind) do update
    set score           = excluded.score,
        components       = excluded.components,
        weights_version  = excluded.weights_version,
        subject          = excluded.subject,
        survey_gap       = excluded.survey_gap,
        evidence         = excluded.evidence,
        generated_at     = now()
  returning * into result;

  return result;
end;
$$;

grant execute on function public.upsert_pulse(
  uuid, public.pulse_kind, timestamptz, timestamptz, text,
  numeric, jsonb, text, jsonb, jsonb, jsonb
) to anon, authenticated;
