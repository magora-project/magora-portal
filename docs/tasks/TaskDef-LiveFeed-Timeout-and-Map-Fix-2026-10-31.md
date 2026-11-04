# TaskDef — Live Feed Timeout + Homepage Map Fix

**From:** Magora Architect · **For:** Claude Code (repo `magora-portal`, prod Supabase `wqxmmuwrfltpaxnuddwk`) · **Date:** 2026-10-31
**Evidence:** observed live 2026-10-29 on magora-portal.vercel.app (bundle `index-D5yGAzGp.js`). Of six homepage/Live Feed requests, five return 200 (`public_mobile_detections`, `aci_logs`, 2× `detections`, `public_listen_sessions`). The sixth returns **500 `{"code":"57014","message":"canceling statement due to statement timeout"}`**, and the page then shows "Couldn't reach the network" with all three stats as "—". Homepage map shows CARTO's "API KEY REQUIRED" watermark; Journal map works.

## Step 0 — Verify before building (required)
1. `git fetch && git log origin/main -10` and list open PRs. David has in-flight **Spec 2** work (PRs #43/#44/#46: staging, R2 backups, secrets inventory; #42 donate fix). **Do not touch files those PRs touch.** If any of Parts A–C overlap them, stop and report.
2. Re-run the failing request against prod with the publishable key and confirm it still returns **500 / 57014 statement timeout**:
   `GET /rest/v1/nodes?select=*,detections!inner(id)&detections.range_status=eq.plausible&detections.limit=1`
   If it now succeeds, someone fixed it already — report and do Parts B–C only.
3. Find the call site (grep `detections!inner` / `range_status=eq.plausible` in `src/`). Report what UI consumes it (expected: homepage map markers and/or "Listening posts active").
4. Read the migration ledger head on prod and on `main`. **Do not assume `20260724`** — that charter number is stale. Report the true next free number.

**Report Step 0 results before making changes.**

## Part A — Fix the slow query (pick the lowest-risk option that preserves meaning)
Intended meaning: *nodes that have at least one plausible detection.*
- **A1 (preferred, migration):** `EXPLAIN ANALYZE` the equivalent SQL as anon. If missing, add a partial index, e.g. `CREATE INDEX CONCURRENTLY IF NOT EXISTS detections_node_plausible_idx ON detections (node_id) WHERE range_status = 'plausible';` → **⚠️ new Supabase migration.** Claim the number from Step 0.4 and **post it to Noah before applying** (David's Spec 2 work touches DB setup). If a working branch is behind remote migrations and `db push` refuses, apply DDL via `supabase db query --linked` and record the ledger row manually — **never** run `migration repair` or `db pull`. Re-time the request; target < 1s.
- **A2 (no migration, if the meaning allows):** if Step 0.3 shows the consumer only needs *active* nodes, switch to a plain `nodes` select filtered on `last_seen_at` and drop the embed. State the semantic change explicitly in the PR.
- Do **not** expose new columns or add RLS changes. Place-only data; no person exposure.

## Part B — Page resilience (frontend, no migration)
The homepage/Live Feed treats any one failed query as total failure. Change it so each section loads and fails independently (`Promise.allSettled`-style or per-section hooks): a failed node list empties only the map/active-count; feed, species count and soundscape health still render. Keep the existing error copy for a section that genuinely fails.

## Part C — Homepage map tiles (frontend, no migration)
Homepage uses `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png`, which now returns CARTO's "API KEY REQUIRED" watermark tile. The Journal map uses `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` and works. Point the homepage at the same tile layer — ideally one shared constant/component so the two maps can't drift again. Keep OSM attribution. (Known tradeoff: OSM's public tile server isn't for heavy production traffic; fine at current scale.)

## Delivery
- One branch, one PR into `main` (no direct pushes). Vercel preview link in the PR. Commit this TaskDef file with the PR.
- **Verify on the preview:** homepage loads with no 5xx in the network panel; Live Feed shows posts; the three stats show numbers; map tiles render without watermark; Noah's 2026-10-29 listen session appears.
- Report: chosen option (A1/A2) and why, before/after query timing, migration number (if any), files touched.
- Vault: append a short build log to `Log/` and update the current-state doc (migration ledger head if A1).

## Out of scope
Duplicate test nodes cleanup; `SLACK_WEBHOOK_URL`; the July-04 `public_mobile_detections` oddity (check after deploy, report only).
