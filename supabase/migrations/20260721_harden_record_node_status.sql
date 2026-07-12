-- Harden record_node_status: anon → service_role (Range-Gate Completion v1, Part C).
--
-- WHY: record_node_status (migration 20260717) is a SECURITY DEFINER RPC that writes
-- node_status_events and refreshes nodes.last_seen_at. It shipped granted to anon /
-- authenticated so the cron detector could write on the anon key, leaving an UNAUTHENTICATED
-- write path into the node-liveness substrate: anyone with the public anon key could forge
-- node transitions (fake offline/online events, move last_seen_at). That is a public
-- corruption vector into ops data the operator surface and the gated `absence` pulse trust —
-- the same corruption-vector class already closed on apply_species_trait (20260715) and
-- replace_range_cell (20260720). This closes it the same way, and clears one of the four
-- `absence` preconditions (a trustworthy coverage-continuity record).
--
-- CALLER AUDIT (done before revoking — hardening blind would break node liveness): the SOLE
-- caller is api/node-status-check.js (the Vercel cron detector) via api/_node_status/db.js.
-- Its write path (sbRpc) has been switched to the SERVICE ROLE key in the same change
-- (SUPABASE_SERVICE_ROLE_KEY — server-side only, already provisioned in this environment for
-- the allowlist builder). Reads stay on the anon key (read RLS unchanged). No heartbeat path
-- calls this RPC as anon after this migration.
--
-- SCOPE: a grant change only. No data touched, no policy change. The anon SELECT policy on
-- node_status_events stays (public ops/place data, like pulses / detections). This does NOT
-- un-gate `absence`: PULSE_ABSENCE_ENABLED and the upsert_pulse absence gate are untouched.
--
-- WRITE-ONLY migration: reviewed and applied manually. Do not auto-apply.

revoke execute on function public.record_node_status(
  uuid, text, timestamptz, numeric, numeric, timestamptz
) from anon, authenticated, public;
grant execute on function public.record_node_status(
  uuid, text, timestamptz, numeric, numeric, timestamptz
) to service_role;
