// Pulse Agent v1 — data sources (grounded, verified tables) + the stubbed knowledge
// seams. Every accessor is read-only and degrades to empty/neutral on failure, so a
// missing source never crashes a run.

import { pgFetch, pgCount } from './db.js'
import { PULSE_CONFIG } from './payload.js'

const enc = encodeURIComponent

// ── Node basics ──────────────────────────────────────────────────────────────
export async function nodeCoords(nodeId) {
  const node = await pgFetch(`nodes?id=eq.${nodeId}&select=id,name,location,elevation_m`)
  const coords = node?.location?.coordinates // GeoJSON [lon, lat]
  if (!coords) return { node, lat: null, lon: null }
  return { node, lat: coords[1], lon: coords[0] }
}

// ── detections (the primary baseline: "what changed") ────────────────────────
/** Distinct species detected in [start, end), with first-seen/confidence within window. */
export async function detectionsInWindow(nodeId, window) {
  const rows = await pgFetch(
    `detections?node_id=eq.${nodeId}` +
      `&detected_at=gte.${enc(window.start)}&detected_at=lt.${enc(window.end)}` +
      `&select=species_name,scientific_name,confidence,detected_at&order=detected_at.asc&limit=2000`,
    true,
  )
  const bySpecies = new Map()
  for (const r of rows) {
    if (!r.species_name) continue
    const cur = bySpecies.get(r.species_name)
    if (!cur) {
      bySpecies.set(r.species_name, {
        species_name: r.species_name,
        scientific_name: r.scientific_name || null,
        first_seen: r.detected_at,
        last_seen: r.detected_at,
        count: 1,
        confidence_max: r.confidence ?? 0,
      })
    } else {
      cur.count += 1
      cur.last_seen = r.detected_at
      if ((r.confidence ?? 0) > cur.confidence_max) cur.confidence_max = r.confidence ?? 0
    }
  }
  return [...bySpecies.values()]
}

/** True if this species was ever detected at the node before `before`. */
export async function hasPriorDetection(nodeId, speciesName, before) {
  const n = await pgCount(
    `detections?node_id=eq.${nodeId}&species_name=eq.${enc(speciesName)}&detected_at=lt.${enc(before)}`,
  )
  return n > 0
}

/** Network-wide detection count for a species (rarity proxy for the degraded scorer). */
export async function networkDetectionCount(speciesName) {
  return pgCount(`detections?species_name=eq.${enc(speciesName)}`)
}

/** Count detections at the node in [from, to). */
export async function detectionCount(nodeId, from, to) {
  return pgCount(`detections?node_id=eq.${nodeId}&detected_at=gte.${enc(from)}&detected_at=lt.${enc(to)}`)
}

/** All species names ever detected at the node (for iNat ground-truth gap detection). */
export async function nodeSpeciesSet(nodeId) {
  const rows = await pgFetch(`detections?node_id=eq.${nodeId}&select=species_name&limit=5000`, true)
  return new Set(rows.map((r) => r.species_name).filter(Boolean))
}

// ── species (seeded: family, order, conservation; guild is null-seeded) ───────
/**
 * Species profile. Conservation status is read from iucn_status (the actual column on
 * species; there is no conservation_status column). Guild/diet columns exist but are
 * null-seeded, so callers must treat them as optional.
 */
export async function speciesProfile(speciesName) {
  const s = await pgFetch(`species?common_name=eq.${enc(speciesName)}&select=*`)
  if (!s) return null
  return {
    id: s.id,
    common_name: s.common_name,
    scientific_name: s.scientific_name || null,
    family: s.family || null,
    order_name: s.order_name || null,
    conservation_status: s.iucn_status ?? null,
    // Projected derived cache (guild written by the trait ETL). Authoritative source is
    // ref_species_traits via traitSource; this is the convenience projection.
    guild: s.guild ?? null,
  }
}

