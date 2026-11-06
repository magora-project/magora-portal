-- #59: claim_node_insights must not claim quarantined detections.
--
-- api/insight-batch.js builds each claimed row's prompt with buildNodeInsightPrompt, which reads
-- the detection under the range gate (RANGE_OK in api/insight.js). A quarantined row reads as no
-- detection, so no prompt is built and the row is never written. Its insight stays null, so once
-- the 3-hour claim goes stale it is claimed again, and up to 20 such rows can take every batch slot
-- until they leave the 2-day window.
--
-- This replaces the function from 20260708_node_insight_batch.sql with one change: the candidate
-- query skips quarantined rows. `is distinct from` keeps the gate's fail-open rule (unchecked and
-- plausible rows are claimed). Signature, return type, security and grants are unchanged.

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
        and range_status is distinct from 'quarantined'
      order by detected_at desc
      limit max_rows
   )
  returning id;
end;
$$;

grant execute on function public.claim_node_insights(int) to anon, authenticated;
