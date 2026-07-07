-- Pulse Agent v1 — allow multiple pulses of the same kind per window.
--
-- The original pulses idempotency key was (node_id, window_start, window_end, cadence,
-- kind), which permits only ONE row per kind per window. But candidate generation
-- legitimately produces several candidates of the same kind (several novel-detection
-- species, several survey-gap questions for different missing habitat fields / iNat
-- taxa). Under the old key they all upserted onto one row and overwrote each other
-- (last write won, arbitrarily). This widens the key with a deterministic subject_key
-- so distinct subjects coexist, while keeping batch idempotency (re-running a window
-- re-upserts the same rows, no duplicates).
--
-- subject_key is derived by the caller from the pulse subject:
--   subject.metric  ??  subject.species[0]  ??  ''
-- (metric-based kinds like activity_spike/soundscape_shift key on the metric; species-
-- based kinds like novel_detection and iNat survey-gap key on the species).
--
-- Applied manually (like 20260711), reviewed first. Not auto-applied.

-- 1) New column, backfilled deterministically from existing rows' subject.
alter table public.pulses add column if not exists subject_key text not null default '';

update public.pulses
   set subject_key = coalesce(subject->'species'->>0, subject->>'metric', '')
 where subject_key = '';

-- 2) Swap the unique/idempotency constraint to include subject_key. Drop whatever
--    unique constraint currently exists on pulses (the original 5-column key), then add
--    the widened 6-column key. Done by lookup so it is robust to the auto-generated name.
do $$
declare
  cname text;
begin
  for cname in
    select conname from pg_constraint
    where conrelid = 'public.pulses'::regclass and contype = 'u'
  loop
    execute format('alter table public.pulses drop constraint %I', cname);
  end loop;
end
$$;

alter table public.pulses
  add constraint pulses_node_window_cadence_kind_subject_key
  unique (node_id, window_start, window_end, cadence, kind, subject_key);

-- 3) Replace upsert_pulse to accept + store subject_key and conflict on the widened key.
--    Drop the old 11-arg signature first so we don't leave an overloaded pair.
drop function if exists public.upsert_pulse(
  uuid, public.pulse_kind, timestamptz, timestamptz, text,
  numeric, jsonb, text, jsonb, jsonb, jsonb
);

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
  p_evidence        jsonb,
  p_subject_key     text default ''
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
    score, components, weights_version, subject, survey_gap, evidence, subject_key, generated_at
  ) values (
    p_node_id, p_kind, p_window_start, p_window_end, p_cadence,
    p_score, coalesce(p_components, '{}'::jsonb), p_weights_version,
    coalesce(p_subject, '{}'::jsonb), p_survey_gap, coalesce(p_evidence, '{}'::jsonb),
    coalesce(p_subject_key, ''), now()
  )
  on conflict (node_id, window_start, window_end, cadence, kind, subject_key) do update
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
  numeric, jsonb, text, jsonb, jsonb, jsonb, text
) to anon, authenticated;
