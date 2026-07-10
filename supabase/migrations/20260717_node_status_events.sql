-- Node Offline Detection v1 — heartbeat-derived node liveness + transition history.
--
-- Nodes can go silent (power loss, connectivity) with no signal. This migration provisions
-- the OPERATIONAL liveness substrate: a per-node transition log (node_status_events) and a
-- current-status convenience column (nodes.last_seen_at), both maintained by the periodic
-- detector (api/node-status-check.js). The heartbeat is aci_logs — the continuous per-cycle
-- soundscape log (verified on prod: ~150 aci_logs/hr vs ~11 detections/hr on birdnode11, i.e.
-- written every cycle regardless of detections). A dark node stops writing aci_logs.
--
-- SCOPE / boundaries (carried from the task def):
--   * This is PLACE / OPS data only. No person data: no user_id, no listener reference,
--     node_follows is DEAD and never referenced. node_status_events is publicly readable
--     like the pulses / detections it sits alongside; writes go through the SECURITY DEFINER
--     record_node_status RPC (base table not anon/authenticated-writable — mirrors upsert_pulse).
--   * Node-offline is an OPERATOR side-effect (Slack ops surface), NEVER a node publication /
--     node voice / feed post. Nothing here posts to any feed.
--   * This delivers the COVERAGE-CONTINUITY precondition the gated `absence` pulse (D2) needs
--     ("was this node continuously online across window W?"). It does NOT un-gate absence:
--     PULSE_ABSENCE_ENABLED and the upsert_pulse absence gate are untouched. Absence still
--     needs an external baseline + a minimum-baseline threshold beyond what this provides.
--   * Net-new and SEPARATE from the pulses / narrative / ref_species_traits schema.
--
-- WRITE-ONLY migration: reviewed and applied manually. Do not auto-apply.

-- ── nodes.last_seen_at (current-status convenience) ──────────────────────────
-- Maintained by the detector: the recorded_at of the node's most recent aci_log at the last
-- check. Nullable (a node with no heartbeat history has no last_seen_at). Derived online/
-- offline is computed by the detector against the node's own cadence, not stored here.
-- (`if not exists`: prod already carries this column out-of-band; this makes the repo the
-- source of truth without failing on the existing column.)
alter table public.nodes add column if not exists last_seen_at timestamptz;

-- ── Table: node_status_events (transition history) ───────────────────────────
-- The record that answers "was this node continuously online during window W?" — one row per
-- OBSERVED STATE CHANGE (online->offline, offline->online), plus a baseline row the first time
-- a node is ever observed. It is NOT written every tick: the detector dedups against the last
-- recorded status and only inserts on an actual transition (so a node that stays offline does
-- not accrue repeat rows or repeat alerts).
create table if not exists public.node_status_events (
  id                        uuid primary key default gen_random_uuid(),
  node_id                   uuid not null references public.nodes(id) on delete cascade,
  status                    text not null check (status in ('online', 'offline')),
  at                        timestamptz not null,   -- when the detector observed this state
  gap_seconds               numeric,                -- observed gap since last heartbeat at detection
  expected_interval_seconds numeric,                -- node's own derived cadence at detection (K× of this = offline)
  is_baseline               boolean not null default false,  -- first-ever observation, not a true transition
  created_at                timestamptz not null default now()
);

create index if not exists node_status_events_node_at_idx
  on public.node_status_events (node_id, at desc);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Ops/place data with no person data → publicly readable (like pulses / detections). All
-- writes go through record_node_status (SECURITY DEFINER); no insert/update/delete policy on
-- the base table, so it is not directly writable by anon or authenticated.
alter table public.node_status_events enable row level security;
create policy "node_status_events public read" on public.node_status_events
  for select to anon, authenticated using (true);

-- ── Transition-record RPC (dedup + last_seen_at maintenance, atomic) ─────────
-- Called once per node per detector tick with the freshly-derived status. Does the
-- transition dedup IN THE DATABASE (atomic against overlapping cron runs):
--   * always refreshes nodes.last_seen_at to the latest heartbeat (ops convenience),
--   * inserts a node_status_events row ONLY when the status differs from the node's last
--     recorded event, or when the node has no prior event (baseline),
--   * returns { recorded, was_baseline, status } so the caller knows whether to fire the
--     one-per-transition Slack operator alert.
-- SECURITY DEFINER so the detector writes on the anon key (base table not anon-writable),
-- mirroring upsert_pulse / set_node_detection_insight.
create or replace function public.record_node_status(
  p_node_id                   uuid,
  p_status                    text,
  p_at                        timestamptz,
  p_gap_seconds               numeric,
  p_expected_interval_seconds numeric,
  p_last_seen_at              timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_status text;
  v_is_baseline boolean;
begin
  if p_status not in ('online', 'offline') then
    raise exception 'invalid node status: %', p_status;
  end if;

  -- Ops convenience: keep last_seen_at fresh every tick, regardless of transition.
  if p_last_seen_at is not null then
    update public.nodes set last_seen_at = p_last_seen_at where id = p_node_id;
  end if;

  select status into v_last_status
  from public.node_status_events
  where node_id = p_node_id
  order by at desc
  limit 1;

  v_is_baseline := v_last_status is null;

  -- No change since the last recorded event → nothing to record, no alert.
  if v_last_status is not distinct from p_status then
    return jsonb_build_object('recorded', false, 'was_baseline', false, 'status', p_status);
  end if;

  insert into public.node_status_events (
    node_id, status, at, gap_seconds, expected_interval_seconds, is_baseline
  ) values (
    p_node_id, p_status, p_at, p_gap_seconds, p_expected_interval_seconds, v_is_baseline
  );

  return jsonb_build_object('recorded', true, 'was_baseline', v_is_baseline, 'status', p_status);
end;
$$;

grant execute on function public.record_node_status(
  uuid, text, timestamptz, numeric, numeric, timestamptz
) to anon, authenticated;
