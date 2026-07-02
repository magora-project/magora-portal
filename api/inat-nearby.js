// Ambient nearby iNaturalist search (iNat Integration — Tier 0 / "the surrounding wild").
// Read-only, no auth: iNat's read endpoints are unauthenticated. Returns the deduped,
// research-grade species verified near a point, grouped by iconic taxon (birds, mammals,
// plants, insects, fungi...) so the app can show the whole local web, not just birds.
//
// Uses /v1/observations/species_counts (aggregate) rather than raw observations, which
// also sidesteps iNat's obscured-coordinate privacy handling — there are no per-record
// coordinates in an aggregate species list.
//
// See vault: 01 - Project Brain / 🌿 iNaturalist Integration (Tier 0 / Step 0).

const UA = 'Magora/0.1 (ecological intelligence network; github.com/magora-project)'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })

  const { lat, lon } = req.query
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' })

  const latN = Number(lat)
  const lonN = Number(lon)
  if (!Number.isFinite(latN) || !Number.isFinite(lonN)) {
    return res.status(400).json({ error: 'lat and lon must be numbers' })
  }

  // Radius in km, tunable; clamp to a sane range (iNat caps at ~sanity anyway).
  const radiusKm = Math.min(Math.max(Number(req.query.radius) || 5, 1), 50)

  // Coarsen the query point to ~110m (3 decimals) — matches the public-view privacy
  // coarsening and lets Vercel's edge cache reuse responses for nearby captures.
  const qLat = latN.toFixed(3)
  const qLon = lonN.toFixed(3)

  const url =
    'https://api.inaturalist.org/v1/observations/species_counts' +
    `?lat=${qLat}&lng=${qLon}&radius=${radiusKm}` +
    '&quality_grade=research&captive=false&per_page=200'

  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (!r.ok) return res.status(502).json({ error: `iNaturalist error: ${r.status}` })
    const data = await r.json()
    const results = Array.isArray(data.results) ? data.results : []

    const taxa = results
      .map((row) => {
        const t = row.taxon || {}
        const photo = t.default_photo || {}
        return {
          id: t.id,
          name: t.name || null,
          common: t.preferred_common_name || null,
          iconic: t.iconic_taxon_name || 'Unknown',
          rank: t.rank || null,
          count: row.count || 0,
          threatened: !!t.threatened,
          photo: photo.square_url || photo.url || null,
          photo_attribution: photo.attribution || null,
          wikipedia: t.wikipedia_url || null,
        }
      })
      .filter((t) => t.name)

    // Group by iconic taxon so the UI can tell the "whole web" story.
    const groups = {}
    for (const t of taxa) {
      ;(groups[t.iconic] ||= []).push(t)
    }

    // Cache at the edge for a day — research-grade nearby life changes slowly, and the
    // query point is already coarsened so many captures share a cache key.
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800')

    return res.status(200).json({
      location: { lat: qLat, lon: qLon, radius_km: radiusKm },
      total_species: data.total_results ?? taxa.length,
      returned: taxa.length,
      taxa,
      groups,
      source: 'iNaturalist',
      attribution: 'Research-grade observations © the iNaturalist community (CC-licensed)',
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
