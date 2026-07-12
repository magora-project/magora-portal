/* global process, fetch */
// Universal Range-Validity Gate — historical backfill / re-scan (Range-Gate Completion v1, Part B).
//
// The gate (migration 20260720) is enforced as a BEFORE-INSERT trigger, so it only classifies
// rows written AFTER it went live. Everything already in `detections` and `mobile_detections`
// (the original penguin, the ~106 Rook rows at Casa Colibri, and everything legitimate) is still
// stored as range_status = 'unchecked' and therefore renders normally even now that the read
// side filters quarantined rows. This job walks the existing rows once and classifies them with
// the SAME primitive the triggers use: public.is_plausible(species_id, lat, lon, week).
//
// FAIL-OPEN IS PRESERVED. is_plausible is tri-state:
//   true  -> 'plausible'     (species in the cell's allowlist)
//   false -> 'quarantined'   (cell HAS an allowlist but the species is absent)
//   null  -> 'unchecked'     (no allowlist for the cell yet — uncovered cell / coverage guard)
// A row in an uncovered (unseeded) cell stays 'unchecked' and is NEVER quarantined. With only
// the 8 well-covered cells seeded, this run only quarantines covered-cell false-positives (which
// is exactly where the Rook / penguin sit). Raw rows are never deleted — only range_status /
// range_checked_at change.
//
// IDEMPOTENT + BATCHED. Rows are paginated by keyset (id) in batches; is_plausible is memoized
// per (cell_key, species_id) so the 106 Rook rows cost one RPC call, not 106. Each row is PATCHed
// ONLY when its computed status differs from what is stored, so a second run writes nothing
// (converges to the same state). Safe to re-run after an allowlist rebuild to re-scan.
//
// SERVICE ROLE. Writes go directly to the base tables (bypassing RLS), so this needs
// SUPABASE_SERVICE_ROLE_KEY — the same key the allowlist builder uses, never a VITE_ client var.
// The mobile_detections path reads/writes ONLY range fields + coordinates; it never touches or
// exposes user_id (listeners.id = auth.users(id)).
//
// Usage:  node scripts/range-backfill.mjs          (dry run — classifies + reports, no writes)
//         node scripts/range-backfill.mjs --apply  (writes range_status / range_checked_at)
//
// Env (auto-loaded from .env.local / .env by the caller): VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

const APPLY = process.argv.includes('--apply')
const URL = process.env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (service role required — writes bypass RLS)')
  process.exit(1)
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }
const PAGE = 500
const norm = (s) => String(s || '').trim().toLowerCase()

