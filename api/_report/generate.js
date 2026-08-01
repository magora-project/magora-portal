// Node Phenology Report — shared resolve → cache-check → build → narrate → cache flow.
//
// One check-before-generate path used by BOTH the on-demand endpoint (api/report-ondemand.js) and
// the batch scheduler (api/report-cron.js), so the two never drift. Keyed on
// (node_id, cadence, period_key); a fresh cached row (narrated_at >= generated_at) is returned with
// NO model call. Writes go through set_node_report (service_role). Place data only.

import { pgFetch } from '../_pulse/db.js'
import { nodeCoords } from '../_pulse/sources.js'
import { buildReport, resolvePeriodKey } from './payload.js'
import { narrateReport } from './narrate-report.js'
import { fetchCachedReport, sbRpcService } from './db.js'

/**
 * Resolve the period, check the cache, and generate+cache on miss.
 * @param {string} nodeId
 * @param {"daily"|"seasonal"|"annual"} cadence
 * @param {string} [dateOrKey]  period_key or a reference date; defaults to the current period
 * @param {string} [voice]      report voice (default 'node')
 * @returns {Promise<{ periodKey:string, report:object|null, error?:string, cached?:boolean }>}
 *   report=null => quiet period, nothing to author (not cached). error set => generation failed.
 */
export async function generateReportForNode(nodeId, cadence, dateOrKey, voice = 'node') {
  // Latitude is needed only to NAME the season by hemisphere; daily/annual don't need it.
  const lat = cadence === 'seasonal' ? (await nodeCoords(nodeId)).lat : null
  const periodKey = resolvePeriodKey(cadence, dateOrKey, lat)

  // Cache-first: a fresh cached row (narrated at or after its payload was built) short-circuits.
  const cached = await fetchCachedReport(pgFetch, nodeId, cadence, periodKey)
  if (
    cached?.narrative &&
    cached.narrated_at &&
    new Date(cached.narrated_at).getTime() >= new Date(cached.generated_at).getTime()
  ) {
    return {
      periodKey,
      cached: true,
      report: { payload: cached.payload, narrative: cached.narrative, voice: cached.voice, model: cached.model, cached: true },
    }
  }

  // Cache miss — but a node that has STOPPED LISTENING must not author anything new. Its existing
  // reports above are still served (the place's record is retained and readable); it simply stops
  // adding days it did not witness.
  //
  // The gate lives here, after the cache check, rather than only in the cron: report-ondemand is
  // public and unauthenticated, so any visitor pressing "Read how this place has changed" on a
  // decommissioned node's page would otherwise mint a fresh first-person report through that door.
  // These publish to permalinks that unfurl share cards, so the claim has to be true wherever it
  // is triggered from.
  //
  // Returns the same quiet `report: null` a genuinely uneventful period returns, so every caller
  // already handles it — the cron counts it as `quiet`, the UI shows its calm empty state.
  const { node } = await nodeCoords(nodeId)
  if (node && node.is_active === false) {
    return { periodKey, report: null }
  }

  // Miss / stale: build the grounded payload, then narrate on the report tier (Sonnet).
  const payload = await buildReport(nodeId, cadence, periodKey)
  const out = await narrateReport(payload, voice)
  if (!out) return { periodKey, report: null } // quiet period, nothing to author
  if (out.error) return { periodKey, error: out.error }

  // Persist (service_role write). Best-effort: a failed write just regenerates next time.
  await sbRpcService('set_node_report', {
    p_node_id: nodeId,
    p_cadence: cadence,
    p_period_key: periodKey,
    p_payload: payload,
    p_narrative: out.text,
    p_voice: out.voice,
    p_model: out.model,
  }).catch((e) => console.warn('set_node_report failed:', e.message))

  return { periodKey, cached: false, report: { payload, narrative: out.text, voice: out.voice, model: out.model, cached: false } }
}
