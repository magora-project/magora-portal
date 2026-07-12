/* global process */
// Universal Range-Validity Gate v1 — allowlist builder (batch, monthly cron).
//
// Populates public.range_allowlist: for each ACTIVE location cell (derived from node
// coordinates + recent listen-post coordinates), the set of plausible species for that cell.
// Source of truth is eBird occurrence — the same structured range data that constrains
// BirdNET inference — via `data/obs/geo/recent` (species reported within 50 km recently).
// This is the LOAD-BEARING reference the DB gate (is_plausible / the detection triggers)
// checks against; see migration 20260720.
//
// WRITES GO THROUGH replace_range_cell, a SECURITY DEFINER RPC granted to service_role ONLY
// (never anon — deliberate, per the trait-ETL precedent). So this job runs on the SERVICE
// ROLE key, unlike the anon-key Vercel functions. It therefore needs SUPABASE_SERVICE_ROLE_KEY
// in the environment (Vercel Production env, server-side only — NOT a VITE_ client var).
//
// v1 is CELL-resolved, week-AGNOSTIC: rows are written at week = 0 ("all weeks"). The schema
// + is_plausible already take a week, so a future week-resolved rebuild can tighten to 1..48
// with no schema change. Cadence affects freshness only, not correctness.

const EBIRD_BASE = 'https://api.ebird.org/v2'
const CELL_DEG = 0.5            // must match range_cell_key() in migration 20260720
const EBIRD_DIST_KM = 50
const EBIRD_BACK_DAYS = 30
const SOURCE = 'ebird:obs_geo_recent'

// GLOBAL-FIRST COVERAGE GUARD (EIA §8: an unimplemented region goes quiet, never wrong).
// The `species` table is currently North-America-biased. In a region where it maps only a
// small fraction of what eBird reports, the resulting allowlist is INCOMPLETE, and an
// incomplete allowlist would wrongly QUARANTINE legitimate local species. So we refuse to
// build a cell whose coverage is too low — it stays allowlist-free, and is_plausible()
// fail-opens (unchecked) there instead of over-quarantining. Well-covered cells map ~55–90%;
// poorly-covered (e.g. tropical) cells map <10%. These thresholds cleanly separate them.
const MIN_CELL_SPECIES = 25     // absolute floor of mapped species to trust a cell
const MIN_CELL_COVERAGE = 0.4   // mapped / eBird-reported ratio floor

// Cell key — MUST mirror public.range_cell_key(lat, lon) exactly.
export function cellKey(lat, lon) {
  if (lat == null || lon == null) return null
  return `${Math.floor(lat / CELL_DEG)}:${Math.floor(lon / CELL_DEG)}`
}

function svc() {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required')
  return { url, key, headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' } }
}

async function sbGet(path) {
  const { url, headers } = svc()
  const res = await fetch(`${url}/rest/v1/${path}`, { headers })
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function sbRpc(name, args) {
  const { url, headers } = svc()
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args) })
  if (!res.ok) throw new Error(`rpc ${name}: ${res.status} ${await res.text()}`)
  return res.json()
}

// eBird species reported within EBIRD_DIST_KM of (lat,lon) in the last EBIRD_BACK_DAYS.
// Returns [{ sciName, comName, speciesCode }]. Best-effort: [] on any failure.
async function ebirdNearby(lat, lon, ebirdKey) {
  const u = `${EBIRD_BASE}/data/obs/geo/recent?lat=${lat}&lng=${lon}` +
    `&dist=${EBIRD_DIST_KM}&back=${EBIRD_BACK_DAYS}&maxResults=10000`
  const res = await fetch(u, { headers: { 'X-eBirdApiToken': ebirdKey } })
  if (!res.ok) return []
  const obs = await res.json()
  if (!Array.isArray(obs)) return []
  const seen = new Map()
  for (const o of obs) if (o.speciesCode && !seen.has(o.speciesCode)) seen.set(o.speciesCode, o)
  return [...seen.values()]
}

