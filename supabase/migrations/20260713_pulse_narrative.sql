-- Narrative Agent v1 — node-voice render cache on pulses.
--
-- The Narrative Agent renders a PulsePayload into short node-voice prose (ending on one
-- question) and caches it on the pulse row, mirroring the set_*_insight discipline
-- (Task A / Task H): re-opening the NodePage "Pulse" panel within freshness serves the
-- stored text instead of re-generating. pulses is PLACE data only — no person data enters
-- here (listeners.id IS auth.users(id) directly; node_follows is DEAD and never referenced).
--
-- Invalidation (decided by the on-demand endpoint, not this RPC): regenerate when
--   narrated_at IS NULL  OR  narrated_at < generated_at  OR  requested voice != narrative_voice.
-- The RPC just persists the fresh value and stamps narrated_at (it OVERWRITES, unlike the
-- write-once insight cache, because a voice change / stale pulse must be re-narratable).
--
-- Applied manually (like 20260711/20260712), reviewed first. Not auto-applied.

alter table public.pulses add column if not exists narrative       text;
alter table public.pulses add column if not exists narrative_voice text;        -- which voice produced it; 'node' in v1
alter table public.pulses add column if not exists narrated_at      timestamptz;

-- SECURITY DEFINER so the on-demand endpoint can write on the anon key (base table is not
-- anon-writable), mirroring set_node_detection_insight.
create or replace function public.set_pulse_narrative(
  p_pulse_id  uuid,
  p_narrative text,
  p_voice     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pulses
     set narrative       = p_narrative,
         narrative_voice  = p_voice,
         narrated_at      = now()
   where id = p_pulse_id;
end;
$$;

grant execute on function public.set_pulse_narrative(uuid, text, text) to anon, authenticated;
