// Pulse Agent v1.1 (D5) — per-surface selection. PURE assignment, no I/O, no DB.
//
//   assignSurfaces(rankedPulses, surfacesInScope) -> { per_surface }
//
// Given the window's pulses already ranked by score desc, route them to render surfaces:
// single-cardinality surfaces (detection_card / listen_result / journal_entry / node_page_hero)
// get the top ELIGIBLE pulse_id (or null); node_report gets the ranked list of eligible
// pulse_ids. Eligible-kind sets differ per surface (node_page_hero is the narrowest — see
// SURFACE_AFFORDANCE), so "top eligible" is not the same pulse on every surface.
// This is allocation-by-score — ranking, which is Pulse's job — never rendering.
//
// Eligibility uses only confirmed payload fields (kind, components, evidence). It does NOT
// depend on cold_start (not emitted by the payload). Storage is untouched: this reads the
// ranked list and returns a response-only object.

import { SURFACE_AFFORDANCE, GROUNDED_DATA_ABSENCE_MIN } from './payload.js'

/**
 * Degradation guard: a survey_gap_question may reach a single-question surface ONLY on its
 * grounded `data_absence` sub-score (habitat-gap / iNat ground-truth). Never on the
 * neutral-0.5 relationship_strength / phenology_alignment placeholders, and never when it
 * was routed from a soundscape shift (those belong on node_report). Keys only on
 * data_absence, so the placeholder sub-scores can never make it card-eligible.
 */
function isGroundedSurveyGap(pulse) {
  const grounded = (pulse.components?.data_absence ?? 0) >= GROUNDED_DATA_ABSENCE_MIN
  const fromSoundscape = pulse.evidence?.routed_from === 'soundscape_shift'
  return grounded && !fromSoundscape
}

/** Is this pulse eligible for this surface? Kind gate + degradation guard. */
export function isEligible(pulse, surface) {
  // absence is gated — never eligible on any surface, even if a caller passes one in.
  if (pulse.kind === 'absence') return false
  const aff = SURFACE_AFFORDANCE[surface]
  if (!aff || !aff.kinds.includes(pulse.kind)) return false
  // On single-question surfaces, a survey_gap_question must be grounded (not placeholder-carried).
  if (pulse.kind === 'survey_gap_question' && aff.cardinality === 'single') {
    return isGroundedSurveyGap(pulse)
  }
  return true
}

/**
 * @param {import('./payload.js').PulsePayload[]} rankedPulses  ranked by score desc
 * @param {import('./payload.js').PulseSurface[]} surfacesInScope  which surfaces to assign
 * @returns {import('./payload.js').PulseSelection}
 */
export function assignSurfaces(rankedPulses, surfacesInScope) {
  const list = Array.isArray(rankedPulses) ? rankedPulses : []
  const per_surface = {}
  for (const surface of surfacesInScope) {
    const aff = SURFACE_AFFORDANCE[surface]
    if (!aff) continue // unknown surface: skip (don't invent a key)
    const eligibleIds = list.filter((p) => isEligible(p, surface)).map((p) => p.pulse_id)
    per_surface[surface] = aff.cardinality === 'list' ? eligibleIds : (eligibleIds[0] ?? null)
  }
  return { per_surface }
}
