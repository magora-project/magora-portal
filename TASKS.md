# Magora Portal — Task Manager

> **How this works:**
> - Claude Code reads this file at the start of every session as part of your context note
> - When a task is done, mark it `[x]` and move it to Done
> - When you come to Claude (chat) for planning, this file gets updated with new tasks
> - This file is always the source of truth for what to build next
> - NOTE: Don't reference Obsidian vault docs in task descriptions — Claude Code only sees files synced locally to the PC, not the Drive copies. Inline any needed guidance directly in the task.

---

## 🔴 Now — Currently Building

- _Nothing actively in progress. Pulse Agent v1 and iNaturalist Step 0 both shipped July 2026 (see Done). Next up: **Node Offline Detection** (Next). Housekeeping: reconcile Pulse's `feat/pulse-agent-v1` branch → `main` (prod is running it out-of-band)._

---

## 🟡 Next — Confirmed, In Order

- [ ] **Node Offline Detection** (elevated — birdnode11 has been dark ~67h as of July 7, and this is the hard prerequisite for un-gating Pulse's `absence` kind)
  - **Problem:** Nothing surfaces a node going silent. birdnode11 has had two silent power-outage incidents so far; the network can't tell an offline node from a quiet one.
  - **Fix:** Detect when a node has produced no detections / `aci_logs` / heartbeat beyond a per-node expected-interval threshold (config). Alert operators via Slack (operator side-effect, NOT a node-voice publication). Expose queryable node online/offline status; Pulse's coverage-continuity check reads it.
  - **Out of scope v1:** predictive failure, auto-recovery, node-feed surfacing.
  - **Dependency:** Pulse's gated `absence` kind consumes this coverage-continuity signal; until it ships, `PULSE_ABSENCE_ENABLED` stays false.

- [x] **Durable timezone fix — expose recorder offset in the public view.** (DONE July 2026: migration `20260709` exposes `tz_offset` in `public_mobile_detections`; `ListenModal` now stamps it into `device_info` at capture (online path only stored `{ua}` before); `useEcosystemInsight` + `JournalPage` read it. Bonus fix: MapPage's "species today" counter used **UTC** midnight — which is ~5-6pm Mountain, so it rolled over mid-afternoon — now **local** midnight. Sessions have the same latent cross-tz regeneration gap; left as a follow-up.) The insight's time-of-day now uses the device UTC offset (civil/wall-clock time) instead of the longitude/solar estimate that was mislabeling post-sunrise mornings as "pre-dawn." Fresh captures now stamp `tz_offset`/`tz` into `mobile_detections.device_info`, but that column is hidden by `public_mobile_detections`, so regenerating an *older* Listen's insight from the feed falls back to the *viewer's* offset (fine for same-tz, imperfect cross-tz). Durable fix (needs a migration + prod apply, so left for when DB access is handy): add a plain `tz_offset` column exposed in the view, and have `/api/insight` prefer it. Timestamps/display were always correct — this only ever affected the insight's "time of day" phrasing.

- [x] **Task E: Prompt-cache the static insight prefix — INVESTIGATED, NOT VIABLE (July 2026)**
  - **Finding:** Prompt caching can't help this prompt. Anthropic only caches a prefix once it clears a per-model minimum: **2048 tokens on Sonnet 4.6** (the current insight model), **4096 tokens on Haiku 4.5** (the Task F target). The entire `api/insight.js` prompt — static instructions *and* variable data combined — is only a few hundred tokens (the static instruction block is ~250 tokens). It's far below even the lowest 1024-token floor, so a `cache_control` breakpoint would silently never register a hit (`cache_creation_input_tokens: 0` forever). Prompt caching pays off for large stable prefixes (multi-thousand-token system prompts, few-shot blocks, retrieved docs); this short mostly-variable prompt is the opposite shape.
  - **Conflict with Task F:** switching to Haiku (Task F) *raises* the cache minimum to 4096, making E even less reachable. The two tasks were in tension.
  - **Original premise (didn't hold):** the task assumed "the static prefix is the majority of input tokens." In reality the prompt is small enough that there's nothing worth caching. Savings on the insight path come from **Task F** (Haiku, ~halves cost) and the future **G/H/I** (session batching, Batch API, situation cache), not from caching.
  - **No code shipped for E** (implementing it would be dead markers). Closed as investigated.

- [x] **Task F: Route per-capture insights to Haiku; reserve Sonnet for reports** (DONE July 2026)
  - **Problem:** Insights are high-volume and formulaic; reports (future) are low-volume and high-value. Running short insight blurbs on a Sonnet-tier model overpays for a task where the quality delta is small.
  - **Fix:** Point the insight generation call at `claude-haiku-4-5-20251001` (or current Haiku alias). Leave any phenological-report generation on Sonnet 5 when that gets built. This roughly halves the dominant cost line.
  - **Eval gate (do this before committing):** Generate ~20–30 insights on BOTH Haiku and Sonnet from the same detection payloads. Compare side by side for: (1) voice/tone consistency, (2) ecological accuracy, (3) whether the IEK-first framing survives. If Haiku holds up → switch. If Haiku wobbles on the sensitive framing → keep Sonnet for insights and lean on Tasks E + I for savings instead. Record the decision + a few sample outputs in the build log.
  - **Where to look:** The model identifier in the insight API call. Ideally lift it to a single config constant (e.g. `INSIGHT_MODEL`) so the insight/report split is one place to change, not scattered.
  - **Progress (July 2026):**
    - ✅ Model lifted to a single `INSIGHT_MODEL` constant at the top of `api/insight.js`; both branches reference it, no hardcoded model strings remain. Still `claude-sonnet-4-6`.
    - ✅ Refactored `insight.js` so prompt-building is separated from the model call: exported `buildMobileInsightPrompt`, `buildNodeInsightPrompt`, and `generateInsight(prompt, model)`. Public endpoint contract + behavior unchanged (verified: syntax, lint, and a smoke test of both builders).
    - ✅ Eval harness built: `scripts/eval-insight-models.mjs`. Reuses the real prompt builders (zero drift), pulls recent real mobile + node detections from Supabase, builds each prompt once, generates it with every candidate model, and writes a side-by-side `scripts/insight-eval-<ts>.md` with a scoring checklist + tally. Run: `node scripts/eval-insight-models.mjs` (auto-loads `.env.local`/`.env`; needs `ANTHROPIC_API_KEY` + `VITE_SUPABASE_*`; `EVAL_N` sets samples per type, default 12).
  - **Decision (July 3 2026): switched to Haiku.** Ran the harness on 12 mobile + 12 node real detections (48 generations; output at `scripts/insight-eval-2026-07-03T14-33-39.md`). Haiku held Sonnet's voice and whole-ecosystem framing on essentially every pair. Only two divergences, both addressed:
    - Haiku ignores the "no em-dashes" rule (~8/12 node outputs) → `generateInsight` now strips em-dashes (`replace(/\s*—\s*/g, ', ')`) for **any** model, so the house style holds regardless. Verified on a live Haiku call (806 chars, zero em-dashes).
    - Occasional mild over-reach (e.g. editorializing Pine Siskins as climate "canaries") → added a "stay grounded in the data given, do not editorialize" bullet to both the mobile and node prompt instructions.
    - ✅ `INSIGHT_MODEL` flipped to `claude-haiku-4-5-20251001`. Reports path (future) stays on Sonnet 5 when built — the insight/report split is this one constant. Verified: syntax, lint, live generation.
  - **Sample outputs** (same detection, both models) live in the eval file above; keep it as the decision record. Note: the eval's Haiku samples predate the em-dash sanitizer, so they still show raw em-dashes — production output no longer does.
  - **No migration. No UX change** (assuming eval passes).

---

## 🔵 Backlog — Prioritized

- [ ] **iNat ambient — grid-cell/season DB cache** (optional fast-follow, extracted from iNat Step 0)
  - A DB cache for the ambient nearby search. The edge cache (`Cache-Control s-maxage=1d`) covers dogfood scale for now; this is only needed if iNat read volume grows or a per-region/season warm cache is wanted. Not blocking anything.

- [x] **Listen feature — Phase 5: Offline queue**
  - Added `idb` queue in `src/lib/listenQueue.js` for pending offline recordings
  - `ListenModal.jsx` saves offline recordings locally when offline and auto-syncs on reconnect
  - `App.jsx` starts the queue listener at app launch
  - `MapPage.jsx` renders queued local Listens as "Syncing…" cards in the feed

- [ ] **birdnode1 rebuild**
  - New SD card, flash latest Pi OS image
  - Run magora-firstrun.sh from bootfs config
  - Test provision-node Edge Function
  - Confirm detections flowing to Supabase

- [x] **Task G: Batch the listener session into one insight (cost + UX win)** — SHIPPED July 2026 (Phases A–D merged to `main`, PR #3; on-device confirmed).
  - **Concept:** Instead of firing a separate insight per capture, generate ONE synthesized "what your session heard" insight per Listen session. Reads the whole soundscape as a unit rather than N disconnected per-detection blurbs — more true to the whole-ecosystem thesis, and cuts the listener insight cost by the capture-count factor (~4–5x).
  - **Product decision to confirm before building:** Does a listener doing 4 captures in one visit want 4 separate readings, or one session-level synthesis? Recommendation is one-per-session (better product AND cheaper). Confirm before building — this changes the insight data model.
  - **Where it touches:** The Listen flow results step (`ListenModal` Results state) and however insights attach to detections. Currently the insight likely attaches to a single detection row; a session-level insight needs a home — either a `session_id` grouping on `mobile_detections` with the insight on the session, or a lightweight `listen_sessions` table. Scope the data model in a design pass before writing the migration.
  - **Interacts with Task A:** A caches per-detection-row. G shifts the cache granularity to per-session for listeners. Make sure they compose — the session insight is the cached artifact for a listener session; the per-row cache still serves node detections.
  - **Needs its own scoped session.** Do not bundle with H or I.
  - **Progress (July 2026):** Scoped — full design in `LISTEN_SESSIONS_DESIGN.md`. Product decision confirmed: **build multi-capture sessions** (one insight per outing; N=1 sessions behave like today).
    - ✅ **Phase A migration APPLIED to prod** (July 2026, `supabase/migrations/20260707_listen_sessions.sql` via `supabase db push`; verified — `public_listen_sessions` returns 200/[] for anon). `listen_sessions` table + nullable `session_id` on `mobile_detections` + owner RLS + sanitized `public_listen_sessions` view (in-view species aggregation across captures) + `set_session_insight` RPC. Consent model: the session is the public unit, captures stay `published=false`, so `public_mobile_detections` is untouched. (Fix during apply: `CROSS JOIN LATERAL` can't take `ON` — dropped `on true`.)
    - ✅ **Phase B data layer** (`src/lib/listenSession.js`): create/publish/discard session, `aggregateSpecies`, `centroid`, `buildSessionInsightPayload` (reuses the `/api/insight` `mobile` branch). Lint clean.
    - ✅ **Phase B UI** (`ListenModal.jsx`): session created on the first capture, "Record another spot", one synthesized session insight, publish/discard the whole session. Build + lint clean.
    - ✅ **Phase C feed** (`MapPage.jsx`, `MobileDetectionCard.jsx`, `useSessionInsight`): one session card per outing (species aggregated across captures + "N spots" + session insight), session centroids on the map.
    - ✅ **Phase D journal** (`JournalPage.jsx`): sessions merged into the journal feed + life list + place/Listen counts + map markers; feed branches on `_kind` for the right insight write-back (session vs per-capture).
    - **Committed** on branch `task-g-listen-sessions` (stacked on `task-f-haiku-insights`). Build + lint clean; `public_listen_sessions` verified live. ⏭ **Only remaining: on-device test** of the full record → "record another spot" → post → session-card flow (mic/geo/auth), same as prior Listen phases.

- [x] **Task H: Move non-interactive insight generation to the Batch API (50% off)** — SHIPPED July 2026 (node-insight batch pre-gen; `api/insight-batch.js` Vercel Cron, daily `0 8 * * *`, Hobby-plan limit). **Closed on deployment evidence (July 7):** `/api/insight-batch` is live on prod behind the `CRON_SECRET` gate (verified — returns 401 without the secret), `CRON_SECRET` is set in Vercel Production, and the cron is scheduled in `vercel.json`. (An individual cron tick was not independently confirmed from the dev environment; closing on the deployment evidence above.)
  - **FIRST STEP — verify, don't assume:** Check how insight generation is currently wired. Is it synchronous (user watches it load in the modal, staring at a spinner) or fire-and-store (generated server-side, displayed when ready)? The answer forks the task:
    - **If a surface is async-able** (node insights almost certainly are; listener session insights from Task G may be): route those calls through the Message Batches API for a 50% discount. Generation returns when ready rather than blocking.
    - **If a surface is genuinely synchronous** (user is actively waiting on-screen): leave it on the standard API, OR redesign to async ("we're listening — check back in a moment") if the UX tolerates it. Don't degrade a real-time experience purely to save cost; note the tradeoff and decide per-surface.
  - **Likely outcome:** Node-side and Task-G session insights → Batch API. Any remaining real-time surface → standard API, relying on Tasks E/F/I for its savings.
  - **Where to look:** Every insight generation entry point (fewer now that About reuses `ListenButton` and the Listen surface is consolidated). Classify each as sync or async, then route accordingly.
  - **Depends on:** Cleanest after G (which clarifies the listener-side sync/async question).
  - **Built — v1: node insights (July 2026).** Verified finding: all insight generation was interactive; node insights were the only genuinely async surface (and weren't even persisted — MapPage/NodePage regenerated them full-price in local state on every viewer tap). Listener session insights stay interactive (the listener is on-screen — "don't degrade real-time"). What shipped:
    - Migration `20260708` (applied to prod): `detections.insight` + `insight_requested_at`; `claim_node_insights(max)` (atomic claim of recent, confident, not-in-flight detections) and `set_node_detection_insight` RPCs (SECURITY DEFINER → cron runs on the anon key, no service role).
    - `api/insight-batch.js`: a **Vercel Cron** function that drains ended batches (writes insights back, idempotent) then claims + submits a new batch, reusing `buildNodeInsightPrompt` (no prompt drift). `vercel.json` schedules it **daily** (`0 8 * * *`, Hobby-plan limit).
    - `INSIGHT_MODEL` exported from `api/insight.js` (Haiku → batch = 50% off Haiku). MapPage/NodePage now show the stored `d.insight` and persist on-demand taps via `set_node_detection_insight`.
    - **Deployed (July 2026):** `CRON_SECRET` set in Vercel Production; `/api/insight-batch` live behind the gate; cron scheduled daily. Batch API create/retrieve/cancel smoke-tested live; RPCs + column verified live; build + lint clean. Follow-on: smarter detection selection / dedup ties into Task I (situation cache).

- [ ] **Task I: Situation-keyed semantic cache — STUB, spec after E/F land + 1 week of cost data**
  - **Intent:** The structural cost-bender. Cache insights keyed on the *ecological situation* — a hash of {coarsened geo band, season, time-of-day bucket, dominant species set, ACI band} — not on the individual detection row. A robin at dawn in a Montana spring becomes the same cached insight whether it's birdnode11 or a listener two valleys over. This lets listeners benefit from node-generated cache entries and each other's, structurally defeating the "roving listeners cache poorly" problem (per-user caching can't help mobile users; per-situation caching can).
  - **Why stub, not spec:** The exact hash granularity (how coarse the geo band, how many species define a "situation", how wide the ACI bucket) depends on the real repeat-rate in the data. Once E + F ship, one week of `usage` data shows how much cost is genuine novelty vs. repeat situations — spec the hash against that reality rather than guessing. Matches "confirm state before writing build specs."
  - **When speccing (later), the spec must cover:** `situation_insights` table schema + the hash/key function; the pre-generation lookup (hash → check table → hit serves stored, miss generates + stores); how it LAYERS OVER Task A's per-row cache (situation cache is checked first; per-row is the fallback/legacy path); a staleness policy (do situation insights expire seasonally? get regenerated on drift?); and coarsening that preserves privacy (geo band must be ≥ the ~110m listener coarsening already applied).
  - **Optional future extension (note only):** precompute top-N common situations per region overnight at Batch rates, so most live captures serve from a warm library and the API only fires on genuine long-tail novelty.
  - **Do not build yet.** This is a placeholder to hold the intent in the queue.

- [ ] **Species Guild/Diet Enrichment (EIA trait-layer slice #1)**
  - **Unblocks:** Pulse rich-tier guild scoring (currently degraded to `iucn_status` + detection frequency behind stubbed relationship/phenology seams).
  - **Fix / migration:** net-new migration — `ALTER TABLE species ADD COLUMN guild, diet, migratory_status, indicator_status, sensitivity_flag` (note: guild/migratory_status/indicator_status/sensitivity_flag columns already exist but are null-seeded — use `IF NOT EXISTS` and reconcile at build; `diet` is the genuinely new one). Seed from AVONET (keyed on `ebird_code`) AND fold in the curated project-specific values from `scripts/gen_guild_sql.py` (its `indicator_status` / `sensitivity_flag` are regional judgments AVONET lacks — do NOT discard).
  - **Files:** new migration; `scripts/gen_guild_sql.py` (existing, uncommitted, ~73 curated rows).
  - Resolves EIA spec §12 #3 (trait placement: in-place on `species`) and starts #4 (bird-side crosswalk via `ebird_code`).

---

## 🧹 Doc Hygiene

- [x] **Fix stale `MAGORA_PROJECT_BRIEF.md`** (July 2026) — dropped the removed `/dashboard` route + `Dashboard.jsx` (route table, file tree, and the obsolete "Dashboard per-node filtering" limitation), and brought the route table/file tree current (added `/species`, `/journal`, `/donate`, SpeciesPage, JournalPage; noted Listens + sessions). Left an unrelated stale row flagged for later: "Portal user auth — Sign-in button is a stub" is now false (email OTP + Google sign-in shipped).

---

## ✅ Done

- [x] **Pulse Agent v1 — Notice + Wonder scoring engine** (July 2026)
  - The first ecological agent: reads a node's data over a time window, generates + ranks candidate patterns (`novel_detection`, `activity_spike`, `soundscape_shift`, `survey_gap_question`; `absence` provisioned but gated off), and stores canonical, voice-agnostic **pulse** payloads. v1 = run → store → notify-to-Slack; no node-feed posting, no voice/narrative rendering (that's the future Narrative Agent). Slack messages are operator side-effects, never node-voice publications.
  - **Migrations (both applied to prod):** `20260711_pulses.sql` — `pulse_kind` enum, `pulses` table (place data only; no `user_id`; never references dead `node_follows`), `pulse_weights` versioned config surface (seeded with `v1` weights, read at scoring time — never inlined), `upsert_pulse` SECURITY DEFINER RPC (anon-key writes, mirrors the `set_*_insight` pattern). `20260712_pulses_subject_key.sql` — adds `subject_key` and widens the idempotency key so multiple same-kind pulses per window coexist (distinct species / habitat fields / iNat taxa) instead of collapsing to one row.
  - **Scaffolding:** `api/_pulse/` (payload, sources, generate, score, core, db, notify — underscore-prefixed so Vercel doesn't route the modules) + two entry points: `api/pulse-ondemand.js` (interactive, check-before-generate, 6h freshness TTL) and `api/pulse-batch.js` (cron-auth via `CRON_SECRET`, previous-UTC-day window, notify-to-Slack).
  - **Shipped DEGRADED (deliberate):** the `species` guild/diet columns are null-seeded, so `novel_detection.rarity` uses seeded `iucn_status` + network detection frequency (not the guild column), and `survey_gap_question` relationship/phenology sub-scores are neutral behind stubbed `relationshipSource`/`phenologySource` seams. Un-blocked by the **Species Guild/Diet Enrichment** task (Backlog).
  - **Verified:** live batch run against Magic Lantern → HTTP 200, wrote 7 distinct pulses (1 activity-spike + 6 survey-gap questions: 4 habitat-gap fields + 2 iNat ground-truth taxa). Two bugs found + fixed in live testing (single-row RPC destructure 500; the same-kind collapse the `subject_key` migration resolves). Design spec: `docs/tasks/pulse-v1-task-definition.md`.
  - **⏭ Housekeeping (not blocking):** deployed to prod **out-of-band** on branch `feat/pulse-agent-v1` (commits through `1f32341`, pushed to origin) — **not yet merged to `main`**; reconcile via review + merge. `api/pulse-batch` is **not** wired into `vercel.json` crons yet (only `insight-batch` is). `CRON_SECRET` was rotated during testing and is Sensitive/unpullable — set a durable non-sensitive value in the Vercel dashboard for repeatable manual runs.

- [x] **iNaturalist integration — Step 0: Ambient nearby search** (Tier 0, auth-free) — DONE July 2026
  - Step 0 = "the surrounding wild": for any point, show the research-grade species iNat users have verified nearby, grouped by iconic taxon (birds/plants/insects/mammals/fungi) — the "this place is alive" moment. No auth, no schema, no OAuth; works for every Listen incl. hardware-less ones. (Optional grid-cell/season DB cache split out to Backlog.)
  - [x] **API endpoint** `api/inat-nearby.js` — GET lat/lon/radius → calls iNat `/v1/observations/species_counts` (research-grade, non-captive), dedupes, groups by iconic taxon, returns count + common name + photo + attribution + wikipedia per species. No API key (iNat reads are unauthenticated). Coarsens the query point to ~110m for privacy + edge-cache reuse; `Cache-Control s-maxage=1d`. Custom User-Agent. Verified live (1510 species near birdnode11: 91 plants / 50 birds / 34 insects / 11 mammals…).
  - [x] **UI surface — Listen result screen.** Added a "〰 The wider web here" section to the ListenModal `results` step: "N species verified within 5 km," grouped breakdown (🌿 plants · 🪶 birds · 🐞 insects · 🦌 mammals…), and iNat attribution. Loads best-effort on results (non-blocking; capture flow never depends on it), reuses the capture's coords. Empty-state ("be the first on iNaturalist") when nothing's logged nearby. New shared client `src/lib/inat.js` (`fetchNearbyLife`, `summarizeGroups`, `inatTaxonUrl`, `corroboratedCount`, iconic-taxon emoji/label map). Shipped to prod & verified live.
  - [x] **Interaction + insight pass (on-device feedback).**
    - **Scroll fix:** the Listen modal centered (`alignItems:center`) *and* scrolled on the same element, so a tall results view clipped the top and couldn't be scrolled to. Now `alignItems:flex-start` + `margin:auto` on the sheet (centers when it fits, top reachable when tall).
    - **Interactive wider-web:** groups are now tap-to-expand accordions showing species with photo thumbnails, observation counts, and tap-through to each taxon's **iNaturalist** page (works for all taxa, not just birds).
    - **Relates to the bioacoustics:** a corroboration line — "✓ N of the M birds you heard are verified here on iNaturalist too" (matches heard species' scientific names against the nearby set).
    - **Feeds the insight:** the nearby multi-taxa web is passed into `/api/insight` (mobile branch) so "What's the ecosystem saying?" reasons across the whole web; and the insight is now available **even when no birds were heard** (tells the place's story from the iNat web). Both paths exercised locally (no-birds + birds). Lint clean, build passes.
  - [x] **Real-device check** — confirmed on-device in prod (July 2026): enriched wider-web section, tap-to-expand groups w/ thumbnails + iNat tap-through, clarified copy, and the sheet-scroll fix all working. (PWA service-worker cache had to be force-refreshed to pick up later deploys.)
  - [x] **Second surface — node/place profile.** Added "The wider web here" card to NodePage (green palette to match the page), between "Most recorded here" and place details. Reuses `lib/inat.js` (fetch on node load, keyed on node id so the 30s refresh doesn't refetch), same tap-to-expand groups + thumbnails + iNat tap-through, plus a corroboration line relating the surrounding web to what the *node* records (`commonNamesVerified`, matched by common name). Verified end-to-end against birdnode11 (94 species / 5 km; 2 recorded species verified nearby). Lint: no new errors (2 pre-existing set-state-in-effect errors left as-is); build passes.

- [x] **Task D: Journal follow system with consented follower visibility** (July 2026)
  - Follow a **node's** Journal via a new `journal_follows` table (migration `20260710`; `follower_id` → `listeners`, `node_id` → `nodes`, unique per pair). Follower **count** is public (`journal_follower_count` security-definer RPC) but the follower **list** is opt-in: `listeners.follows_public` (default false) + security-definer `public_journal_followers` view exposing only opted-in followers and only display-safe fields (handle / display_name / avatar_path) — **never user_id/email**. Mirrors the `mobile_detections` → `public_mobile_detections` consent pattern; the first place a *person* (not a place) becomes publicly visible in Magora.
  - **Supersedes `node_follows`** as the node-follow mechanism (old table left in place, non-destructive; existing follows backfilled into `journal_follows`). NodePage: "Follow Their Journal" control + count + consented follower list; MapPage Following feed now reads `journal_follows`; `ProfileEditorModal`: default-off "show the nodes I follow" toggle. Data layer: `src/lib/journalFollows.js`.
  - **Schema realities that bent the original spec:** `listeners` has no `user_id`/`email` column — its PK `id` *is* `auth.users(id)`, so RLS ownership is `follower_id = auth.uid()`. Following now **requires a claimed handle** (the `follower_id` FK to `listeners`), so handle-less users are routed to the claim prompt — a behavior change from `node_follows`' anonymous place-follows.
  - Verified: lint clean, build green, migration applied to prod, **17/17 live checks** as real authenticated users (follow/unfollow, count increment/decrement, unique constraint on double-follow, cross-user RLS, consent gating on/off, no identifier leakage) with full teardown. Shipped via **PR #6** → prod deploy `d94c3ea`. See memory `follow_system.md`.

- [x] **Storage upload JWT workaround — `storage-upload` Edge Function** (July 2026)
  - Authenticated Storage uploads (listener avatars + Listen audio) were failing with `new row violates row-level security policy` even though policies were correct. Root cause: the project enabled **JWT signing keys**, so GoTrue stamps a `kid` header into tokens; the **Storage service (v1.60.10) can't parse kid'd tokens** and treated every upload as anonymous (`auth.uid()` null → RLS deny). PostgREST/DB validated the same tokens fine, so DB writes worked — Storage was the only casualty. Rotating keys / removing the ECC key in the dashboard did NOT drop the kid.
  - **Fix (workaround):** new `supabase/functions/storage-upload` validates the user's session server-side via `admin.auth.getUser(jwt)` (GoTrue handles the kid) and uploads with the service role, scoped to the caller's own `{uid}/` folder (bucket allowlist listener-avatars + temp-audio, filename sanitized, no path traversal). Deployed `--no-verify-jwt` (pinned in `config.toml`). Client helper `src/lib/storageUpload.js` (`uploadViaFunction`) rewired into `uploadListenerAvatar`, the ListenModal audio upload, and the offline-queue sync. Verified end-to-end (both buckets, 401 no-auth, 400 bad-bucket/traversal).
  - **⚠️ TODO — revert later:** this is a workaround for an old Storage version. Once Supabase upgrades the project's Storage service to one that supports JWT signing keys, delete `storage-upload` + `storageUpload.js` and go back to direct `supabase.storage.from(bucket).upload(...)`. See memory note `storage_jwt_es256_break.md`. (Noah rolled the signing key back to the legacy HS256 shared secret in the dashboard, but the kid persists, so the workaround is still required.)

- [x] **Follow journals (people), with Following-feed integration** (July 2026)
  - Reverses the v1 "follow places, not people" line. Migration `20260706`: `listener_follows` table (follower + followed listener, self-follow blocked) with own-row RLS + a security-definer `listener_follower_count` RPC (mirrors `node_follows`).
  - JournalPage: Follow button + follower count in the header (hidden on your own journal, prompts sign-in when signed out). MapPage: the **Following feed now includes Listens from Listeners you follow** (matched by public `listener_handle`) alongside followed places; tab gate + empty-state copy updated. Verified follow/unfollow/count + self-follow guard against prod.

- [x] **Node registration requires sign-in + links node to its steward** (July 2026)
  - `/register` is gated on sign-in (signed-out visitors get a sign-in prompt). The wizard sends the signed-in user's id; `provision-node` requires `owner_id` and stores it, so a registered node auto-appears on the steward's field journal.
  - Migration `20260705`: repointed `nodes.owner_id` FK from the legacy (empty) `public.users` table to `auth.users` so it can hold a real account id. birdnode11 claimed to the `noahwaldron` account. JournalPage shows a **"Listening posts"** section listing owned nodes (links to NodePage).

- [x] **Journal + Listen onboarding polish** (July 2026)
  - **Handle prompt** now fires right after a Listener posts their first Listen (was: immediately after sign-in), and tapping **Listen while signed out auto-opens the recorder** once signed in (survives the Google OAuth redirect).
  - Journal redesign: **map moved up** under the stat buttons; **edit-profile moved out of the page into the navbar account menu** (`ProfileEditorModal`); ecosystem insight is now an **inline collapsible** (collapsed by default, resets on refresh) on both feed + journal, replacing the portal modal; stats grid mobile-clipping fixed.
  - **Map:** tapping a glowing amber Listen dot opens that Listener's journal.
  - **Listen location UX:** location fetch is retryable ("Try location again") with guidance for in-app-browser (open in Safari) and iOS Location Services settings, instead of a dead-ended "Waiting for location…".

- [x] **provision-node Edge Function** — built, deployed, and unbroken (July 2026)
  - `supabase/functions/provision-node/index.ts`: called from RegisterNode wizard step 2. Gated by an `x-provision-secret` header; with the service role it creates the node's Supabase auth user (`node-<uuid>@magora.internal`) + inserts the `nodes` row (id = auth uuid, Option B), rolling back the auth user if the insert fails, and returns `node_id`/`email`/`password` to the wizard.
  - **Was silently broken in prod:** it had been redeployed with the default `verify_jwt = true`, so Supabase's gateway 401'd (`UNAUTHORIZED_NO_AUTH_HEADER`) every registration before the request reached the function — the wizard sends only `x-provision-secret`, no Supabase JWT. **Fixed:** redeployed with `--no-verify-jwt` (now version 5, `verify_jwt = false`); verified the wizard's exact call path works (correct secret + empty body → 400 missing fields, i.e. gateway open + `VITE_PROVISION_SECRET` matches the function's `PROVISION_SECRET`, no node created).
  - **Regression guard:** added `supabase/config.toml` pinning `[functions.provision-node] verify_jwt = false` so a future `supabase functions deploy` can't reset it.
  - Not done: a true end-to-end registration (would create a real node/auth user in prod) — left for the birdnode1 rebuild.


- [x] **Listener Field Journal** — public profile + field journal for Listeners at `/journal/:handle` (June 2026)
  - `listeners` table + RLS (public SELECT, own-row insert/update/delete), public `listener-avatars` bucket with per-user folder policies, `listener_handle` exposed on `public_mobile_detections` (migration `20260703`). Client-side handle format validation + reserved-word blocklist.
  - Profile editor (display_name, bio, home_region, avatar upload). Handle-claim UI on `/journal/me`.
  - **Privacy gate satisfied without a SECURITY DEFINER function:** the journal reads the existing sanitized `public_mobile_detections` view (already coarsens coords ~110m and hides user_id/notes/audio_path), filtered by `listener_handle` — so it never leaks anything the public feed hides.
  - Wire-up: MobileDetectionCard "Listened by @handle" → journal; "My journal" in the account menu.
  - **Follow-ups shipped this session:**
    - **Handle prompt** (`HandlePrompt.jsx`): signed-in Listeners without a handle get a dismissable claim modal after sign-in (covers new sign-ups + returning users). `validateHandle`/`RESERVED_HANDLES` promoted to shared exports in `listener.js`.
    - **Mobile layout fix:** stats grid was clipping the third card + double-padding on phones — now shrinks to fit and uses the page gutter.
    - **Live-feed redesign:** journal now renders Listen posts with the same `MobileDetectionCard` + `.detection-grid` (edge-to-edge, no bubbles) as the live feed, incl. the ecosystem-insight portal flow. Life list / Places / Listens are scroll-to-section buttons; Life list shows the full species list.
    - **Avatar RLS fix:** "new row violates row-level security policy" on Save Profile was a lapsed session (write hitting Postgres as anon; prod bucket + policies verified correct). `ProfileEditor` now `getSession()`s first — refreshes and writes with the fresh uid, or prompts re-auth.
  - **Out of scope v1 (as designed):** no follow system, no public/private toggle, species as plain text in the life list.
  - **Known follow-ups (not blocking):** same session guard not yet on the first-time claim form; insight-modal duplicated between MapPage and JournalPage (extract to a shared component later).

- [x] **Cache "What's the ecosystem saying?" — serve stored insight** (June 2026)
  - On-demand ecosystem insights for older mobile Listens were regenerating (a fresh Claude API call) for every viewer who tapped the button. Now they generate ONCE: the first viewer generates it, the result is written back, everyone after reads the stored text.
  - `public_mobile_detections` already exposed `insight` (added in `20260702`, preserved through `20260703`) — no view change needed.
  - New migration `20260704_set_detection_insight.sql`: RPC `set_detection_insight(detection_id uuid, insight_text text)`, `SECURITY DEFINER`, `set search_path = public`, granted execute to anon + authenticated. Writes **only when `insight IS NULL`** so it can never overwrite an existing insight (idempotent under concurrent first-viewers). Needed because the public view is read-only and the base table is owner-only RLS, so a non-owner viewer can't write back directly.
  - `MapPage.requestMobileInsight` now calls the RPC with the anon key right after a successful generation (best-effort; a failed write-back just regenerates next time). The card already gated the button on `!d.insight`, so stored insights display with no API call.
  - **Migration `20260704`: applied to prod** (confirmed via `supabase migration list` — present in Remote; verified July 2026).

- [x] **Open ecosystem insight must survive new detections** (June 2026)
  - The "What's the ecosystem saying?" panel was rendered inline inside `MobileDetectionCard`, in the feed scroll container, so a feed re-render (new detection arriving) could collapse an insight the user was reading.
  - Lifted the open insight into a **portal modal** (`react-dom` `createPortal` → `document.body`) mounted at the app root in `MapPage`, fully decoupled from the feed list. Its open state (`openInsight`) lives on `MapPage`, outside the feed mapping, so feed re-renders can't touch it. The card's button now calls `onOpenInsight` instead of rendering/generating inline.
  - Wrapped `MobileDetectionCard` and `DetectionCard` in `React.memo`; both are keyed by detection id in the feed, so existing cards stay mounted (never remount / lose state) when new detections prepend.
  - Note: the public feed currently refreshes via a 30s poll (the only Realtime channel is the per-recording one in `ListenModal`); the portal modal makes the open insight immune to *any* feed re-render regardless of trigger. Feed merge is append/prepend-safe with stable keys.

- [x] **Listen feature — Phase 4: Feed + map integration** (June 2026)
  - Migration `20260630_listen_phase4_public_view.sql`: sanitized public view `public_mobile_detections` (definer-rights) — completed rows only, exposes species + ecological metadata, **hides** user_id/notes/audio_path/device_info, coarsens lat/lon to 3 decimals (~110m) for privacy. Granted to anon+authenticated (verified: returns rows for anon)
  - `MobileDetectionCard.jsx`: amber 〰 Listen badge (distinct from green node cards), species filtered to ≥30% + hidden-species filter, ecological metadata tags, relative time, species links to /species
  - MapPage: fetches `public_mobile_detections`, merges node + mobile into one time-sorted feed (mobile only on Global tab), amber pulse `CircleMarker`s with tooltips on the map. Verified: feed renders mobile cards, build passes, no page errors
  - ~~Known gap: mobile Listens skip regional filtering~~ → **FIXED** (acoustic `194a855`): worker now passes lat/lon/date to BirdNET's built-in location filter (eBird-derived range model), the mobile equivalent of the nodes' regional whitelist. Restricts results to species plausible at the recording's place + time of year. Deployed & polling. (Existing test rows keep their old species; new Listens are filtered)
  - Pre-existing MapPage lint warnings (set-state-in-effect, lines ~75/116) left as-is — not introduced here
  - **"What's the ecosystem saying?" on mobile Listens (whole-capture):** api/insight.js gained a `mobile` branch — no node/ACI/longitudinal context, but uses the recording's own lat/lon for real eBird regional context (works anywhere on Earth), reads ALL species heard as one community, the place metadata, the listener's free-text notes, and a longitude-derived local time-of-day. Generated in the ListenModal (where the private notes live) and stored on the row via new `insight` column (migration `20260702`, exposed in the public view; raw notes stay private). MobileDetectionCard shows the stored insight, falling back to an on-demand button (requestMobileInsight) for older posts. Also un-collapsed the "Tell us about this place" metadata section in the modal so it's not missed. Added `/* global process */` to insight.js for serverless lint
  - **Consent fix (`20260701`):** recordings were going public as soon as the worker finished (before the user agreed). Added `published` flag (public view requires it); the modal now processes privately, shows results, then posts only on an explicit "Post to the map" — with a "Discard" option (delete-own policy). Existing Listens backfilled as published. Map auto-fit now includes mobile Listens (were off-screen when far from a node)

- [x] **Listen feature — Phase 3: Listen flow frontend** (June 2026)
  - `lib/listen.js`: amber palette, metadata option lists, `pickAudioMime` (webm/mp4/ogg fallback), `reverseGeocode` (OSM Nominatim), `getPosition` (geolocation promise)
  - `ListenButton.jsx`: amber CTA, sign-in gated (no user → openSignIn), `hero` + `pill` variants; wired into MapPage hero (3rd CTA) and Navbar top bar
  - `ListenModal.jsx`: 4 states — Ready (shows reverse-geocoded place) → Recording (live Web Audio AnalyserNode waveform on canvas + 15s countdown bar, stop-early) → Pending (realtime subscription, closeable) → Results (species list w/ confidence + optional ecological metadata chips: habitat/canopy/water/disturbance + notes)
  - Upload contract honored: audio uploaded to `temp-audio/{user_id}/{uuid}.{ext}` FIRST, then pending row inserted (so the Phase 1 trigger enqueues with audio present); realtime watches the row to `complete`/`failed` with a 90s poll fallback
  - Added generic `pulse` keyframe to index.css. Verified: lint clean, build passes, smoke test (buttons render, signed-out gating opens auth modal, no page errors)
  - **Needs real-device test:** mic + geolocation permissions + full record→worker→realtime round-trip (also the first true end-to-end test of the Phase 2 worker). Note: existing DetectionCard has its own "Listen" (plays audio) — different from this feature's record action
  - **Recording length picker** (added later): Ready screen offers 15s / 30s / 1 min / Open. Open-ended records until "Stop & identify" with a 5-min safety cap (MAX_OPEN_SECONDS); recording UI shows remaining time for fixed, count-up clock for open. MediaRecorder uses a 1s timeslice so long clips chunk instead of buffering one blob

- [x] **Listen feature — Phase 2: Worker VM** (June 2026) — deployed & running on Fly.io
  - Queue-access RPCs (portal migration `20260629`): `read_audio_jobs` / `delete_audio_job` / `archive_audio_job`, SECURITY DEFINER, service_role only (verified anon denied). Worker talks to the queue over HTTPS — no direct Postgres / DB password
  - `magora-acoustic-biodiversity/worker/`: `inference_worker.py` (poll loop + BirdNET, params identical to detect.py: min_conf 0.20 / sensitivity 1.25 / overlap 1.5, same EXCLUDE+insect filter, dedupe best-per-species, poison-message guard, audio deleted after inference), `requirements.txt`, `Dockerfile`, `fly.toml`, `README.md`
  - Deployed to Fly.io app `magora-listen-worker` (region dfw, shared-cpu-1x / 1GB). Verified: model loads, "Polling audio_inference queue", machine `started`
  - **Fixes during deploy:** (1) pinned `numpy<2` — tflite-runtime is built against NumPy 1.x and crash-looped on NumPy 2.4.6; (2) removed the `[http_service]` block `fly launch` auto-injected — the worker has no web server, and that block would have auto-stopped the machine for lack of HTTP traffic
  - **Deviations from spec:** VM memory 1GB not 256MB (BirdNET won't fit in 256MB); enqueue via the Phase 1 trigger (no Storage webhook/Edge Function)
  - Remaining: full audio round-trip naturally validated in Phase 3 (needs a real Listen upload); optional — pin `birdnetlib` to the Pi's version for exact parity

- [x] **Listen feature — Phase 1: Database + Storage** (June 2026)
  - Migration `20260628_listen_phase1_mobile_detections.sql`, pushed to prod (verified: table live, migration history synced)
  - `mobile_detections` table: lat/lon + generated PostGIS `location`, status check constraint (pending/processing/complete/failed), species jsonb, ecological metadata cols; GiST + user/time + partial(complete) indexes; added to supabase_realtime publication
  - RLS owner-only (select/insert/update own). Public map/feed deferred to Phase 4 via a sanitized VIEW (no user_id/notes/precise coords) — privacy-first
  - `temp-audio` private Storage bucket + policy: authenticated users upload only into their own {user_id}/ folder; worker reads/deletes via service role
  - pgmq `audio_inference` queue created
  - **Deviation from spec (intentional):** chose a Postgres AFTER INSERT trigger (`enqueue_mobile_inference`) over the spec's Storage-webhook + Edge Function. Phone uploads WAV then inserts its own pending row → trigger enqueues. Simpler (no Edge Function), and the phone already holds the row id for its Phase 3 realtime subscription. Phase 3 contract: upload audio FIRST, then insert the row with audio_path set
  - Migration-history note: repaired drift — `20260627` (node_follows) had been applied directly in the dashboard but never recorded, so it was marked applied via `supabase migration repair` before the push

- [x] **PWA setup** (June 2026)
  - Wired vite-plugin-pwa into vite.config.js (it was installed but never configured — there was no service worker at all)
  - Plugin now owns the manifest (deleted the static public/manifest.json) and generates a Workbox SW; registerType autoUpdate, injectRegister auto
  - Manifest: name/short_name Magora, 192/512/maskable icons, theme + background #0d2818, display standalone, portrait
  - Workbox precaches the app shell (navigateFallback → /index.html so SPA routes work offline); runtime caching for Google Fonts, map tiles, Wikipedia/Wikimedia species photos; big decorative SVGs + dead icon-512.png.webp excluded from precache to keep it lean
  - Removed the old service-worker kill-switch from index.html (it unregistered every SW on load — would have nuked the PWA SW)
  - Verified with headless Chromium: SW registers/activates, offline reload returns the app shell, offline /about resolves via navigateFallback
  - STILL TODO (needs a real device): install-prompt + add-to-home-screen test on Android; confirm standalone display + maskable icon crop

- [x] **Donate page** (June 2026)
  - /donate route (DonatePage.jsx): participation-first framing — sponsor a node, keep data open, deploy your own; Zeffy CTA + Add-a-listening-post
  - Navbar donate icon + the 60s DonatePrompt now funnel to /donate instead of jumping straight to Zeffy
- [x] **Dashboard redesign — Ecological Patterns** (June 2026)
  - Dropped KPI tile grid for a single-column editorial layout (Big Shoulders section headers + plain-language summary sentence)
  - Soundscape "river": smooth SVG band (Catmull-Rom) across Dawn→Night, thickness = ACI complexity (replaces bar list)
  - Sections: community/guild breakdown, migration mix, seasonal species shift (new, fills in over the year), most recorded (links to species), listening posts (link to nodes)
- [x] **Follow system — Supabase + portal** (June 2026)
  - Phase 1: auth (Email OTP code + Google sign-in), AuthProvider/useAuth, AuthModal, navbar account state
  - Phase 2: node_follows table + RLS + follower-count RPC; follow/unfollow button on NodePage (sign-in gated), live follower count
  - Phase 3: Global | Following feed tabs on MapPage, gated by MIN_NODES_FOR_TABS (4) or the signed-in user already following something (empty-room guard)
  - Config done in dashboards: email template {{ .Token }}, Google OAuth client + provider, Supabase URL config. STILL TODO before public launch: custom SMTP (built-in email is throttled)
- [x] **RegisterNode step-4 polling fix** (June 2026)
  - Timeout was 5 min (60×5s) but BirdNET install takes up to 25 min — raised to ~30 min (360 polls)
  - "Try again" did setStep(4) while already on step 4, so the effect deps never changed and polling never restarted (stuck spinner); now uses a pollNonce that genuinely restarts the interval and resets state
  - Renamed the button "Keep waiting" to match the longer-wait reality
  - Out of this repo: pinning detect.py version (firmware repo) + end-to-end birdnode1 rebuild test (hardware)
- [x] **Species page** (June 2026)
  - New /species/:name route (SpeciesPage.jsx) — Wikipedia photo + fact, scientific name
  - Stats: total recordings, # places, peak season; range map = GBIF global occurrence overlay (green hex density) + red Magora node markers on top
  - "Heard at these places" list (links to node profiles) + seasonal pattern bars
  - Respects 30% confidence filter; species names now link to it from DetectionCard, Dashboard, NodePage
- [x] **Home-screen app icon = circular logo** (June 2026)
  - Root cause: apple-touch-icon + manifest pointed at a WebP (icon-512.png.webp); iOS ignores WebP home-screen icons
  - Generated PNGs from the logo with Pillow (trim white border, center on square, 5% margin): icon-512.png, icon-192.png, apple-touch-icon.png (180)
  - index.html apple-touch-icon + favicon → PNG; manifest icons → PNG (added maskable for Android circular crop)
  - iOS renders a rounded-square (squircle) by OS rule, so it shows the circular badge on white — true circle isn't possible on iOS; Android maskable gets a real circle
- [x] **Hide non-ecological sounds from the app** (June 2026)
  - New lib/hiddenSpecies.js (HIDDEN_KEYWORDS + isHiddenSpecies); replaces the duplicated insect lists
  - Hides human/anthropogenic sounds (Human vocal, Engine, Siren, Fireworks, Power tools, Gunshot) and dogs/wolves/coyotes, plus the existing insects
  - Applied to MapPage feed + today's species count, NodePage feed + all-time stats, and Dashboard species counts
  - Still logged in Supabase — display-only filter (avoided "Gun" keyword so it doesn't catch Gunnison Sage-Grouse)
- [x] **Feed redesign — Instagram-style + ID confidence meter** (June 2026)
  - DetectionCard rebuilt as image-dominant card (full-width photo, ~260px) using the .feed-card CSS hooks
  - "Account" header (node name + place + live dot, links to profile) shown on the global feed only via showNode prop; hidden on a node's own page
  - Confidence score relabeled "ID confidence" with a meter bar + % (tap for the BirdNET explanation), color-coded by bucket
  - Insight shows as a caption; Listen / Share / "What's the ecosystem saying?" actions kept
  - Feed is a single centered column (max 500px), edge-to-edge full-bleed on mobile; applied to MapPage feed + NodePage record (.detection-grid)
- [x] **Confidence filter — 30% minimum** (June 2026)
  - Added MIN_CONFIDENCE (0.30) in lib/supabase.js; applied as `.gte('confidence', …)` on every detections query
  - Hides sub-30% detections from the live feed, today's species count, node pages + all-time stats, and dashboard analytics (data still stored, just not shown)
  - Change the threshold in one place (lib/supabase.js) to adjust app-wide
- [x] **Em-dash cleanup, app-wide** (June 2026)
  - Replaced user-facing em-dashes with commas/periods across AboutPage, DetectionCard badge tooltips, NodePage, ShareSheet, RegisterNode, Dashboard, MapPage, plus index.html title + manifest description
  - Left untouched: `'—'` no-data placeholders (UI convention), code comments, en-dash number ranges (0–3 min)
  - insight.js prompt now instructs Claude to avoid em-dashes so generated insights stay clean too
- [x] **Homepage copy refresh** (June 2026)
  - Section 3 heading → "The ecological record, live" + new intro ("places are speaking… a moment from a living ecosystem")
  - Section 4 (EcologicalPipeline) heading → "From birdsong to ecological insight" + new intro ("A single birdcall is never just a bird. The ecosystem is speaking…")
  - Hero, heartbeat, and commons verified already ecosystem-first (no change); homepage-copy.md placed in repo root
- [x] **App-wide wording shifts** (June 2026)
  - Browser title → "Magora — listening to the living world" + meta description (index.html)
  - Navbar brand: "Magora Bird Project / Citizen Science BioAcoustics" → "Magora / Ecological intelligence network"
  - PWA manifest name → "Magora", description reframed
  - DonatePrompt + insight.js prompt: dropped "Bird Project" framing
  - User-facing "detections" → "recordings" where natural (Dashboard "Recordings by guild" / "No recordings yet", RegisterNode whitelist hint); internal table name "detections" unchanged
- [x] **About page rewrite** (June 2026)
  - Reframed AboutPage.jsx from "Magora Bird Project" to "ecological intelligence network" using AboutPage-copy.md
  - Sections: hero ("Every place is speaking."), what we're listening to, soundscape health, the bigger record (modular sensing as design direction), why this matters & why you, four pillars, the invitation + CTAs
  - Kept honesty guardrail: sensor expansion phrased as "designed to take on more senses over time," not a shipped feature
  - Added Explore the network / Add a listening post CTAs (react-router Links)
- [x] **Share cards — Instagram-shareable image generation** (June 2026)
  - New ShareSheet.jsx modal opened from each detection's ↗ Share button (DetectionCard)
  - html2canvas renders a branded WPA/paper card → PNG at ~1080px; Square 1:1 + Story 9:16 toggle
  - Card: species photo (Wikipedia), common + scientific name, "Recorded {moment} from {node}", habitat · date, MAGORA wordmark + waveform + "Every place is speaking."
  - Actions: Share image (Web Share API w/ files → IG/FB on mobile), Download (desktop fallback), Copy caption (with hashtags + node link)
  - NOT included: Open Graph meta tags for FB/Twitter *link* previews (SPA needs server-rendered OG — separate task if wanted)
  - NOTE: build-verified only — needs a real mobile test (share sheet + Wikipedia image CORS onto canvas)
- [x] **MapPage error state** (June 2026)
  - Wrapped fetchData in try/catch + finally; also surfaces supabase-js `{ error }` responses (not just thrown network errors)
  - Feed shows "Couldn't reach the network" + Try again button when there's no data and the fetch failed
  - Existing data is never wiped by a transient refresh failure (data grid takes priority over the error branch)
- [x] **NodePage as place profile** (June 2026)
  - Breadcrumb (Network → region → node), banner image slot (placeholder + habitat gradient), "Currently recording" live status pill
  - Identity with optional steward handle; Follow (UI-only toggle) + Share place buttons (Web Share API / clipboard fallback)
  - Profile stats: species recorded (all-time), soundscape health, listening since
  - Ecosystem bio (uses node.bio if present, else generated place-first text); "Most recorded here" top species
  - Forward-compatible: reads region/steward/bio/image columns if added later; retained ACI sparkline + ecological record + soundscape log
- [x] **DetectionCard tone + share button** (June 2026)
  - Human moment line under species name ("Recorded at dawn from [Node]"), derived from is_dawn_chorus then time-of-day
  - Share button: Web Share API on mobile, clipboard fallback with confirmation
  - Caption: species + node + place + "Every place is speaking." + deep link to node page
  - Added `node` prop, wired from MapPage (nodeById lookup) and NodePage
  - Text + link only — no image generation yet
- [x] **Homepage redesign — MapPage.jsx restructure** (June 2026)
  - Big Shoulders Display font import
  - Hero: "Every place is speaking." + two CTAs + waveform motif
  - Heartbeat strip: 3 live stats, 30s refresh, pulse animation
  - Existing map + feed moved down, node-pulse on recent activity
  - EcologicalPipeline.jsx (new) — sound -> ecological story web
  - EcologicalCommons.jsx (new) — two-card invitation section
  - Full language audit applied across Navbar, DetectionCard, NodePage, Dashboard
- [x] Supabase schema: detections, aci_logs, nodes tables
- [x] Per-node JWT authentication + RLS policies
- [x] DetectionCard: Wikipedia photo, species badges, xeno-canto audio, Claude insight
- [x] MapPage: Leaflet map, detection feed, ACI feed, 30s refresh
- [x] NodePage: info tiles, ACI sparkline, filtered detections
- [x] Dashboard: ACI by time of day, top species, node list
- [x] RegisterNode: 5-step wizard, provision-node integration
- [x] Supabase client singleton (anon key, PostGIS geo parsing)
- [x] Vercel deployment (auto-deploy on push to main)
- [x] PWA meta tags installed
- [x] Language audit completed
- [x] Homepage structure designed
- [x] UX principles defined
- [x] Ecological social media vision defined

---

## 📋 Session Startup Checklist

Paste this at the start of every Claude Code session:

```
Before we start: please read TASKS.md in the project root.
The current task is under "Now". Work only on that task unless I say otherwise.
When the task is done, mark it [x] in TASKS.md AND move it from Now into the Done section, then tell me.
```
