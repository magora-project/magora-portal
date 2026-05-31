# Magora Project Brief

> Drop this file into any new Claude session to get fully oriented in one read.
> Last updated: 2026-05-31

---

## Vision

The **Magora Network** is a distributed acoustic biodiversity monitoring system. Inexpensive Raspberry Pi nodes with microphones listen continuously to natural soundscapes, identify bird species and insect activity in real time, and post structured data to a cloud database. A web portal and mobile dashboard make that data visible and meaningful.

The long-term goal is a growing network of community-deployed nodes that together paint a high-resolution picture of biodiversity across landscapes — tracking species presence, dawn chorus intensity, acoustic complexity, and seasonal change over time.

---

## System Architecture

```
[birdnode1 (Pi Zero 2W)]
    ↓ BirdNET detections
    ↓ ACI scores + time_category
    ↓ Dawn chorus flag
    ↓ HTTP POST every ~30s
        ↓
[Supabase (PostgreSQL + PostGIS)]
    ├── nodes
    ├── detections
    ├── aci_logs
    ├── species
    └── occurrences_view
        ↓                    ↓
[magora-portal]        [Google Sheets]
(React/Vercel)              ↓
Live detections,    [Google Apps Script]
ACI feed,           Mobile dashboard:
node map            bird photos, Wikipedia
                    facts, Claude insights,
                    charts
```

---

## Hardware: birdnode1

| Property | Value |
|---|---|
| Device | Raspberry Pi Zero 2W |
| Microphone | INMP441 (I2S digital MEMS) |
| Location | Noah's property, Colorado |
| Habitat | Montane scrub |
| Status | Active and posting data |

**What runs on it:**
- **BirdNET** — neural net bird species identification from audio segments
- **ACI (Acoustic Complexity Index)** — broadband measure of soundscape complexity, used as insect activity proxy
- **Dawn chorus detection** — flags detections that occur within the acoustic dawn window (calculated using `astral` library for local sunrise)
- Custom Python service (`birdnet.service`) that runs as a systemd unit, wakes periodically, records, analyzes, and posts to Supabase

**Key files on the Pi:**
- `/home/magora/location.json` — lat/lon/elevation/habitat used by scripts
- `/home/magora/secrets.env` — Supabase service role key (never commit this)
- `/etc/systemd/system/birdnet.service` — service definition

---

## Database: Supabase

**Project URL:** `https://wqxmmuwrfltpaxnuddwk.supabase.co`  
**Stack:** PostgreSQL 15 + PostGIS extension

### Tables

#### `nodes`
Registered monitoring hardware units.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK, auto-generated |
| name | text | Human-readable node name |
| hardware_type | text | 'rpi-zero-2w', 'rpi-4', 'rpi-3b', 'other' |
| location | geometry(Point) | PostGIS POINT(lon lat) |
| elevation_m | numeric | Meters above sea level |
| habitat_type | text | 'montane-scrub', 'forest', 'grassland', 'wetland', 'desert', 'urban-garden', 'farmland', 'coastal', 'other' |
| is_active | boolean | True when node is posting data |
| created_at | timestamptz | Auto |

#### `detections`
Individual bird species detections from BirdNET.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| node_id | uuid | FK → nodes.id |
| species_name | text | Common name (from BirdNET label) |
| raw_label | text | Original BirdNET output label |
| detected_at | timestamptz | UTC timestamp of detection |
| confidence | numeric | BirdNET confidence score 0.0–1.0 |
| is_dawn_chorus | boolean | True if during dawn acoustic window |
| created_at | timestamptz | Auto |

#### `aci_logs`
Acoustic Complexity Index readings, one per analysis window.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| node_id | uuid | FK → nodes.id |
| aci_score | numeric | ACI value 0.0–1.0 (normalized) |
| recorded_at | timestamptz | UTC timestamp of recording window |
| time_category | text | 'Dawn', 'Morning', 'Midday', 'Afternoon', 'Dusk', 'Night' |
| created_at | timestamptz | Auto |

#### `species`
Reference table for species metadata (partially populated).

#### `occurrences_view`
Materialized or live view joining detections with species metadata.

---

## Repositories

**GitHub org:** `github.com/magora-project`

### `magora-portal`
- **URL:** `github.com/magora-project/magora-portal`
- **Local path:** `c:\Users\noahw\Documents\magora-portal`
- **Stack:** React 19, Vite 8, React Router v7, Supabase JS client, Leaflet (installed, not yet active)
- **Deploy:** Vercel — `magora-portal.vercel.app`
- **Branch:** `main` → auto-deploys to Vercel

### `magora-acoustic-biodiversity`
- **URL:** `github.com/magora-project/magora-acoustic-biodiversity`
- **Contents:** Python scripts running on the Pi (BirdNET pipeline, ACI calculation, Supabase posting, Google Sheets integration)

---

## Portal: magora-portal.vercel.app

React SPA, three routes, all inline-styled, beige/green aesthetic.

### Routes

#### `/` — MapPage
- 4 stat cards: active nodes, detection count, latest ACI score (High/Moderate/Low), last updated time
- Map placeholder (Leaflet installed, interactive map not yet built)
- Live ACI feed: last 10 aci_logs with time category, score, bar visualization
- Recent detections: last 50 with species, confidence badge, dawn chorus flag
- Auto-refreshes every 30 seconds