// ── aci_logs (soundscape health, logged every cycle) ─────────────────────────
/** Mean ACI and sample count over [from, to). */
export async function aciMean(nodeId, from, to) {
  const rows = await pgFetch(
    `aci_logs?node_id=eq.${nodeId}&recorded_at=gte.${enc(from)}&recorded_at=lt.${enc(to)}` +
      `&select=aci_score&limit=5000`,
    true,
  )
  const vals = rows.map((r) => r.aci_score).filter((v) => typeof v === 'number')
  if (!vals.length) return { mean: null, sampleCount: 0 }
  return { mean: vals.reduce((a, b) => a + b, 0) / vals.length, sampleCount: vals.length }
}

// ── node_habitat (structured habitat fields for the place) ───────────────────
/** The node's structured habitat fields; null if no habitat row exists. */
export async function nodeHabitat(nodeId) {
  return pgFetch(`node_habitat?node_id=eq.${nodeId}&select=*`)
}

// ── iNat ambient (research-grade nearby cross-taxa; Step 0, shipped) ──────────
const INAT_UA = 'Magora/0.1 (ecological intelligence network; github.com/magora-project)'
/** Research-grade species verified near a point, via species_counts (no per-record coords). */
export async function inatAmbient(lat, lon, radiusKm = PULSE_CONFIG.inatRadiusKm) {
  if (lat == null || lon == null) return []
  try {
    const url =
      'https://api.inaturalist.org/v1/observations/species_counts' +
      `?lat=${lat.toFixed(3)}&lng=${lon.toFixed(3)}&radius=${radiusKm}` +
      '&quality_grade=research&captive=false&per_page=200'
    const r = await fetch(url, { headers: { 'User-Agent': INAT_UA, Accept: 'application/json' } })
    if (!r.ok) return []
    const data = await r.json()
    return (Array.isArray(data.results) ? data.results : [])
      .map((row) => {
        const t = row.taxon || {}
        return {
          name: t.name || null,
          common: t.preferred_common_name || null,
          iconic: t.iconic_taxon_name || 'Unknown',
          count: row.count || 0,
          threatened: !!t.threatened,
        }
      })
      .filter((t) => t.name)
  } catch {
    return []
  }
}

// ── Stubbed knowledge seams (GloBI / USA-NPN cached layer lands in a separate task) ──
// Code targets these interfaces now; the rich survey-gap tier activates when the
// Ecological Intelligence reference layer ships. Until then both return the neutral
// sentinel, so the grounded survey-gap tier fires normally while the relationship /
// phenology components stay neutral (see generate.js and the degradation notes).

/**
 * @typedef {Object} RelationshipSource
 * @property {(a: string, context: object) => Promise<number|null>} strength
 *   0..1 relationship strength for species `a` given place context, or null if unknown.
 */
/** @type {RelationshipSource} */
export const relationshipSource = {
  // DEGRADED (guild/diet + GloBI not available in v1): always "unknown" -> neutral.
  // TODO(guild-enrichment + EIA reference layer): derive from species.guild/diet + GloBI.
  async strength() {
    return null
  },
}

/**
 * @typedef {Object} PhenologySource
 * @property {(species: string, date: string, coords: {lat:number, lon:number}) => Promise<number|null>} alignment
 *   0..1 phenological alignment, or null if unknown.
 */
/** @type {PhenologySource} */
export const phenologySource = {
  // Stubbed (USA-NPN AGDD/Spring Index cached layer not built): always null -> neutral.
  async alignment() {
    return null
  },
}

/**
 * traitSource — provenance-aware read of the authoritative ref_species_traits layer
 * (EIA §6), parallel to relationshipSource / phenologySource. Unlike those two (still
 * stubbed), this one is backed by real data once the trait ETL runs. Returns the trait row
 * (guild + curated regional fields + provenance) or null on a miss. Before migration 20260715
 * lands, or for a non-bird / unmatched species, the query yields nothing and this returns
 * null, so callers fall back to the degraded proxy (additive). ref_species_traits is server
 * reference data — never exposed to the client (the species.* projection feeds the UI).
 */
export const traitSource = {
  async getTraits(speciesId) {
    if (!speciesId) return null
    const row = await pgFetch(
      `ref_species_traits?species_id=eq.${speciesId}` +
        `&select=guild,trophic_niche,primary_lifestyle,migratory_status,indicator_status,sensitivity_flag,trait_source,provenance`,
    )
    return row || null
  },
}
