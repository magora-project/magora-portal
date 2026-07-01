-- Cache the per-capture ecological insight ("What's the ecosystem saying?").
--
-- An on-demand insight (older Listens that were posted before the modal generated
-- one) should be generated exactly ONCE: the first viewer who opens it triggers the
-- Claude API call, the result is written back, and everyone after reads the stored
-- text with no further API calls.
--
-- The public feed reads the read-only view public_mobile_detections, and the base
-- table mobile_detections is owner-only RLS, so a non-owner viewer can't write the
-- generated insight back themselves. This SECURITY DEFINER RPC does the write on
-- their behalf, but ONLY when insight IS NULL, so it can never overwrite an existing
-- insight (idempotent and safe under concurrent first-viewers — the first write wins
-- and later calls no-op).
create or replace function public.set_detection_insight(detection_id uuid, insight_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mobile_detections
     set insight = insight_text
   where id = detection_id
     and insight is null;
end;
$$;

-- Called from the client with the anon key, so anon (and authenticated) need execute.
grant execute on function public.set_detection_insight(uuid, text) to anon, authenticated;
