-- Task H: persist + batch pre-generate node insights.
--
-- Node detection insights were never stored — MapPage/NodePage regenerated them in
-- local state on every viewer tap (full-price, once per viewer per visit). This adds
-- a stored insight on the row and the plumbing for a Batch-API cron
-- (api/insight-batch.js) to pre-generate them at 50% off, so cards show a stored
-- insight with no tap. The on-demand tap stays as the fallback and now also persists.

alter table public.detections add column if not exists insight text;
-- Set when the batch cron has claimed a detection for generation, so the next tick
-- doesn't resubmit it before its batch completes. A claim older than 3h is treated
-- as stale (batch failed/expired) and becomes eligible again.
alter table public.detections add column if not exists insight_requested_at timestamptz;

-- Atomically claim up to max_rows recent, confident node detections that still need an
-- insight and aren't already in flight; mark them requested and return their ids for
-- the batch. SECURITY DEFINER so the cron can call it with the anon key (mirrors
-- set_detection_insight's pattern — the base table is not anon-writable).
create or replace function public.claim_node_insights(max_rows int default 20)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.detections
     set insight_requested_at = now()
   where id in (
     select id from public.detections
      where insight is null
        and (insight_requested_at is null or insight_requested_at < now() - interval '3 hours')
        and confidence >= 0.30
        and species_name is not null
        and detected_at > now() - interval '2 days'
      order by detected_at desc
      limit max_rows
   )
  returning id;
end;
$$;

grant execute on function public.claim_node_insights(int) to anon, authenticated;

-- Write a generated node insight back. Idempotent (only when still null), so both the
-- batch cron and an on-demand viewer tap can call it safely.
create or replace function public.set_node_detection_insight(detection_id uuid, insight_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.detections
     set insight = insight_text
   where id = detection_id
     and insight is null;
end;
$$;

grant execute on function public.set_node_detection_insight(uuid, text) to anon, authenticated;
