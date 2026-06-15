# Magora Project Brief

> Drop this file into any new Claude session to get fully oriented in one read.
> Last updated: 2026-06-15

---

## Vision

The **Magora Network** is a distributed acoustic biodiversity monitoring system. Inexpensive Raspberry Pi nodes with microphones listen continuously to natural soundscapes, identify bird species and insect activity in real time, and post structured data to a cloud database. A web portal makes that data visible and meaningful.

The long-term goal is a growing network of community-deployed nodes that together paint a high-resolution picture of biodiversity across landscapes — tracking species presence, dawn chorus intensity, acoustic complexity, and seasonal change over time.

---

## System Architecture

```
[Pi node (birdnode2)]
    ↓ signs in via Supabase Auth (per-node JWT)
    ↓ BirdNET detections every ~15s
    ↓ ACI score + time_category
    ↓ Dawn chorus flag + temporal context
        ↓
[Supabase (PostgreSQL + PostGIS)]
    ├── nodes
    ├── detections
    ├── aci_logs
    └── species (auto-seeded via trigger)
        ↓
[magora-portal (React/Vercel)]
    Live map, node profiles,
    detection feed, bird call audio,
    ecological insights
```

---

## Hardware: birdnode2

| Property | Value |
|---|---|
| Device | Raspberry Pi Zero 2W |
| Microphone | adau7002 (I2S, via adau7002-simple overlay) |
| Audio device | `hw:adau7002,0` — use name not number (card number changes on reboot) |
| Location | Noah's property, Colorado |
| Habitat | Montane scrub |
| Node ID | 4f3c3835-95fb-493b-b442-3e0652d8894b |
| Status | Active, posting every ~15 seconds |

**What runs on it:**
- **BirdNET** (birdnetlib) — neural net bird ID from 15-second audio windows
- **ACI** — Acoustic Complexity Index, used as insect/soundscape activity proxy
- **Dawn chorus detection** — flags detections in the acoustic dawn window (astral library for local sunrise)
- **Temporal context** — season, phenological week, minutes from sunrise on every detection

**Key Pi files:**
- `/home/magora/secrets.env` — node credentials (600 permissions, never commit)
- `/home/magora/location.json` — lat/lon/name
- `/home/magora/birdnet-env/` — Python 3.13 venv (birdnetlib, ai-edge-litert, librosa, astral)
- `/etc/systemd/system/birdnet.service` — systemd unit, runs as `magora` user, restarts always
- `/home/magora/detect.py` — main firmware (downloaded from GitHub on setup)

**tflite note:** Python 3.13 has no tflite_runtime wheel. Uses `ai-edge-litert` with a compatibility shim at `birdnet-env/lib/python3.13/site-packages/tflite_runtime/interpreter.py`.

---

## Auth Architecture (per-node identity)

Each Pi node has its own Supabase Auth user. No shared service role key on the Pi.

- **Synthetic email:** `node-<uuid>@magora.internal`
- **Password:** random UUID string, generated at registration
- **JWT flow:** `detect.py` calls `/auth/v1/token?grant_type=password` on startup, attaches Bearer token to all REST calls. Re-authenticates on 401.
- **provision-node Edge Function:** creates auth user + nodes row. Protected by `x-provision-secret` header. Deployed `--no-verify-jwt`.
- **RLS:** nodes can INSERT their own rows (`auth.uid() = node_id`). Portal reads with anon key via public SELECT policies.
- **species trigger:** `auto_seed_species()` is `SECURITY DEFINER` — required so the trigger can INSERT into species from a node's JWT.

**Secrets:**
| Secret | Where |
|---|---|
| VITE_SUPABASE_URL | portal .env + Vercel env vars |
| VITE_SUPABASE_ANON_KEY | portal .env + Vercel env vars |
| VITE_PROVISION_SECRET | portal .env + Vercel env vars |
| NODE_EMAIL / NODE_PASSWORD / NODE_ID / SUPABASE_ANON_KEY | /home/magora/secrets.env on Pi |

> Never commit secrets.env or .env to any repo. .env is gitignored.

---

## Database: Supabase

**Project URL:** `https://wqxmmuwrfltpaxnuddwk.supabase.co`  
**Stack:** PostgreSQL 15 + PostGIS

### Tables

#### `nodes`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK = Supabase Auth user UUID |
| name | text | Human-readable node name |
| hardware_type | text | 'rpi-zero-2w', 'rpi-4', 'rpi-3b', 'other' |
| location | geometry(Point) | PostGIS POINT(lon lat) |
| elevation_m | numeric | Meters above sea level |
| habitat_type | text | 'montane-scrub', 'forest', 'grassland', etc. |
| is_active | boolean | Defaults true on registration |
| created_at | timestamptz | Auto |

#### `detections`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| node_id | uuid | FK → nodes.id |
| species_name | text | Common name |
| raw_label | text | BirdNET label: "CommonName_ScientificName" |
| detected_at | timestamptz | UTC |
| confidence | numeric | 0.0–1.0 |
| is_dawn_chorus | boolean | |
| season | text | winter/early_spring/breeding/post_breeding/fall_migration/late_fall |
| minutes_from_sunrise | integer | Negative = pre-dawn |
| location | geometry(Point) | PostGIS point |

#### `aci_logs`
| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| node_id | uuid | FK → nodes.id |
| aci_score | numeric | 0.0–1.0 |
| recorded_at | timestamptz | UTC |
| time_category | text | Dawn/Morning/Midday/Afternoon/Dusk/Night |
| dawn_chorus | boolean | |
| duration_secs | integer | 15 |

