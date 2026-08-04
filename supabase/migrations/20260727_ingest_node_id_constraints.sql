-- Protect the ecological record from node deletion, and encode the ingest invariant in the schema.
--
-- ⚠️ CORRECTS AN EARLIER FINDING. The Phase 0 credential-gate investigation reported that
-- `detections.node_id` and `aci_logs.node_id` had "no FK to nodes". That was WRONG, and the truth is
-- worse than the claim. Both columns have carried a foreign key all along:
--
--     detections_node_id_fkey  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
--     aci_logs_node_id_fkey    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
--
-- ON DELETE **CASCADE**, on the primary ecological record. Deleting one `nodes` row would silently
-- erase every detection and every ACI reading that node ever produced — 194,508 and 164,369 rows at
-- the time of writing. 20260725 documented this cascade footgun for pulses, node_reports,
-- node_status_events, journal_follows and node_follows, and explicitly called node DELETE "the worst
-- case" — but its list did not include `detections` and `aci_logs`, the two tables that ARE the
-- record. The gap was never "no referential integrity"; it was "the wrong referential action."
--
-- WHAT CHANGES: CASCADE -> RESTRICT on both, plus NOT NULL on both node_id columns.
--
-- WHY RESTRICT: it encodes place-over-people. A place that has spoken is never hard-deleted —
-- birdnode11 was decommissioned 2026-07-12 by setting is_active = false and KEEPING its row and its
-- whole record. RESTRICT makes that the database's rule rather than a convention we remember to
-- follow: a node with any detection or ACI row can no longer be deleted at all until those rows are
-- dealt with deliberately and explicitly. NOT NULL is what makes RESTRICT meaningful — it closes the
-- door on an orphaned record with no node to point at.
--
-- CALLER AUDIT (done before changing delete semantics, per the 20260721 precedent): nothing in the
-- codebase deletes `nodes` rows. There is no `from('nodes').delete()` in src/ or api/, and no DELETE
-- against nodes in the Edge Functions. Decommissioning is `is_active = false`. So no existing path
-- depends on the cascade, and RESTRICT breaks nothing.
--
-- PRE-FLIGHT (verified against prod immediately before applying):
--   detections  194,508 rows — 0 NULL node_id, 0 orphaned node_id
--   aci_logs    164,369 rows — 0 NULL node_id, 0 orphaned node_id
-- Both constraints therefore validate without a backfill and without excluding any row.
--
-- Wrapped in a transaction: a failure on the second table must not leave the first half applied,
-- which would leave one table protected and the other still cascading.
--
-- APPLY WITH: supabase db query --linked -f <this file>
-- NOT via the Management API /database/query endpoint — that runs read-only and reports success
-- while persisting nothing. Never `db push` / `migration repair` / `db pull` (standing field item).
--
-- WRITE-ONLY migration: reviewed and applied manually. Do not auto-apply.

begin;

alter table public.detections drop constraint detections_node_id_fkey;
alter table public.detections alter column node_id set not null;
alter table public.detections
  add constraint detections_node_id_fkey
  foreign key (node_id) references public.nodes(id) on delete restrict;

alter table public.aci_logs drop constraint aci_logs_node_id_fkey;
alter table public.aci_logs alter column node_id set not null;
alter table public.aci_logs
  add constraint aci_logs_node_id_fkey
  foreign key (node_id) references public.nodes(id) on delete restrict;

commit;
