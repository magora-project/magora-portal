-- #59: claim_node_insights must not claim quarantined detections.
--
-- api/insight-batch.js claims up to 20 detections per run, then builds each prompt with
-- buildNodeInsightPrompt (api/insight.js), which reads the detection through RANGE_OK
-- (range_status is null or <> 'quarantined'). A quarantined row reads as missing, its prompt is
-- skipped, and nothing clears its insight_requested_at. After the 3-hour stale window it is
-- claimed again. Twenty recent quarantined rows at the head of the queue would take every slot
-- until they leave the 2-day window, starving valid detections.
--
-- This applies the same range gate inside the claim, so quarantined rows are never claimed.
-- range_status is not null with a check constraint ('unchecked', 'plausible', 'quarantined';
-- 20260720_range_validity_gate.sql), so `<> 'quarantined'` admits exactly what RANGE_OK admits.
--
-- Everything else is unchanged from 20260708_node_insight_batch.sql: signature, return type,
-- SECURITY DEFINER, search_path, the other filters, the order and the grant.
-- Rollback: rollbacks/20261106_claim_node_insights_skip_quarantined.rollback.sql restores the
-- 20260708 body.

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
        and range_status <> 'quarantined'
        and detected_at > now() - interval '2 days'
      order by detected_at desc
      limit max_rows
   )
  returning id;
end;
$$;

grant execute on function public.claim_node_insights(int) to anon, authenticated;