// Gather ACTIVE cells -> a representative {lat, lon} (an actual place in the cell), from
// active node coordinates and recent listen-post coordinates. No per-named-node config: a
// place enters the set purely by having coordinates.
async function activeCells() {
  const cells = new Map() // cellKey -> { lat, lon, sources:Set }
  const note = (lat, lon, src) => {
    const k = cellKey(lat, lon)
    if (!k) return
    if (!cells.has(k)) cells.set(k, { lat, lon, sources: new Set() })
    cells.get(k).sources.add(src)
  }
  // Nodes: PostGIS location comes back as GeoJSON [lon, lat].
  const nodes = await sbGet('nodes?select=id,location,is_active&is_active=eq.true')
  for (const n of nodes) {
    const c = n.location?.coordinates
    if (Array.isArray(c)) note(c[1], c[0], 'node')
  }
  // Recent listen posts (service role bypasses owner RLS; we read only coordinates).
  const since = new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString()
  const posts = await sbGet(`mobile_detections?select=lat,lon,detected_at&detected_at=gte.${since}`)
  for (const p of posts) if (p.lat != null && p.lon != null) note(p.lat, p.lon, 'mobile')
  return cells
}

// Build scientific_name / ebird_code / common_name -> species_id lookups (one pass).
async function speciesLookups() {
  const rows = await sbGet('species?select=id,scientific_name,ebird_code,common_name')
  const bySci = new Map(), byCode = new Map(), byCommon = new Map()
  for (const s of rows) {
    if (s.scientific_name) bySci.set(s.scientific_name.toLowerCase(), s.id)
    if (s.ebird_code) byCode.set(s.ebird_code, s.id)
    if (s.common_name) byCommon.set(s.common_name.toLowerCase(), s.id)
  }
  return { bySci, byCode, byCommon }
}

// Core builder — callable directly (local seed/verify) or via the cron handler.
export async function buildAllowlist({ ebirdKey } = {}) {
  const key = ebirdKey || process.env.EBIRD_API_KEY
  if (!key) throw new Error('EBIRD_API_KEY required')

  const [cells, look] = await Promise.all([activeCells(), speciesLookups()])
  const report = { cells: cells.size, built: [], skipped: [] }

  for (const [ck, rep] of cells) {
    const obs = await ebirdNearby(rep.lat, rep.lon, key)
    if (obs.length === 0) { report.skipped.push({ cell: ck, reason: 'no eBird obs' }); continue }
    const ids = new Set()
    let unmapped = 0
    for (const o of obs) {
      const id = look.byCode.get(o.speciesCode)
        || look.bySci.get((o.sciName || '').toLowerCase())
        || look.byCommon.get((o.comName || '').toLowerCase())
      if (id) ids.add(id); else unmapped++
    }
    if (ids.size === 0) { report.skipped.push({ cell: ck, reason: 'no species mapped', ebird: obs.length }); continue }
    // Coverage guard — refuse to build an incomplete cell (would over-quarantine). Fail-open.
    if (ids.size < MIN_CELL_SPECIES || ids.size / obs.length < MIN_CELL_COVERAGE) {
      report.skipped.push({ cell: ck, reason: 'low coverage', ebird: obs.length, mapped: ids.size })
      continue
    }
    const written = await sbRpc('replace_range_cell', {
      p_cell_key: ck, p_week: 0, p_species_ids: [...ids], p_source: SOURCE,
    })
    report.built.push({ cell: ck, lat: rep.lat, lon: rep.lon, ebird: obs.length, mapped: ids.size, unmapped, written })
  }
  return report
}

export default async function handler(req, res) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set
  // (same gate as insight-batch / node-status-check).
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  try {
    const report = await buildAllowlist()
    return res.status(200).json({ ok: true, ...report })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message })
  }
}
