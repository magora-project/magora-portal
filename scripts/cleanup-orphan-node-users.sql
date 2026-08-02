-- Cleanup — dormant orphan node auth users.
--
-- WRITE-ONLY script: reviewed and applied manually. Do not auto-apply.
-- Companion to docs/tasks/provision-secret-rotation-runbook.md.
--
-- WHAT THESE ARE: `provision-node` creates a per-node auth user, then inserts the `nodes` row with
-- `id = <that auth user's uuid>`. On a failed insert it rolls back by deleting the auth user. A dozen
-- rollbacks evidently didn't complete during June/July development, leaving `node-*@magora.internal`
-- auth users with no corresponding `nodes` row.
--
-- WHY REMOVE THEM: each is a live credential in the `authenticated` role. It cannot write detections
-- or aci_logs (the ingest policies check `auth.uid() = node_id`, and no matching node row exists), but
-- it can sign in and reach the anon-grade RPC surface and create self-owned social rows. They are
-- dormant, not dangerous — none has signed in since 2026-06-18 — but they are pure residue.
--
-- NOT AN INCIDENT ARTIFACT: audited 2026-08-01 and attributed to development, not to the
-- PROVISION_SECRET exposure. Creation clusters on 2026-06-13 (2), 2026-06-18 (9), 2026-07-08 (1);
-- nothing since. Recorded here so a future reader doesn't re-litigate it.

-- ── STEP 1: review before deleting ───────────────────────────────────────────
-- Run this alone first. Expect 12 rows, all `node-*@magora.internal`, all with zero authored data.
-- If the count differs from 12, STOP and re-audit — something has changed since 2026-08-01.
select u.id, u.email, u.created_at, u.last_sign_in_at,
       (select count(*) from public.detections d where d.node_id = u.id) as detections,
       (select count(*) from public.aci_logs a where a.node_id = u.id)   as aci_logs
from auth.users u
where u.email like 'node-%@magora.internal'
  and not exists (select 1 from public.nodes n where n.id = u.id)
order by u.created_at;

-- ── STEP 2: delete ───────────────────────────────────────────────────────────
-- Only after STEP 1 returns exactly the expected rows with detections = 0 and aci_logs = 0.
--
-- The `detections`/`aci_logs` guards are redundant with the `nodes` check (both tables' node_id
-- references a node that by definition doesn't exist here) but are kept as belt-and-braces: this
-- statement deletes credentials, and the cost of an over-broad predicate is unrecoverable. It will
-- never touch a real node's user, and never touches a human steward's account — `owner_id` lives on
-- `nodes` and is a different column from `nodes.id`.
--
-- Uncomment to run:

-- delete from auth.users u
-- where u.email like 'node-%@magora.internal'
--   and not exists (select 1 from public.nodes n where n.id = u.id)
--   and not exists (select 1 from public.detections d where d.node_id = u.id)
--   and not exists (select 1 from public.aci_logs  a where a.node_id = u.id);

-- ── STEP 3: confirm ──────────────────────────────────────────────────────────
-- Expect node_auth_users = node_rows = 3 (or whatever the live roster is at run time).
-- select
--   (select count(*) from auth.users where email like 'node-%@magora.internal') as node_auth_users,
--   (select count(*) from public.nodes) as node_rows;
