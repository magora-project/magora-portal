// Node Phenology Report — label-quality classifier (biophony vs anthropophony).
//
// A deterministic primitive that sorts a detection label into one of three classes:
//   'bird'          — a bird (has an eBird code, or an Aves class).
//   'biophony'      — a real non-bird organism: insect, amphibian, mammal, or an uncoded bird.
//                     Legitimate soundscape — katydids, frogs, a coyote, a wolf. Stays a VOICE.
//   'anthropophony' — BirdNET's human/machine noise classes ("Human non-vocal", engines, sirens).
//                     NOT a voice — reframed as human-activity context by the report.
//
// WHY the signal is what it is (verified against prod 2026-07-17): BirdNET's noise labels carry NO
// biological taxonomy — "Human non-vocal" has scientific_name == its own label (not a binomial) and
// the pure-noise classes (Engine/Siren/Dog…) have no `species` row at all. Insect biophony
// (katydids) ALSO has null `ebird_code`/`order_name`/`family`, so taxonomy columns can't tell a
// katydid from an engine. The one signal that separates real organisms from noise is a **binomial
// scientific name** ("Genus species"): every insect/frog/mammal/uncoded-bird has one; no noise
// class does. So: curated anthropophony set (checked first, the explicit discriminator for the
// known noise classes) → eBird code (bird) → binomial sci (biophony) → else bias to biophony.
//
// BIAS: the ambiguous case ALWAYS resolves to biophony (a voice). We never silence a real voice;
// the only risk is an uncatalogued noise label slipping through as a voice, which is acceptable and
// safer than silencing biophony. Keeping the curated set complete keeps that rare.
//
// Report-only consumer in this task, but the primitive is pure + DB-shape-agnostic so a later
// detection-level adopter (feed / species / map) can use it unchanged.

// BirdNET's known non-organism (human / machine) label classes. Lowercased for match. These are the
// only labels that must be pulled OUT of the "voices"; everything else stays a voice.
export const ANTHROPOPHONY_LABELS = new Set([
  'dog',
  'engine',
  'environmental',
  'fireworks',
  'gun',
  'human non-vocal',
  'human vocal',
  'human whistle',
  'noise',
  'power tools',
  'siren',
])

// A latin binomial: "Genus species" (capitalized genus, lowercase epithet, exactly two words).
// Intentionally strict — rejects "Human non-vocal" (hyphen / non-latin) even though the curated set
// already catches it. A real organism with an odd (tri-nomial / hyphenated) name falls through to
// the biophony default anyway, so strictness never silences a voice.
const BINOMIAL = /^[A-Z][a-z]+ [a-z]+$/

const norm = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '')

/**
 * Classify a detection label. Accepts a `species` row (any columns may be null) or a bare
 * `{ common_name }` when the label has no species row.
 * @param {{ common_name?:string, species_name?:string, scientific_name?:string|null, ebird_code?:string|null, taxon_class?:string|null, order_name?:string|null, family?:string|null }} species
 * @returns {'bird'|'biophony'|'anthropophony'}
 */
export function classifyLabel(species) {
  const name = species?.common_name ?? species?.species_name ?? ''

  // 1. Curated anthropophony wins — a known human/machine class is never a voice, whatever else it
  //    happens to carry.
  if (ANTHROPOPHONY_LABELS.has(norm(name))) return 'anthropophony'

  // 2. A bird: an eBird code (authoritative) or an explicit Aves class.
  if (species?.ebird_code) return 'bird'
  if (norm(species?.taxon_class) === 'aves') return 'bird'

  // 3. A real organism: a binomial scientific name. This is what keeps insect/amphibian/mammal
  //    biophony a voice when it has no eBird code and no order/family.
  if (species?.scientific_name && BINOMIAL.test(species.scientific_name)) return 'biophony'

  // 4. Ambiguous — bias toward keeping it a VOICE, never toward silencing.
  return 'biophony'
}

/** True for the classes that are the place's own voices (bird + biophony). */
export function isVoice(cls) {
  return cls === 'bird' || cls === 'biophony'
}
