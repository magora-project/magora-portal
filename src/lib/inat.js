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
