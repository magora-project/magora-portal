-- Narrative Agent v1.1 — per-voice render cache (voice roster).
--
-- v1 cached ONE narrative per pulse, inline on the pulses row (narrative / narrative_voice /
-- narrated_at, migration 20260713). v1.1 adds a small roster of reader-selectable voices
-- (node / attenborough / comedy / data_scientist — see api/_narrative/voices.js), each
-- rendering the SAME canonical payload in a different register. So the cache moves to a table
-- keyed per (pulse, voice): toggling voices caches each independently instead of overwriting.
--
-- Scope (unchanged from v1): PLACE data only. No person data — no user_id, no listener
-- reference (listeners.id IS auth.users(id) directly). node_follows is DEAD and never
-- referenced. Public-read + SECURITY-DEFINER-write, mirroring set_pulse_narrative / the
-- set_*_insight caches. No new surface, no Pulse-scoring change, no posted_to_feed.
--
-- IEK / Elder voice is NOT a member of the roster and is not addable here — it is gated on the
-- IEK consent model, not a render config. Nothing in this migration references it.
--
-- Applied manually (like 20260711–20260713 / 20260717), reviewed first. Not auto-applied.

-- ── Table: pulse_narratives (per-voice render cache) ─────────────────────────
create table if not exists public.pulse_narratives (
  id             uuid primary key default gen_random_uuid(),
  pulse_id       uuid not null references public.pulses(id) on delete cascade,
  voice          text not null,                 -- registered voice id (voices.js); NEVER 'elder'
  narrative      text not null,
  model          text,                          -- concrete model id used (provenance)
  voices_version text,                          -- VOICES_VERSION at render time (e.g. 'v1.1')
  narrated_at    timestamptz not null default now(),
  -- One cached narrative per (pulse, voice). This unique constraint also provides the
  -- (pulse_id, voice) lookup index the read path uses — no separate index needed.
  unique (pulse_id, voice)
);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Place data, publicly readable like pulses. All writes go through set_pulse_narrative
-- (SECURITY DEFINER); no insert/update/delete policy, so not directly anon/auth-writable.
alter table public.pulse_narratives enable row level security;
create policy "pulse_narratives public read" on public.pulse_narratives
  for select to anon, authenticated using (true);

-- ── Backfill from the v1 inline cache ────────────────────────────────────────
-- Move existing pulses.narrative rows into the per-voice table as (pulse_id, voice) rows.
-- v1 only ever wrote the 'node' voice; coalesce guards a null narrative_voice. Marked
-- voices_version 'v1' (model unknown for pre-existing rows). Idempotent.
insert into public.pulse_narratives (pulse_id, voice, narrative, model, voices_version, narrated_at)
select id, coalesce(narrative_voice, 'node'), narrative, null, 'v1', coalesce(narrated_at, now())
from public.pulses
where narrative is not null
on conflict (pulse_id, voice) do nothing;

-- NOTE: the v1 inline columns (pulses.narrative / narrative_voice / narrated_at) are LEFT IN
-- PLACE but DEPRECATED — all readers are repointed to pulse_narratives in this same change
-- (api/narrative-ondemand.js). Left rather than dropped to keep this migration non-destructive
-- and reversible; a later migration may drop them once confirmed unused.

-- ── RPC: per-voice idempotent upsert (REPLACES the v1 3-arg RPC) ──────────────
-- Drop the v1 signature (uuid, text, text) and replace with the per-voice writer. The only
-- caller (api/narrative-ondemand.js) is migrated to the new signature in the same change.
drop function if exists public.set_pulse_narrative(uuid, text, text);

create or replace function public.set_pulse_narrative(
  p_pulse_id       uuid,
  p_voice          text,
  p_narrative      text,
  p_model          text,
  p_voices_version text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pulse_narratives (pulse_id, voice, narrative, model, voices_version, narrated_at)
  values (p_pulse_id, p_voice, p_narrative, p_model, p_voices_version, now())
  on conflict (pulse_id, voice) do update
    set narrative      = excluded.narrative,
        model          = excluded.model,
        voices_version = excluded.voices_version,
        narrated_at    = now();
end;
$$;

-- Grant to anon/authenticated, matching v1 (anon key writes via the on-demand endpoint).
-- FAST-FOLLOW (flagged, not done here): harden this write path to service_role, parallel to
-- the node-status record_node_status decision — a public write path into a substrate an agent
-- speaks from is a corruption vector. Deferred deliberately per the task.
grant execute on function public.set_pulse_narrative(uuid, text, text, text, text) to anon, authenticated;
