# Magora Portal — Task Manager

> **How this works:**
> - Claude Code reads this file at the start of every session as part of your context note
> - When a task is done, mark it `[x]` and move it to Done
> - When you come to Claude (chat) for planning, this file gets updated with new tasks
> - This file is always the source of truth for what to build next
> - NOTE: Don't reference Obsidian vault docs in task descriptions — Claude Code only sees files synced locally to the PC, not the Drive copies. Inline any needed guidance directly in the task.

---

## 🔴 Now — Currently Building

_Nothing in progress — pull the next task up from "Next"/"Backlog" when ready._

---

## 🟡 Next — Confirmed, In Order

_Empty — promote from Backlog when ready._

---

## 🔵 Backlog — Prioritized

- [x] **Listen feature — Phase 5: Offline queue**
  - Added `idb` queue in `src/lib/listenQueue.js` for pending offline recordings
  - `ListenModal.jsx` saves offline recordings locally when offline and auto-syncs on reconnect
  - `App.jsx` starts the queue listener at app launch
  - `MapPage.jsx` renders queued local Listens as "Syncing…" cards in the feed

- [ ] **Listener Field Journal** — public profile + field journal for Listeners (people who use Listen, no hardware). Route: `/journal/:handle`. A Listener profile is a FIELD JOURNAL (a person's relationship with many places), distinct from a NodePage (a place profile). Deliberate design line: NO follow system for Listeners in v1 — we follow places, not people.
  - **New `listeners` table** (Option B, same pattern as `nodes`): `id uuid pk references auth.users(id)` (= auth.uid(), no join table), `handle text unique not null` (lowercase, URL-safe [a-z0-9_], reserved-word blocklist incl. admin/api/journal), `display_name`, `bio`, `home_region`, `avatar_path`, `created_at`. RLS: public SELECT; insert/update only own row. Handle-claim UI on first Listen or first journal visit + client-side format validation.
  - **Profile editor**: display_name, bio, home_region, avatar upload (small, public-read).
  - **Sanitized journal data path** — CRITICAL PRIVACY GATE: before building, inspect the `public_mobile_detections` view definition and confirm whether it exposes `user_id`. If yes, the journal view can join on it. If NO (stripped for privacy), do the join on base `mobile_detections` inside a SECURITY DEFINER function, still applying the ~110m coord coarsening. The journal must never leak precise coordinates, observer notes, audio paths, or anything the public feed already hides.
  - **`/journal/:handle` page** (vertical order): (1) life-list headline stat — "23 species across 11 places"; (2) journal map — reuse Leaflet, amber pulse markers, this Listener's Listens only, auto-fit bounds, ~110m coarsened, tap marker → full Listen results; (3) journal entries list — each Listen as a notebook entry (location name, date, species count, top species), chronological, tap → full results.
  - **Wire-up**: link MobileDetectionCard's "Listened by @handle" → `/journal/:handle`; add "My journal" to the account menu; share button reusing the DetectionCard share pattern.
  - **Build order**: table+RLS+handle UI → profile editor → sanitized data path → page → wire-up → share. Pause after each for confirmation.
  - **Out of scope v1**: no follow system, no private/public toggle (public by default), no species-page links yet (render species as plain text).
  - **Language** (per the Language Audit): the person is a "Listener" not "user" in public copy; the page is their "field journal"; a recording is "a Listen"; the species total is their "life list."

- [ ] **birdnode1 rebuild**
  - New SD card, flash latest Pi OS image
  - Run magora-firstrun.sh from bootfs config
  - Test provision-node Edge Function
  - Confirm detections flowing to Supabase

- [ ] **provision-node Edge Function**
  - Build and deploy to Supabase
  - Called from RegisterNode wizard step 2
  - Creates node record + JWT auth user


---

## ✅ Done

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
