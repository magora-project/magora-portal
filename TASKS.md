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

- [ ] **Follow system — Supabase + portal**
  - New `node_follows` table: user_id, node_id, created_at
  - Portal-side user auth (Supabase Auth — email or magic link)
  - Follow/unfollow button on NodePage (live)
  - Follower count on node profile
  - Feed tabs: Global | Following
  - Keep "Following" tab gated/hidden until there are enough nodes to follow (empty-room problem)

- [ ] **PWA setup**
  - vite-plugin-pwa already installed
  - Configure manifest: name, icons, theme color (#0d2818), display: standalone
  - Service worker for offline support; test on Android

- [ ] **birdnode1 rebuild**
  - New SD card, flash latest Pi OS image
  - Run magora-firstrun.sh from bootfs config
  - Test provision-node Edge Function
  - Confirm detections flowing to Supabase

- [ ] **provision-node Edge Function**
  - Build and deploy to Supabase
  - Called from RegisterNode wizard step 2
  - Creates node record + JWT auth user

- [ ] **Dashboard redesign — Ecological Patterns**
  - Remove business KPI aesthetic
  - Soundscape health chart → river-style visualization (not bar chart)
  - Add seasonal species shift, guild breakdown, migration timing

- [ ] **Donate page** — `/donate` route, participation-first framing (sponsor nodes, open infrastructure)

---

## ✅ Done

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
