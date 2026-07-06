// Pulse Agent v1 — the two entry points over one shared pure core.
//
//   runCore(nodeId, window)                 pure-ish: generateCandidates -> scorePulses
//   pulseOnDemand(nodeId, window?)          interactive; check cache first (freshness TTL)
//   pulseBatch(nodeId, window, cadence)     cron; generate -> store all -> notify-to-Slack
//
// Both modes call runCore and store through the same idempotent upsert. The payload shape
// is identical across modes; only the caching/notify wrapper differs. Window is always a
// parameter — the core never bakes one in.

import { WEIGHTS_VERSION, PULSE_ONDEMAND_TTL_MS } from './payload.js'
import { loadWeights, findFreshPulse, storePulse } from './db.js'
import { generateCandidates } from './generate.js'
import { scorePulses } from './score.js'
import { postOperatorAlert, summarizeRun } from './notify.js'

/**
 * Shared pure core: generate candidates for the window and rank them with the versioned
 * weights. Returns scored payload drafts (node_id/window/generated_at/pulse_id are
 * attached at store time), ranked by score desc. No writes, no side-effects.
 * @param {string} nodeId
 * @param {import('./payload.js').Window} window
 */
export async function runCore(nodeId, window) {
  const [candidates, weights] = await Promise.all([
    generateCandidates(nodeId, window),
    loadWeights(WEIGHTS_VERSION),
  ])
  return scorePulses(candidates, weights, WEIGHTS_VERSION)
}

/**
 * Resolve a window. When none is supplied (on-demand), default to the current UTC
 * calendar day so repeated requests within the day share the same window key (a stable
 * key is what makes the freshness TTL reusable). Explicit windows are used as-is.
 * @param {Partial<import('./payload.js').Window>} [window]
 * @param {import('./payload.js').PulseCadence} [defaultCadence]
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
 * Interactive entry point (§6). Check the cache first: return the top-ranked stored pulse
 * for this resolved window if it was generated within PULSE_ONDEMAND_TTL. Otherwise
 * generate -> score -> store -> return the top pulse. Returns null when there is nothing
 * to say (no candidates).
 * @param {string} nodeId
 * @param {Partial<import('./payload.js').Window>} [window]
 * @returns {Promise<import('./payload.js').PulsePayload | null>}
 */
export async function pulseOnDemand(nodeId, window) {
  const resolved = resolveWindow(window, 'on_demand')

  const fresh = await findFreshPulse(nodeId, resolved, PULSE_ONDEMAND_TTL_MS)
  if (fresh) return fresh

  const scored = await runCore(nodeId, resolved)
  if (!scored.length) return null

  // Store the full ranked set so a later view of the same window is a cache hit, then
  // return the top pulse for the single-question slot.
  const stored = await Promise.all(scored.map((p) => storePulse(nodeId, resolved, p)))
  return stored.sort((a, b) => b.score - a.score)[0]
}

/**
 * Batch entry point (§6). Generate -> score -> store (idempotent on the unique key) ->
 * notify-to-Slack (operator side-effect). Returns the stored payloads, ranked.
 * @param {string} nodeId
 * @param {import('./payload.js').Window} window
 * @param {import('./payload.js').PulseCadence} cadence
 * @returns {Promise<import('./payload.js').PulsePayload[]>}
 */
export async function pulseBatch(nodeId, window, cadence) {
  const resolved = resolveWindow({ ...window, cadence }, cadence || 'daily')

  const scored = await runCore(nodeId, resolved)
  const stored = await Promise.all(scored.map((p) => storePulse(nodeId, resolved, p)))
  const ranked = stored.sort((a, b) => b.score - a.score)

  // Operator monitoring side-effect only — never a node-voice publication.
  await postOperatorAlert(summarizeRun(nodeId, resolved.cadence, ranked))

  return ranked
}
