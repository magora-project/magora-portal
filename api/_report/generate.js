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
import { nodeTenure, nodeTimeZone, toNodeLocal } from '../_lib/nodeTime.js'

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
  const { node, lat } = await nodeCoords(nodeId)
  const tz = nodeTimeZone(node)
  // Daily keys are the node's LOCAL date: without an explicit key, "today" is today where the
  // node is, not today in UTC (they diverge between local and UTC midnight).
  const effectiveDate = dateOrKey ?? (cadence === 'daily' && tz ? toNodeLocal(new Date(), tz).date : undefined)
  const periodKey = resolvePeriodKey(cadence, effectiveDate, lat)
  const tenure = await nodeTenure(nodeId)
  const cadenceGate = cadenceTenureGate(cadence, periodKey, tenure, lat)
  if (cadenceGate) return { periodKey, report: null, eligibilityError: cadenceGate }

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

export function cadenceTenureGate(cadence, periodKey, tenure, lat = 0, now = new Date()) {
  if (cadence === 'daily') return null
  // A missing first_heard_at counts as ZERO tenure, not a bypass: a node with no heartbeat or
  // detection history has listened zero days in every period, so seasonal/annual are gated
  // (422 on-demand; the cron names the skip in its [report ops] digest).
  const first = tenure?.first_heard_at ? new Date(tenure.first_heard_at).getTime() : null
  let start, end
  if (cadence === 'annual' && /^\d{4}$/.test(periodKey)) {
    const year = Number(periodKey)
    start = Date.UTC(year, 0, 1)
    end = Date.UTC(year + 1, 0, 1)
  } else if (cadence === 'seasonal') {
    const match = /^(\d{4})-(winter|spring|summer|autumn)$/.exec(periodKey)
    if (!match) return null
    const y = Number(match[1])
    const south = lat < 0
    const blocks = south
      ? { summer: [y - 1, 11], autumn: [y, 2], winter: [y, 5], spring: [y, 8] }
      : { winter: [y - 1, 11], spring: [y, 2], summer: [y, 5], autumn: [y, 8] }
    const offsets = blocks[match[2]]
    if (!offsets) return null
    start = Date.UTC(offsets[0], offsets[1], 1)
    end = Date.UTC(offsets[1] === 11 ? offsets[0] + 1 : offsets[0], offsets[1] === 11 ? 2 : offsets[1] + 3, 1)
  } else return null
  const endOfTenureWindow = Math.min(now.getTime(), end)
  const listenedDays = first == null ? 0 : Math.max(0, (endOfTenureWindow - Math.max(first, start)) / 86400000)
  const threshold = cadence === 'seasonal' ? 14 : 60
  return listenedDays >= threshold ? null : `${cadence} report requires ${threshold} days of listening in this ${cadence === 'seasonal' ? 'season' : 'year'}`
}