#### `/dashboard` — Dashboard
- 2×2 grid of cards:
  - **My nodes** — node list with online/offline status
  - **ACI by time of day** — bar chart of average ACI per time category (Dawn/Morning/Midday/Afternoon/Dusk/Night)
  - **Top species this week** — top 5 species by detection count
  - **Insect activity (night ACI)** — last 3 night ACI readings labeled Tonight/Last night/2 nights ago

#### `/register` — RegisterNode
- 4-step wizard: account (stub) → hardware selection → location/network config → download setup script
- On step 3 completion, inserts a new row into `nodes` table (is_active = false)
- Step 4 generates and downloads a `magora-setup.sh` bash script that:
  - Configures WiFi
  - Writes location.json and secrets.env to the Pi
  - Installs Python deps (birdnetlib, astral, numpy, requests)
  - Enables birdnet.service

### Key files

| File | Purpose |
|---|---|
| `src/main.jsx` | React entry point |
| `src/App.jsx` | Router, layout shell |
| `src/components/Navbar.jsx` | Top nav with links and sign-in stub |
| `src/pages/MapPage.jsx` | Home page, live feed |
| `src/pages/Dashboard.jsx` | Per-user analytics |
| `src/pages/RegisterNode.jsx` | Node onboarding wizard |
| `src/lib/supabase.js` | Supabase client singleton |
| `.env` | VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY |

### Notable code patterns
- `toMountainTime(utcString, showSeconds)` in MapPage — converts UTC to Mountain Time (UTC−6) by manual offset math, formats as `H:MM:SS AM/PM`
- All styling is inline `style={{}}` objects — no CSS modules or Tailwind
- Data fetching is plain `useEffect` + `setInterval(30s)` polling — no Supabase realtime subscriptions yet

---

## Google Apps Script Dashboard

A mobile-first web app served by Google Apps Script, backed by data synced to Google Sheets from Supabase.

**Features:**
- Bird species cards with photos (sourced externally)
- Wikipedia species facts
- Claude ecological insights (calls Anthropic API)
- Charts of detection trends and ACI over time
- Designed for quick mobile glance

---

## What's Built and Working

- birdnode1 is live and posting detections and ACI to Supabase
- Dawn chorus detection is running and flagging correctly
- Portal loads real data from Supabase and auto-refreshes
- ACI feed and bird detection list are functional
- Node registration wizard writes to DB and generates setup script
- Google Apps Script dashboard is functional
- Supabase PostGIS schema is set up with node location storage
- Vercel deployment is live and CD is wired to main branch

---

## What's In Progress / Incomplete

| Feature | Status | Notes |
|---|---|---|
| Interactive map | Leaflet installed, placeholder shown | Needs node coordinates rendered as markers |
| Authentication | Navbar sign-in is a stub | No auth state, all queries use anon key |
| Protected routes | Not implemented | Dashboard shows all data, not user-scoped |
| Real-time subscriptions | Using 30s polling | Supabase realtime not yet wired up |
| User-scoped dashboard | Shows global data | Needs auth + node ownership model |
| Error handling | Minimal | MapPage/Dashboard don't surface query errors |

---

## Roadmap: What's Next

**Near term (next sessions):**
1. Add Leaflet map to MapPage — render active nodes as markers with popups
2. Implement Supabase Auth — email/password, wire up RegisterNode step 1
3. Scope Dashboard queries to authenticated user's nodes
4. Add RLS policies to Supabase tables

**Medium term:**
- Multi-node support (second Pi deployment)
- Species occurrence calendar view
- Node health monitoring (last_seen, heartbeat)
- Public-facing species gallery page

**Longer term:**
- Community node onboarding (other users deploying their own nodes)
- Export / download data as CSV
- Seasonal comparison charts
- Integration with eBird or iNaturalist

---

## Environment & Credentials

| Secret | Where stored | Used by |
|---|---|---|
| VITE_SUPABASE_URL | .env (portal) | React app (public, safe) |
| VITE_SUPABASE_ANON_KEY | .env (portal) | React app (public, safe) |
| Supabase service role key | /home/magora/secrets.env on Pi | Pi posting scripts |
| Anthropic API key | Google Apps Script properties | Claude insights feature |

> Never commit the service role key or Anthropic key to any repo.

---

## Tech Stack Quick Reference

| Layer | Technology |
|---|---|
| Edge device | Raspberry Pi Zero 2W |
| Microphone | INMP441 (I2S) |
| Audio AI | BirdNET (neural net, Python) |
| Soundscape analysis | ACI (Acoustic Complexity Index) |
| Solar timing | astral (Python) |
| Database | Supabase — PostgreSQL 15 + PostGIS |
| Frontend | React 19 + Vite 8 + React Router v7 |
| Mapping | Leaflet + react-leaflet (installed, not active) |
| Hosting | Vercel (portal), Google Apps Script (mobile dash) |
| Data bridge | Google Sheets + Apps Script |
| AI insights | Claude (Anthropic API, via Apps Script) |
| Version control | GitHub (magora-project org) |
