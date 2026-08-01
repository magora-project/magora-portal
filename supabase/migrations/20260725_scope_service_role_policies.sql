-- SECURITY REMEDIATION — scope the "Service role full access" policies to service_role.
--
-- THE BUG: four policies named "Service role full access <table>" were created without a `TO`
-- clause. CREATE POLICY silently defaults to PUBLIC, so each granted ALL commands (USING true,
-- WITH CHECK true) to EVERY role — including `anon`. The anon key ships inside the client bundle,
-- so these were, in effect, public write endpoints. A policy's NAME is not a grant.
--
-- Found 2026-07-31 while smoke-testing the set_node_banner authorization added in 20260724: an
-- anonymous PATCH to public.nodes that was expected to fail returned 204 and wrote a row. It was
-- reverted within the minute and never served to a visitor. Pre-existing; unrelated to 20260724.
--
-- EXPOSURE at time of fix:
--   * detections   176,596 rows — the ecological record itself. Anon could forge detections,
--                  rewrite species/confidence/range_status (poisoning the range gate), or erase it.
--   * aci_logs     151,237 rows — the heartbeat. Anon could delete rows to make a live node read
--                  as offline, or inject rows to fake liveness and skew ACI/soundscape baselines
--                  (which feed Pulse's soundscape_shift and the public listening indicator).
--   * nodes             3 rows — rename/move/delete a place. DELETE is the worst case: pulses,
--                  node_reports, node_status_events, journal_follows and node_follows all declare
--                  `on delete cascade` on node_id, so removing a node erases its whole accumulated
--                  record.
--   * users             0 rows — the empty legacy table (superseded by auth.users + listeners,
--                  see 20260705). No data at risk; scoped for completeness so the pattern is gone.
--
-- WHY THIS IS SAFE: every legitimate writer to these tables uses service_role, which BYPASSES RLS
-- entirely — so narrowing these policies costs those paths nothing. Verified writers: the Pi
-- firmware (detect.py), the provision-node Edge Function, api/update-location.js, and the
-- record_node_status RPC (SECURITY DEFINER). On the portal side the only client-side `from('nodes')`
-- outside NodePage is a SELECT (src/pages/JournalPage.jsx). Public READ policies are untouched, so
-- nothing a visitor can see changes. The separate `nodes insert own aci_logs` / `nodes insert own
-- detections` policies (TO authenticated) are also untouched.
--
-- ALTER POLICY rather than DROP/CREATE: instantly reversible, and it preserves the policy object,
-- so a rollback is `ALTER POLICY ... TO public` with nothing to reconstruct.
--
-- WRITE-ONLY migration: reviewed and applied manually. Do not auto-apply.

alter policy "Service role full access nodes"      on public.nodes      to service_role;
alter policy "Service role full access detections" on public.detections to service_role;
alter policy "Service role full access aci_logs"   on public.aci_logs   to service_role;
alter policy "Service role full access users"      on public.users      to service_role;

-- Audited at the same time and deliberately NOT changed:
--   * Every other write policy in `public` is already scoped TO authenticated and owner-checked
--     (listeners, journal_follows, listener_follows, listen_sessions, mobile_detections,
--     node_follows).
--   * pulses / pulse_narratives / pulse_weights / node_reports / node_status_events /
--     range_allowlist / ref_species_traits / species / node_habitat carry public READ only and no
--     client write policy at all — their writes go through SECURITY DEFINER RPCs, which is the
--     intended design and was not bypassable.
--   * RLS is enabled on every application table (checked via pg_class.relrowsecurity).
--   * public.spatial_ref_sys (PostGIS reference data) has RLS disabled and anon write grants. It
--     is extension-owned system metadata, not application data; altering it risks the PostGIS
--     install for no application benefit. Logged as a known, accepted item rather than changed here.