#### `species`
Reference table, auto-seeded on detection INSERT via `auto_seed_species()` trigger (SECURITY DEFINER). Columns include guild, migratory_status, sensitivity_flag, indicator_status.

---

## Repositories

**GitHub org:** `github.com/magora-project`

### `magora-portal`
- **Local:** `c:\Users\noahw\Documents\magora-portal`
- **Live:** `magora-portal.vercel.app`
- **Deploy:** push to `main` → Vercel auto-deploys
- **Stack:** React 19 + Vite + React Router v7 + Supabase JS + Leaflet

### `magora-acoustic-biodiversity`
- **Local:** `c:\Users\noahw\Documents\magora-acoustic-biodiversity`
- **Contents:** Pi firmware — `firmware/detect.py`, `firmware/birdnet.service`

---

## Portal: magora-portal.vercel.app

### Routes

| Path | Page | What it does |
|---|---|---|
| `/` | MapPage | Leaflet map, bird detections (all nodes), ACI feed, 30s refresh |
| `/node/:id` | NodePage | Node profile — info tiles, ACI sparkline, filtered detections + log |
| `/dashboard` | Dashboard | Analytics — ACI by time of day, top species, node list |
| `/register` | RegisterNode | 5-step wizard to onboard a new node |
| `/about` | AboutPage | Project info |

### Key source files

```
src/
  App.jsx                         Router + layout
  components/
    Navbar.jsx                    Top nav
    DetectionCard.jsx             Shared detection card — badges, audio, insight
  pages/
    MapPage.jsx                   Home — map + live feed
    NodePage.jsx                  Node profile page
    Dashboard.jsx                 Analytics
    RegisterNode.jsx              5-step onboarding wizard
  lib/
    supabase.js                   Supabase client (anon key)
    geo.js                        parseNodeLocation — PostGIS WKB → {lat, lon}
  supabase/functions/
    provision-node/index.ts       Edge Function — creates auth user + node row
```

### DetectionCard features
- Confidence, time, dawn chorus, season, sunrise offset badges (each tappable for explanation)
- Guild + migration status + sensitivity flag from species table
- Wikipedia thumbnail + first-sentence fact
- **🔊 Listen** — fetches from xeno-canto API by scientific name, plays song inline (toggle pause/resume)
- **🌿 Get Ecological Insight** — calls `/api/insight` Claude endpoint

### NodePage features
- Info tiles: habitat, elevation, coordinates, live ACI level
- ACI sparkline — last 24 readings as color-coded bar chart (green = high, teal = moderate, dark = low)
- Detections filtered to this node (deduped by species, count badge)
- Acoustic log for this node

### RegisterNode wizard (5 steps)
1. **Hardware** — choose board + node name
2. **Location** — lat/lon, WiFi SSID/password, habitat → calls provision-node Edge Function
3. **Flash** — step-by-step Raspberry Pi Imager guide (highlighted warning for OS customisation popup)
4. **Setup** — download `magora-setup.sh` + SSH command with copy button
5. **Live!** — polls `aci_logs` every 5s until first reading from new node arrives

### Setup script (`magora-setup.sh`) does:
- WiFi via nmcli (Pi OS Bookworm) with wpa_supplicant fallback
- Waits for network (ping 8.8.8.8)
- Creates `magora` system user, audio group
- Writes secrets.env + location.json
- Adds I2S overlay to config.txt (idempotent check)
- Downloads detect.py + birdnet.service from GitHub
- Creates Python venv, installs deps, creates tflite shim (Python version auto-detected)
- Enables + starts birdnet.service

---

## What's Built and Working

- birdnode2 live, posting detections + ACI every ~15 seconds
- Per-node Supabase Auth with RLS enforced
- Interactive Leaflet map with clickable nodes
- Node profile pages at `/node/:id`
- Bird call audio via xeno-canto (🔊 Listen button on every detection)
- Detection cards with guild/migration/sensitivity badges + Wikipedia facts + Claude insights
- 5-step node registration wizard with live "waiting for node" polling
- Vercel CD live, auto-deploys from main

---

## What's Not Done Yet

| Feature | Notes |
|---|---|
| Portal user auth | Sign-in button is a stub. All reads use anon key. |
| Realtime subscriptions | Using 30s polling. Worth switching when user auth is in place. |
| Dashboard per-node filtering | Shows global data, not scoped to a node |
| Error handling | Supabase errors fail silently |
| Timezone per node | toMountainTime() hardcodes UTC−6 |

---

## Tech Stack Quick Reference

| Layer | Technology |
|---|---|
| Edge device | Raspberry Pi Zero 2W |
| Microphone | adau7002 (I2S) |
| Audio AI | BirdNET via birdnetlib |
| Soundscape analysis | ACI (Acoustic Complexity Index) |
| Solar timing | astral (Python) |
| TFLite runtime | ai-edge-litert + compatibility shim |
| Database | Supabase — PostgreSQL 15 + PostGIS |
| Auth | Supabase Auth (per-node identities) |
| Edge functions | Supabase Edge Functions (Deno) |
| Frontend | React 19 + Vite + React Router v7 |
| Mapping | Leaflet + react-leaflet |
| Bird call audio | xeno-canto public API |
| Hosting | Vercel |
| AI insights | Claude via /api/insight |
