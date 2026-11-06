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
-- `is distinct from 'quarantined'` admits null as well, exactly like RANGE_OK. In the repo the
-- column is not null (20260720_range_validity_gate.sql), but it was added with
-- `add column if not exists`, so a pre-existing nullable column in production would have kept
-- its nulls; a plain `<> 'quarantined'` would then silently never claim those rows.
--
-- Everything else is unchanged from 20260708_node_insight_batch.sql: signature, return type,
-- SECURITY DEFINER, search_path, the other filters, the order and the grant.
-- Rollback: rollbacks/20261106_claim_node_insights_skip_quarantined.rollback.sql restores the
-- 20260708 body. Before applying, capture production's live definition
-- (select pg_get_functiondef('public.claim_node_insights(int)'::regprocedure)) and confirm it
-- matches 20260708; if it doesn't, the rollback would not restore it.
--
-- Known gap (not fixed here): a claimed row whose prompt can't be built for another reason
-- (a node with no name or habitat, a transient fetch failure, an errored batch item) is still
-- re-claimed after 3 hours. Quarantine is the large, deterministic case.
--
-- APPLY WITH: supabase db query --linked -f <this file>
-- NOT via the Management API /database/query endpoint — that runs read-only and reports success
-- while persisting nothing. Never `db push` / `migration repair` / `db pull` (standing field item).
-- Apply only after the PR is green at its final head (AGENTS.md § Migrations).
--
-- WRITE-ONLY migration: reviewed and applied manually. Do not auto-apply.

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
        and range_status is distinct from 'quarantined'
        and detected_at > now() - interval '2 days'
      order by detected_at desc
      limit max_rows
   )
  returning id;
end;
$$;

grant execute on function public.claim_node_insights(int) to anon, authenticated;
