-- Node Phenology Report v1 — published node-voice report cache.
--
-- A Node Phenology Report is a periodic FIRST-PERSON narrative a node writes of its own
-- ecological activity ("every place is speaking / the node is the author"). This migration
-- provisions the CACHE for those reports: the voice-agnostic ReportPayload (jsonb, the sole
-- knowledge source), the rendered node-voice prose, and provenance (voice, model). Generation is
-- on-demand / check-before-generate in v1 (no batch cron — that lands with the cadence-cron slice
-- in v1.1); this table only stores the result.
--
-- Scope (mirrors pulses / pulse_narratives): PLACE data only. No person data — no user_id, no
-- listener reference (listeners.id IS auth.users(id) directly). node_follows is DEAD and never
-- referenced. No Slack path — a report is a node publication, never an operator side-effect.
--
-- Cadence-parameterized from day one: keyed on (node_id, cadence, period_key) so the seasonal /
-- annual builders (v1.1) drop into the SAME cache with no schema change. Daily is the only cadence
-- generated in v1 (period_key = 'YYYY-MM-DD').
--
-- WRITE PATH IS service_role-ONLY FROM THE START. node_reports holds published node-voice prose an
-- agent speaks from; a public (anon) write path into that substrate is a corruption vector. This
-- applies the place-authenticity hardening lesson up front (record_node_status 20260721; the
-- flagged set_pulse_narrative fast-follow) rather than shipping anon-writable and hardening later.
-- Reads are public (place data, like pulses). The on-demand endpoint (api/report-ondemand.js)
-- writes via the SERVICE ROLE key (SUPABASE_SERVICE_ROLE_KEY — server-side only, already
-- provisioned in this environment for the allowlist builder / node-status detector).
--
-- IEK / Elder voice is NOT a member of the render roster and is not addable here — it is gated on
-- the IEK consent model, not a render config. Nothing in this migration references it.
--
-- WRITE-ONLY migration: reviewed and applied manually (like 20260711–20260722). Do not auto-apply.

-- ── Table: node_reports (published report cache) ─────────────────────────────
create table if not exists public.node_reports (
  id           uuid primary key default gen_random_uuid(),
  node_id      uuid not null references public.nodes(id) on delete cascade,
  cadence      text not null,                 -- 'daily' in v1; 'seasonal' | 'annual' in v1.1
  period_key   text not null,                 -- daily: 'YYYY-MM-DD' (the permalink key)
  payload      jsonb not null,                -- the voice-agnostic ReportPayload (sole fact source)
  narrative    text,                          -- rendered node-voice prose (null until narrated)
  voice        text,                          -- render voice id (voices.js); 'node' in v1, NEVER 'elder'
  model        text,                          -- concrete report model id used (provenance; Sonnet in v1)
  generated_at timestamptz not null default now(),  -- when the payload was (re)built
  narrated_at  timestamptz,                   -- when narrative was rendered; stale if < generated_at
  -- One cached report per (node, cadence, period). This unique constraint also serves the
  -- (node_id, cadence, period_key) lookup the read path uses — no separate index needed.
  unique (node_id, cadence, period_key)
);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Reports are place data with no person data, so they are publicly readable (like the pulses /
-- detections they summarize). All writes go through set_node_report (SECURITY DEFINER, granted to
-- service_role ONLY); the base table has no insert/update/delete policy, so it is not directly
-- writable by anon or authenticated.
alter table public.node_reports enable row level security;
create policy "node_reports public read" on public.node_reports
  for select to anon, authenticated using (true);

-- ── RPC: idempotent upsert on (node_id, cadence, period_key) — service_role only ─────────────
-- SECURITY DEFINER so the on-demand endpoint can write while the base table stays non-writable.
-- Idempotent: re-running a report for the same (node, cadence, period) refreshes payload + prose
-- in place. narrated_at is set to now() on every write (the report is written already narrated),
-- so freshness compares narrated_at against generated_at exactly like the pulse-narrative cache.
create or replace function public.set_node_report(
  p_node_id    uuid,
  p_cadence    text,
  p_period_key text,
  p_payload    jsonb,
  p_narrative  text,
  p_voice      text,
  p_model      text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.node_reports (
    node_id, cadence, period_key, payload, narrative, voice, model, generated_at, narrated_at
  ) values (
    p_node_id, p_cadence, p_period_key, p_payload, p_narrative, p_voice, p_model, now(), now()
  )
  on conflict (node_id, cadence, period_key) do update
    set payload      = excluded.payload,
        narrative    = excluded.narrative,
        voice        = excluded.voice,
        model        = excluded.model,
        generated_at = now(),
        narrated_at  = now();
end;
$$;

-- Grant to service_role ONLY (NOT anon / authenticated) — the write path is server-side, keyed on
-- SUPABASE_SERVICE_ROLE_KEY. This is the place-authenticity hardening applied from the start.
revoke execute on function public.set_node_report(uuid, text, text, jsonb, text, text, text)
  from anon, authenticated, public;
grant execute on function public.set_node_report(uuid, text, text, jsonb, text, text, text)
  to service_role;
