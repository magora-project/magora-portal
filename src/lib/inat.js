// Client helpers for the ambient iNaturalist layer (Tier 0 — "the surrounding wild").
// Talks to api/inat-nearby.js. See vault: 01 - Project Brain / 🌿 iNaturalist Integration.

// iNat iconic taxon → friendly label + emoji, so we can tell the "whole web" story
// (birds AND plants AND insects AND fungi…), not just birds.
export const ICONIC = {
  Aves: { emoji: '🪶', label: 'birds' },
  Mammalia: { emoji: '🦌', label: 'mammals' },
  Plantae: { emoji: '🌿', label: 'plants' },
  Insecta: { emoji: '🐞', label: 'insects' },
  Fungi: { emoji: '🍄', label: 'fungi' },
  Arachnida: { emoji: '🕷️', label: 'arachnids' },
  Amphibia: { emoji: '🐸', label: 'amphibians' },
  Reptilia: { emoji: '🦎', label: 'reptiles' },
  Mollusca: { emoji: '🐌', label: 'molluscs' },
  Actinopterygii: { emoji: '🐟', label: 'fish' },
  Animalia: { emoji: '🐾', label: 'other animals' },
  Chromista: { emoji: '🦠', label: 'chromists' },
  Protozoa: { emoji: '🦠', label: 'protozoans' },
  Unknown: { emoji: '➕', label: 'other life' },
}

export function iconicMeta(name) {
  return ICONIC[name] || { emoji: '➕', label: (name || 'other').toLowerCase() }
}

// Public iNaturalist page for a taxon id — works for every taxon (plants, insects,
// fungi, mammals), which the bird-oriented internal /species page does not.
export function inatTaxonUrl(id) {
  return `https://www.inaturalist.org/taxa/${id}`
}

// How many of the acoustically-detected species are also verified nearby on iNat.
// Matches by scientific name (case-insensitive) against the returned taxa — the
// concrete tie between what the mic heard and the surrounding observed web.
export function corroboratedCount(heardSpecies, nearby) {
  if (!nearby?.taxa?.length || !heardSpecies?.length) return 0
  const verified = new Set(nearby.taxa.map((t) => (t.name || '').toLowerCase()))
  return heardSpecies.filter((s) => s.scientific_name && verified.has(s.scientific_name.toLowerCase())).length
}

// Turn the API's `groups` object into a display-sorted summary (most diverse group first).
export function summarizeGroups(groups) {
  if (!groups) return []
  return Object.entries(groups)
    .map(([iconic, taxa]) => ({ iconic, ...iconicMeta(iconic), count: taxa.length }))
    .sort((a, b) => b.count - a.count)
}

// Fetch the ambient nearby species for a point. Non-fatal by contract: returns null on
// any failure — this is ambient enrichment and must never block the capture flow.
export async function fetchNearbyLife(lat, lon, radius = 5) {
  try {
    const r = await fetch(`/api/inat-nearby?lat=${lat}&lon=${lon}&radius=${radius}`)
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}
