# Listen Sessions — design doc (Task G)

Status: **DRAFT for review.** No migration written yet. This scopes the data model
and the flow so we can confirm the shape before touching prod.

## Goal

Turn a listener's outing into **one Listen session** that can hold several captures
and produces **one synthesized "what your session heard" insight**, instead of a
separate insight per capture. Two payoffs:

1. **Product:** reads the whole soundscape of a place as a unit — truer to the
   whole-ecosystem thesis than N disconnected per-capture blurbs.
2. **Cost:** one insight per outing instead of one per capture (~4–5× fewer calls
   when listeners take multiple captures), and the session insight is generated
   *after* the outing, which is the async, Batch-able artifact Task H wants.

Savings are real **only because we're also adding the multi-capture flow** — a
session that is one capture (N=1) behaves like today, with no extra cost.

## Current state (from the migrations + ListenModal)

- `mobile_detections` = one row per capture: `id, user_id, detected_at, lat/lon,
  status, species(jsonb), habitat/canopy/water/disturbance, observer_notes,
  insight, published`. Owner-only RLS; a per-capture insight cached on the row.
- `public_mobile_detections` view exposes the sanitized row (coords coarsened to
  ~110m, `insight`, `listener_handle`); feed renders one card per row.
- `set_detection_insight(id, text)` RPC writes the per-row insight once (when null).
- **ListenModal is one-capture-per-open:** record → results → publish → close.
  There is no "record another."
- The Fly.io worker runs BirdNET per clip via the `audio_inference` queue; it never
  touches insights.

## The model

**Every new Listen becomes a session (N ≥ 1).** New captures always get a
`session_id`; the session owns the insight. Legacy rows (`session_id = null`) and
all node detections keep their existing per-row path untouched — the two insight
homes compose cleanly (feed picks the right one per card type).

### New table

```
listen_sessions (
  id            uuid pk default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  lat, lon      float8,            -- session centroid (coarsened in the view)
  -- place metadata, collected ONCE for the outing (see Open decision 1)
  habitat_type, canopy_cover, water_present, disturbance_level, observer_notes,
  insight       text,             -- the synthesized session insight
  published     boolean not null default false
)
```

Plus `alter table mobile_detections add column session_id uuid references
listen_sessions(id) on delete set null;`

- RLS on `listen_sessions`: owner-only select/insert/update/delete (mirror
  `mobile_detections`).
- `public_listen_sessions` view: `security_invoker = false`, exposes
  `id, started_at, ended_at, round(lat,3), round(lon,3), metadata, insight,
  listener_handle`, and the **species heard across the session's captures**
  (aggregated — see Open decision 2). Filter: `published = true` and the session
  has ≥1 completed capture.
- `set_session_insight(session_id, text)` RPC, SECURITY DEFINER, writes once when
  null — exact mirror of `set_detection_insight`, for on-demand regeneration of
  older sessions from the feed.

### Capture flow (ListenModal)

- Session is created lazily on the **first** capture of a modal open.
- Each capture still becomes a `mobile_detections` row (BirdNET still runs per
  clip through the existing queue), now stamped with `session_id`.
- Results screen gains **"Record another spot"** (loops back to record, same
  session) alongside **"Finish & read the soundscape."**
- On finish: collect the session's place metadata + notes once, POST the
  **union of species across all captures** to `/api/insight` (the existing
  `mobile` branch already reads all species "as one community" — no prompt
  rewrite, just aggregated input), store the result on `listen_sessions.insight`,
  then **publish the session** (posts all its captures + the session insight) or
  discard.

### Feed / UI

- The **session becomes the feed unit.** MapPage/Journal fetch
  `public_listen_sessions` (new) + `public_mobile_detections where session_id is
  null` (legacy) + node detections, merged by time. One map marker per session
  (centroid).
- New `SessionCard` (or a `MobileDetectionCard` variant): species across captures,
  capture count ("3 spots"), the session insight, listener handle. Legacy single
  rows and node cards render exactly as today.
- **Privacy bonus:** only the session centroid is exposed publicly; individual
  per-clip coordinates stay private.

### Insight generation & Task H

- Generated once at "finish session" — synchronous for now (the listener waits
  once per outing, already fewer calls than per-capture).
- Cached on `listen_sessions.insight`; regenerated on demand via
  `set_session_insight`.
- Task H later moves this generation to the Batch API (fire-and-store: "we're
  reading your soundscape, check your feed in a moment"), since it's post-outing.

## Build phases (each independently testable)

- **A — DB migration:** `listen_sessions` + `session_id` + RLS + public view +
  `set_session_insight`. **← confirm this with you before applying to prod.**
- **B — capture flow:** ListenModal multi-capture UX; lazy session; tag captures;
  session metadata; generate + publish session insight.
- **C — feed:** session cards; merge legacy + node; per-session map markers.
- **D — journal / regeneration:** on-demand session-insight regen; journal shows
  sessions.

## Backward compatibility

- Existing `mobile_detections` keep `session_id = null` and their per-row
  `insight`; render via `public_mobile_detections` as today. **No backfill.**
- Going forward, new rows always belong to a session; `mobile_detections.insight`
  becomes legacy-only.

## Open decisions (need your call before/while building Phase A)

1. **Metadata scope:** collect place metadata **once per session** (recommended —
   the outing is "this place") vs per capture. If "another spot" means genuinely
   different micro-habitats you'd want recorded separately, we'd keep per-capture
   metadata instead. Recommend per-session for v1.
2. **Species aggregation location:** aggregate the session's species **in the
   view** (efficient single feed query, but fiddlier SQL: union across captures,
   dedupe by name keeping max confidence) vs **client-side** (simpler view, feed
   fetches a session's captures and reuses the existing dedupe logic). Recommend
   in-view for feed simplicity; fall back to client-side if the SQL gets ugly.
3. **Generation timing for v1:** synchronous at "finish" (simpler, ships G on its
   own) vs go straight to async/Batch now (couples G with H). Recommend
   synchronous now, Batch as Task H.
4. **Offline queue (Phase 5):** how a session interacts with the existing offline
   queue if captures are taken offline. Flagging as a later concern, not a
   Phase A/B blocker.