async function pgGet(path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: H })
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}
async function pgPatch(path, body) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`PATCH ${path}: ${res.status} ${await res.text()}`)
}
async function pgRpc(name, args) {
  const res = await fetch(`${URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: H, body: JSON.stringify(args) })
  if (!res.ok) throw new Error(`rpc ${name}: ${res.status} ${await res.text()}`)
  return res.json()
}

// Mirror of public.range_week(ts): BirdNET-style 48-week number (4 weeks/month, clamped).
// v1 allowlist is entirely week 0 ("all weeks"), so is_plausible matches regardless of this
// value today; computed faithfully so a future week-resolved rebuild re-scans correctly.
function rangeWeek(ts) {
  if (!ts) return null
  const d = new Date(ts)
  const month = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  return (month - 1) * 4 + Math.min(Math.ceil(day / 7), 4)
}

// Mirror of public.range_status_of(plausible) — the ONE place the tri-state maps to the
// vocabulary. The plausibility decision itself stays entirely in is_plausible (the DB).
function statusOf(plausible) {
  if (plausible === null || plausible === undefined) return 'unchecked'
  return plausible ? 'plausible' : 'quarantined'
}

// Memoized is_plausible: keyed on (cell-ish) coords + species. The 0.5° cell is what actually
// determines the allowlist, but rounding coords to 4dp is a safe finer key (same species at the
// same place collapses to one call — e.g. all 106 Rook rows at Casa Colibri => 1 RPC).
const plausibleCache = new Map()
async function isPlausible(speciesId, lat, lon, week) {
  if (!speciesId || lat == null || lon == null) return null // matches is_plausible's own null guard
  const k = `${speciesId}|${lat.toFixed(4)}|${lon.toFixed(4)}|${week}`
  if (plausibleCache.has(k)) return plausibleCache.get(k)
  const v = await pgRpc('is_plausible', { p_species_id: speciesId, p_lat: lat, p_lon: lon, p_week: week })
  plausibleCache.set(k, v)
  return v
}

function tally() {
  return { seen: 0, plausible: 0, quarantined: 0, unchecked: 0, changed: 0, skipped_no_coords: 0 }
}
function logTally(label, t) {
  console.log(
    `${label}: ${t.seen} rows | plausible ${t.plausible}, quarantined ${t.quarantined}, unchecked ${t.unchecked} | ` +
    `${APPLY ? 'updated' : 'would update'} ${t.changed}` +
    (t.skipped_no_coords ? ` | ${t.skipped_no_coords} without resolvable coords (left as-is, fail-open)` : ''),
  )
}

// ── detections (node path) ────────────────────────────────────────────────────
// Mirrors gate_detection_range: lat/lon from the detection's own point when present, else the
// owning node's location; species_id is already resolved on the row.
async function backfillDetections() {
  const nodes = await pgGet('nodes?select=id,location')
  const nodeCoord = new Map() // id -> { lat, lon }
  for (const n of nodes) {
    const c = n.location?.coordinates // GeoJSON [lon, lat]
    if (Array.isArray(c)) nodeCoord.set(n.id, { lat: c[1], lon: c[0] })
  }

  const t = tally()
  let after = ''
  for (;;) {
    const rows = await pgGet(
      `detections?select=id,species_id,node_id,detected_at,location,range_status` +
        `&order=id.asc&limit=${PAGE}${after}`,
    )
    if (!rows.length) break
    for (const r of rows) {
      t.seen++
      let lat = null, lon = null
      const c = r.location?.coordinates // detection's own point (GeoJSON [lon, lat]) if any
      if (Array.isArray(c)) { lat = c[1]; lon = c[0] }
      else if (r.node_id && nodeCoord.has(r.node_id)) { const nc = nodeCoord.get(r.node_id); lat = nc.lat; lon = nc.lon }
      if (lat == null || lon == null) t.skipped_no_coords++

      const status = statusOf(await isPlausible(r.species_id, lat, lon, rangeWeek(r.detected_at)))
      t[status]++
      if (status !== r.range_status) {
        t.changed++
        if (APPLY) await pgPatch(`detections?id=eq.${r.id}`, { range_status: status, range_checked_at: new Date().toISOString() })
      }
    }
    after = `&id=gt.${encodeURIComponent(rows[rows.length - 1].id)}`
    if (rows.length < PAGE) break
  }
  logTally('detections', t)
  return t
}

// ── mobile_detections (listen-post path) ──────────────────────────────────────
// Mirrors gate_mobile_detection_range: gate on the PRIMARY (highest-confidence) species of the
// `species` jsonb, resolved to a species_id via scientific_name then common_name; lat/lon are
// columns on the row. Reads/writes ONLY range fields + the primary species — never user_id.
async function backfillMobile() {
  const species = await pgGet('species?select=id,scientific_name,common_name')
  const bySci = new Map(), byCommon = new Map()
  for (const s of species) {
    if (s.scientific_name) bySci.set(norm(s.scientific_name), s.id)
    if (s.common_name) byCommon.set(norm(s.common_name), s.id)
  }
  const resolvePrimary = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return null
    const primary = arr.reduce((best, e) => ((Number(e?.confidence) || 0) > (Number(best?.confidence) || 0) ? e : best), arr[0])
    return bySci.get(norm(primary?.scientific_name)) || byCommon.get(norm(primary?.common_name)) || null
  }

  const t = tally()
  let after = ''
  for (;;) {
    const rows = await pgGet(
      `mobile_detections?select=id,lat,lon,detected_at,species,range_status` +
        `&order=id.asc&limit=${PAGE}${after}`,
    )
    if (!rows.length) break
    for (const r of rows) {
      t.seen++
      const speciesId = resolvePrimary(r.species)
      if (r.lat == null || r.lon == null) t.skipped_no_coords++
      const status = statusOf(await isPlausible(speciesId, r.lat, r.lon, rangeWeek(r.detected_at)))
      t[status]++
      if (status !== r.range_status) {
        t.changed++
        if (APPLY) await pgPatch(`mobile_detections?id=eq.${r.id}`, { range_status: status, range_checked_at: new Date().toISOString() })
      }
    }
    after = `&id=gt.${encodeURIComponent(rows[rows.length - 1].id)}`
    if (rows.length < PAGE) break
  }
  logTally('mobile_detections', t)
  return t
}

console.log(`Range-gate historical backfill — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`)
const d = await backfillDetections()
const m = await backfillMobile()
console.log(
  `\ntotal ${APPLY ? 'updated' : 'would update'}: ${d.changed + m.changed} ` +
  `(quarantined: ${d.quarantined + m.quarantined})`,
)
if (!APPLY) console.log('DRY RUN — no writes. Re-run with --apply to backfill.')
