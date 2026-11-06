-- Rollback for 20261106_claim_node_insights_skip_quarantined.sql: restores claim_node_insights
-- exactly as 20260708_node_insight_batch.sql defined it (no range_status filter). Quarantined
-- detections become claimable again. No data changes in either direction: the forward migration
-- only replaces the function body.

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
