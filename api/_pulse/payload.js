// Pulse Agent v1 — canonical payload type + config surface (constants).
//
// This directory is underscore-prefixed (api/_pulse/) so Vercel does NOT treat these
// modules as routable serverless functions — only api/pulse-ondemand.js and
// api/pulse-batch.js are endpoints; they import the shared core from here.
//
// The canonical payload is voice-agnostic: Pulse decides WHAT is worth saying and emits
// this structured payload; a downstream Narrative Agent (not in v1) decides HOW it is
// said. Every voice would render the same payload, so facts stay consistent.

/**
 * @typedef {"on_demand"|"daily"|"weekly"|"monthly"|"seasonal"|"annual"|string} PulseCadence
 *   window/weight/routing profile name. v1 uses "on_demand" | "daily".
 */

/**
 * @typedef {"novel_detection"|"activity_spike"|"soundscape_shift"|"survey_gap_question"|"absence"} PulseKind
 *   "absence" is provisioned but gated OFF in v1 (never generated or scored).
 */

/**
 * @typedef {Object} Window
 * @property {string} start  ISO timestamp (inclusive)
 * @property {string} end    ISO timestamp (exclusive)
 * @property {PulseCadence} cadence
 */

/**
 * A scored candidate on its way to becoming a stored pulse. Carries named component
 * sub-scores in [0,1]; scorePulses aggregates them with the versioned weights.
 * @typedef {Object} Candidate
 * @property {PulseKind} kind
 * @property {Record<string, number>} components   per-component sub-scores in [0,1]
 * @property {{ species?: string[], metric?: string }} subject
 * @property {Object} [survey_gap]                 present only for survey_gap_question
 * @property {string} survey_gap.question_focus
 * @property {string} survey_gap.relationship_rationale
 * @property {string} survey_gap.answer_target
 * @property {Record<string, unknown>} evidence
 */

/**
 * The canonical, voice-agnostic Pulse payload (stored in public.pulses).
 * @typedef {Object} PulsePayload
 * @property {string} pulse_id
 * @property {string} node_id
 * @property {PulseKind} kind
 * @property {{ start: string, end: string, cadence: PulseCadence }} window
 * @property {string} generated_at
 * @property {number} score                         aggregate notability
 * @property {Record<string, number>} components    per-component sub-scores (retro-tuning)
 * @property {string} weights_version
 * @property {{ species?: string[], metric?: string }} subject
 * @property {{ question_focus: string, relationship_rationale: string, answer_target: string }} [survey_gap]
 * @property {Record<string, unknown>} evidence
 * @property {boolean} posted_to_feed               always false in v1
 */

/** All kinds, including the gated `absence`. */
export const PULSE_KINDS = /** @type {PulseKind[]} */ ([
  'novel_detection',
  'activity_spike',
  'soundscape_shift',
  'survey_gap_question',
  'absence',
])

/** The weights_version whose rows in public.pulse_weights we score against. */
export const WEIGHTS_VERSION = 'v1'

/**
 * pulseOnDemand freshness window (§6): a stored pulse for the same (node_id, resolved
 * window) generated within this TTL is returned as-is instead of regenerating.
 * v1.1 will additionally invalidate early when new detections land in the window.
 */
export const PULSE_ONDEMAND_TTL_MS = 6 * 60 * 60 * 1000 // 6h

/**
 * Feature gate (§5). While false: `absence` candidates are never generated or scored,
 * and a DOWNWARD soundscape shift is emitted only as a survey_gap_question (a question,
 * never a decline assertion). Enabling absence later additionally requires an external
 * baseline, a baseline threshold, coverage-continuity, and node-offline detection —
 * none of which v1 implements beyond this flag.
 */
export const PULSE_ABSENCE_ENABLED = false

/**
 * Generation thresholds. Config, not literals scattered through the queries (§3).
 */
export const PULSE_CONFIG = {
  // novel_detection: how far back "no prior detection" looks is unbounded (all history);
  // rarity degradation reads network detection frequency + conservation status.
  novelFrequencyFullN: 400,     // detection count at/above which a species is treated as "common" (freq score -> 0)

  // activity_spike
  baselineDays: 14,             // trailing baseline length for detection-rate comparison
  spikeMultiple: 1.5,           // window rate must exceed baseline by this factor to emit
  spikeCeiling: 4,              // ratio mapped to magnitude 1.0 at/above this
  baselineStabilityFullN: 200,  // baseline detection count at/above which the baseline is "stable"

  // soundscape_shift
  aciBaselineDays: 14,          // trailing baseline length for mean-ACI comparison
  aciMinDelta: 0.05,            // |Δ mean ACI| below this is noise (no candidate)
  aciDeltaCeiling: 0.25,        // |Δ| mapped to delta_magnitude 1.0 at/above this

  // survey_gap_question
  inatRadiusKm: 5,              // ambient iNat search radius for ground-truth gaps
  inatMinCount: 3,              // an iNat taxon needs at least this many nearby obs to be "confirmable"
  inatMaxQuestions: 2,          // cap iNat ground-truth questions per run

  // shared
  neutralScore: 0.5,            // the neutral sub-score returned by stubbed source seams
}
