// Pulse Agent v1 — the two entry points over one shared pure core (+ v1.1 D5 routing).
//
//   runCore(nodeId, window)                        pure-ish: generateCandidates -> scorePulses
//   pulseOnDemand(nodeId, window?, surface?)       interactive; cache-first (freshness TTL)
//   pulseBatch(nodeId, window, cadence)            cron; generate -> store all -> notify
//
// Both modes call runCore and store through the same idempotent upsert. Storage is
// unchanged (one-pulse-per-row). v1.1 adds a response-only `selection.per_surface`:
// surface(s) are threaded in as a scoring-core parameter (mirrors `window`, D4) and a
// pure assignment pass (select.js) routes the ranked pulses. On-demand returns
// `{ pulse, selection }` (pulse = the same top-1 as before); batch returns
// `{ pulses, selection }` (pulses = the same ranked list). Callers that ignore
// `selection` see unchanged top-1 / ranked-list behavior.

import { WEIGHTS_VERSION, PULSE_ONDEMAND_TTL_MS, SURFACES, DEFAULT_SURFACE, SURFACE_AFFORDANCE } from './payload.js'
import { loadWeights, fetchPulsesForWindow, storePulse } from './db.js'
import { generateCandidates } from './generate.js'
import { scorePulses } from './score.js'
import { assignSurfaces } from './select.js'
import { postOperatorAlert, summarizeRun } from './notify.js'

/**
 * Shared pure core: generate candidates for the window and rank them with the versioned
 * weights. Returns scored payload drafts ranked by score desc. No writes, no side-effects.
 */
export async function runCore(nodeId, window) {
  const [candidates, weights] = await Promise.all([
    generateCandidates(nodeId, window),
    loadWeights(WEIGHTS_VERSION),
  ])
  return scorePulses(candidates, weights, WEIGHTS_VERSION)
}

/**
 * Resolve a window. On-demand default is the current UTC calendar day so repeated requests
 * within the day share the same window key (stable key = reusable freshness TTL). Explicit
 * windows are used as-is.
 */
export function resolveWindow(window, defaultCadence = 'on_demand') {
  if (window?.start && window?.end) {
    return { start: window.start, end: window.end, cadence: window.cadence || defaultCadence }
  }
  const now = new Date()
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dayEnd = new Date(dayStart.getTime() + 86400000)
  return { start: dayStart.toISOString(), end: dayEnd.toISOString(), cadence: window?.cadence || defaultCadence }
}

/**
 * Resolve a single-cardinality surface's routed pulse_id back to its payload. Returns null for
 * list-cardinality surfaces (their ranked ids are already the useful form) and when nothing was
 * routed. Pure lookup over the ranked list — no I/O, no re-ranking.
 */
function resolveSelected(ranked, selection, surface) {
  if (SURFACE_AFFORDANCE[surface]?.cardinality !== 'single') return null
  const id = selection.per_surface?.[surface]
  return id ? (ranked.find((p) => p.pulse_id === id) ?? null) : null
}

/**
 * Interactive entry point. Cache-first: if the stored pulses for this resolved window are
 * fresh (top generated within PULSE_ONDEMAND_TTL, 6h) reuse them, else generate -> score
 * -> store. Returns the top pulse (unchanged) plus response-only `selection` scoped to the
 * requested surface (per_surface carries only that key) and `selected`, that surface's routed
 * payload.
 *
 * `pulse` and `selected` are NOT the same thing and callers should pick deliberately: `pulse`
 * is the window's top-ranked payload regardless of surface eligibility, while `selected` is
 * what this surface may actually render. They diverge whenever the top pulse is ineligible
 * here — e.g. a soundscape_shift outranking a novel_detection on node_page_hero. A caller
 * rendering one surface wants `selected`; existing callers that read `pulse` are unaffected.
 * @param {string} nodeId
 * @param {Partial<import('./payload.js').Window>} [window]
 * @param {import('./payload.js').PulseSurface} [surface]
 * @returns {Promise<import('./payload.js').PulseOnDemandResult>}
 */
export async function pulseOnDemand(nodeId, window, surface = DEFAULT_SURFACE) {
  const resolved = resolveWindow(window, 'on_demand')

  // Read the whole window's stored set once; decide freshness on the top row (6h TTL).
  const cached = await fetchPulsesForWindow(nodeId, resolved)
  const fresh =
    cached.length > 0 &&
    Date.now() - new Date(cached[0].generated_at).getTime() <= PULSE_ONDEMAND_TTL_MS

  let ranked
  if (fresh) {
    ranked = cached
  } else {
    const scored = await runCore(nodeId, resolved)
    if (scored.length === 0) {
      return { pulse: null, selection: assignSurfaces([], [surface]), selected: null }
    }
    ranked = (await Promise.all(scored.map((p) => storePulse(nodeId, resolved, p))))
      .sort((a, b) => b.score - a.score)
  }

  const selection = assignSurfaces(ranked, [surface])
  return { pulse: ranked[0] ?? null, selection, selected: resolveSelected(ranked, selection, surface) }
}

/**
 * Batch entry point (cron). Generate -> score -> store (idempotent) -> notify-to-Slack
 * (operator side-effect). Returns the ranked pulses (unchanged) plus response-only
 * `selection` populated across every surface in SURFACES.
 *
 * `opts.suppressAlert` skips the per-run operator Slack post. The Report scheduler (Report v1.1)
 * runs pulseBatch once per node per night and emits a SINGLE `[report ops]` digest for the whole
 * run instead — one post/night regardless of node count, rather than one `[pulse ops]` post per
 * node. Scoring/selection are unchanged; only the notify side-effect is gated.
 * @param {{ suppressAlert?: boolean }} [opts]
 * @returns {Promise<{ pulses: import('./payload.js').PulsePayload[], selection: import('./payload.js').PulseSelection }>}
 */
export async function pulseBatch(nodeId, window, cadence, opts = {}) {
  const resolved = resolveWindow({ ...window, cadence }, cadence || 'daily')

  const scored = await runCore(nodeId, resolved)
  const stored = await Promise.all(scored.map((p) => storePulse(nodeId, resolved, p)))
  const ranked = stored.sort((a, b) => b.score - a.score)

  // Operator monitoring side-effect only — never a node-voice publication. Suppressed when the
  // Report scheduler drives the run (it emits its own single digest instead).
  if (!opts.suppressAlert) await postOperatorAlert(summarizeRun(nodeId, resolved.cadence, ranked))

  return { pulses: ranked, selection: assignSurfaces(ranked, SURFACES) }
}
