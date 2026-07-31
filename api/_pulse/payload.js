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

/**
 * @typedef {"detection_card"|"listen_result"|"journal_entry"|"node_report"|"node_page_hero"} PulseSurface
 */

/**
 * Response-only surface routing (v1.1, D5). NOT stored — computed per response over the
 * window's ranked pulses and attached to the response only (no DB column, no schema, no
 * upsert change). Single-cardinality surfaces hold one pulse_id (or null); node_report
 * holds a ranked list of pulse_ids.
 * @typedef {Object} PulseSelection
 * @property {{ detection_card?: string|null, listen_result?: string|null, journal_entry?: string|null, node_report?: string[], node_page_hero?: string|null }} per_surface
 */

/**
 * On-demand response (v1.1): the top pulse (unchanged) plus response-only routing.
 * Callers that ignore `selection` see the same top-1 payload as before.
 *
 * `selected` (NodePage v1) resolves the requested single-cardinality surface's pulse_id back
 * to its payload, so a caller rendering ONE surface does not have to assume the routed pulse
 * is the top-1 (it often is not — the top pulse may be ineligible for that surface). Null for
 * list-cardinality surfaces (node_report), which already get their ranked ids via `selection`.
 * @typedef {Object} PulseOnDemandResult
 * @property {PulsePayload|null} pulse
 * @property {PulseSelection} selection
 * @property {PulsePayload|null} selected
 */

/** The render surfaces Pulse can route a chosen pattern to. */
export const SURFACES = /** @type {PulseSurface[]} */ ([
  'detection_card', 'listen_result', 'journal_entry', 'node_report', 'node_page_hero',
])

/** Default surface for an on-demand request that doesn't name one. */
export const DEFAULT_SURFACE = 'detection_card'

// Kinds a single-question / reflective surface accepts. soundscape_shift is excluded (it
// routes to node_report only); absence is excluded (gated — never eligible anywhere).
const SINGLE_QUESTION_KINDS = ['novel_detection', 'activity_spike', 'survey_gap_question']
// node_report is a ranked list over all non-gated kinds.
const REPORT_KINDS = ['novel_detection', 'activity_spike', 'soundscape_shift', 'survey_gap_question']
// node_page_hero (NodePage v1) is the reader-facing Glance slot: the ONE thing this place is
// noticing right now. Deliberately NARROWER than the other single surfaces — survey_gap_question
// is excluded, and that exclusion is PERMANENT, not a v1 gate waiting on the participation loop.
//
// A survey gap is an invitation to answer ("no recorded vegetation structure — can you fill it
// in?", "is this species present here?"), i.e. a participation ask. A grounded habitat gap scores
// data_absence = 1, so it clears the grounded guard and would routinely take the Glance slot,
// where it would compete with Follow as a second call to action. The Glance slot holds ONE
// meaningful OBSERVATION and the public page carries exactly one primary action.
//
// When the participation loop ships, survey gaps route to a dedicated consent-gated participation
// slot — do NOT add the kind back here. Excluding it is strictly stronger than the
// grounded-survey-gap degradation guard it would otherwise inherit; select.js still applies that
// guard for the surfaces that do accept the kind.
const HERO_KINDS = ['novel_detection', 'activity_spike']

/**
 * Static surface -> affordance map: cardinality + the eligible-kind set. Eligibility is a
 * kind gate; the degradation guard (grounded-only survey_gap on single surfaces) lives in
 * select.js. `absence` is in no set, so it is never eligible on any surface.
 */
export const SURFACE_AFFORDANCE = {
  detection_card: { cardinality: 'single', kinds: SINGLE_QUESTION_KINDS },
  listen_result:  { cardinality: 'single', kinds: SINGLE_QUESTION_KINDS },
  journal_entry:  { cardinality: 'single', kinds: SINGLE_QUESTION_KINDS },
  node_report:    { cardinality: 'list',   kinds: REPORT_KINDS },
  node_page_hero: { cardinality: 'single', kinds: HERO_KINDS },
}

/**
 * A survey_gap_question reaches a single-question surface only when its grounded
 * `data_absence` sub-score clears this bar (habitat-gap / iNat ground-truth = 1.0). Below
 * it, the pulse's score would be carried by the neutral-0.5 relationship_strength /
 * phenology_alignment placeholders — which must never put it on a card. See select.js.
 */
export const GROUNDED_DATA_ABSENCE_MIN = 0.5

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
